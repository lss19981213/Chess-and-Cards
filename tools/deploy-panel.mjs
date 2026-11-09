#!/usr/bin/env node
/**
 * 一键部署面板（桌面化运维工具）
 *
 * 用法：
 *   pnpm deploy:panel          # 启动面板并自动打开浏览器
 *   node tools/deploy-panel.mjs --port 7788 --no-open
 *
 * 做的事情：
 *   1. git archive 打包当前 HEAD
 *   2. SFTP 上传到服务器
 *   3. 远程解压并执行 infra/deploy.sh
 *   4. 轮询部署日志，实时回传
 *
 * 凭证只保存在本机 tools/.deploy-profile.json（已加入 .gitignore），不会进入仓库。
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'ssh2';

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const PROFILE_PATH = join(ROOT, 'tools', '.deploy-profile.json');

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const PORT = Number(argOf('--port', 7788));
const OPEN_BROWSER = !args.includes('--no-open');

/** ---------- 配置 ---------- */
const DEFAULT_PROFILE = {
  host: '82.157.54.179',
  port: 22,
  username: 'ubuntu',
  password: '',
  remoteDir: '/opt/chess-and-cards',
  branch: 'main',
  openUrl: 'http://82.157.54.179/lobby/',
};

function loadProfile() {
  if (!existsSync(PROFILE_PATH)) return { ...DEFAULT_PROFILE };
  try {
    return { ...DEFAULT_PROFILE, ...JSON.parse(readFileSync(PROFILE_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

function saveProfile(profile) {
  writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2), 'utf8');
}

/** ---------- 日志广播（SSE） ---------- */
const streams = new Set();

function log(text, kind = 'info') {
  const line = { text, kind, at: Date.now() };
  const payload = `data: ${JSON.stringify(line)}\n\n`;
  for (const res of streams) res.write(payload);
  const prefix = kind === 'err' ? '✗' : kind === 'ok' ? '✓' : '·';
  console.log(`${prefix} ${text}`);
}

function broadcastState(state) {
  const payload = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
  for (const res of streams) res.write(payload);
}

let running = false;
let lastResult = null;

/** ---------- SSH 工具 ---------- */
function connect(profile) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on('ready', () => resolve(conn))
      .on('error', (err) => reject(err))
      .connect({
        host: profile.host,
        port: Number(profile.port ?? 22),
        username: profile.username,
        password: profile.password,
        readyTimeout: 25000,
      });
  });
}

function sftpPut(conn, local, remote) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.fastPut(local, remote, (putErr) => (putErr ? reject(putErr) : resolve()));
    });
  });
}

function sshExec(conn, command) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream
        .on('close', (code) => resolve({ code: code ?? 0, out }))
        .on('data', (data) => {
          out += data.toString();
        })
        .stderr.on('data', (data) => {
          out += data.toString();
        });
    });
  });
}

/** 轮询远程部署日志，把增量部分推给面板 */
async function followDeployLog(conn, timeoutMs = 150_000) {
  const started = Date.now();
  let printed = '';
  while (Date.now() - started < timeoutMs) {
    const { out } = await sshExec(conn, 'cat /tmp/deploy.log 2>/dev/null || true');
    if (out.length > printed.length) {
      const chunk = out.slice(printed.length);
      printed = out;
      for (const line of chunk.split('\n').filter(Boolean)) log(line.trim(), 'remote');
    }
    if (printed.includes('部署完成')) return true;
    if (printed.includes('部署失败') || printed.includes('ERROR')) return false;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

/** ---------- 部署主流程 ---------- */
async function runDeploy(profile) {
  running = true;
  lastResult = null;
  broadcastState({ running: true });

  const archive = join(tmpdir(), `cc-deploy-${Date.now()}.tar.gz`);
  const remoteArchive = '/tmp/cc-deploy.tar.gz';

  try {
    log(`开始部署 ${profile.username}@${profile.host}:${profile.remoteDir}`, 'info');

    log('打包当前 HEAD …');
    await execFileAsync('git', ['archive', '--format=tar.gz', '-o', archive, 'HEAD'], { cwd: ROOT });
    log('打包完成', 'ok');

    log('建立 SSH 连接 …');
    const conn = await connect(profile);
    log('SSH 已连接', 'ok');

    log('上传构建包 …');
    await sftpPut(conn, archive, remoteArchive);
    log('上传完成', 'ok');

    log('远程解压并启动部署脚本 …');
    const kick = await sshExec(
      conn,
      `tar -xzf ${remoteArchive} -C ${profile.remoteDir} && cd ${profile.remoteDir} && ` +
        `(nohup bash infra/deploy.sh > /tmp/deploy.log 2>&1 &) ; echo started`,
    );
    if (kick.code !== 0) throw new Error(`启动部署脚本失败：${kick.out.slice(-200)}`);

    log('部署脚本运行中，跟踪日志 …');
    const ok = await followDeployLog(conn);

    const status = await sshExec(conn, 'systemctl is-active cc-api cc-room');
    for (const line of status.out.split('\n').filter(Boolean)) {
      log(`服务状态：${line.trim()}`, line.trim() === 'active' ? 'ok' : 'err');
    }

    conn.end();

    if (!ok) throw new Error('部署脚本未在预期时间内完成，请查看远程 /tmp/deploy.log');

    lastResult = { ok: true, at: Date.now() };
    log('部署完成，版本已生效', 'ok');
  } catch (error) {
    lastResult = { ok: false, at: Date.now(), message: error.message };
    log(`部署失败：${error.message}`, 'err');
  } finally {
    running = false;
    broadcastState({ running: false, result: lastResult });
  }
}

/** ---------- 页面 ---------- */
const PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Chess &amp; Cards · 一键部署</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; padding: 28px;
    font-family: 'Segoe UI', system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    background: radial-gradient(900px 500px at 12% -10%, rgba(216,162,74,.14), transparent 60%), #0a0d12;
    color: #ede4cf;
  }
  .wrap { max-width: 980px; margin: 0 auto; display: grid; gap: 18px; }
  header h1 { margin: 0 0 6px; font-size: 22px; letter-spacing: 3px; }
  header p { margin: 0; font-size: 12.5px; color: rgba(237,228,207,.45); }
  .card {
    background: rgba(18,23,17,.78); border: 1px solid rgba(216,162,74,.22);
    border-radius: 14px; padding: 18px 20px;
  }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px 16px; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: rgba(237,228,207,.55); }
  input {
    height: 38px; padding: 0 12px; border-radius: 9px; font-size: 13px;
    background: rgba(7,10,8,.85); border: 1px solid rgba(216,162,74,.26); color: #ede4cf;
  }
  input:focus-visible { outline: 2px solid #d8a24a; outline-offset: 1px; }
  .actions { display: flex; gap: 12px; align-items: center; margin-top: 16px; flex-wrap: wrap; }
  button {
    height: 42px; padding: 0 22px; border-radius: 10px; font-size: 13.5px; font-weight: 800;
    border: none; cursor: pointer; color: #241a08;
    background: linear-gradient(180deg, #e7b45a, #c8912f);
  }
  button.ghost { background: transparent; color: #f3d489; border: 1px solid rgba(216,162,74,.45); }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .badge { margin-left: auto; font-size: 12px; padding: 5px 12px; border-radius: 999px;
           border: 1px solid rgba(237,228,207,.16); color: rgba(237,228,207,.6); }
  .badge.ok { color: #7fd6ae; border-color: rgba(88,184,147,.5); }
  .badge.err { color: #eea79f; border-color: rgba(210,77,67,.5); }
  #log {
    height: 380px; overflow-y: auto; padding: 12px 14px; border-radius: 10px;
    background: #050807; border: 1px solid rgba(237,228,207,.08);
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 12px; line-height: 1.7; white-space: pre-wrap; word-break: break-all;
  }
  #log .err { color: #eea79f; }
  #log .ok { color: #7fd6ae; }
  #log .remote { color: rgba(237,228,207,.72); }
  #log .info { color: #f3d489; }
  .tabs { display: flex; gap: 8px; margin-bottom: 12px; }
  a { color: #f3d489; }
  footer { font-size: 11.5px; color: rgba(237,228,207,.35); text-align: center; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>一键部署面板</h1>
    <p>打包 HEAD → 上传服务器 → 执行 deploy.sh → 回传日志。凭证仅保存在本机 tools/.deploy-profile.json。</p>
  </header>

  <section class="card">
    <div class="grid">
      <label>主机<input id="host" /></label>
      <label>端口<input id="port" type="number" /></label>
      <label>用户名<input id="username" /></label>
      <label>密码<input id="password" type="password" /></label>
      <label>远程目录<input id="remoteDir" /></label>
      <label>访问地址<input id="openUrl" /></label>
    </div>
    <div class="actions">
      <button id="deploy">开始部署</button>
      <button id="save" class="ghost">保存配置</button>
      <button id="check" class="ghost">检查服务状态</button>
      <span id="badge" class="badge">就绪</span>
    </div>
  </section>

  <section class="card">
    <div id="log">等待操作…</div>
  </section>

  <footer>部署完成后可打开 <a id="siteLink" href="#" target="_blank" rel="noreferrer">线上站点</a> 验收</footer>
</div>

<script>
const $ = (id) => document.getElementById(id);
const logEl = $('log');
const badge = $('badge');
const deployBtn = $('deploy');
let es = null;

function append(line) {
  const div = document.createElement('div');
  div.className = line.kind || 'info';
  div.textContent = line.text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}

async function fetchProfile() {
  const res = await fetch('/api/profile');
  const p = await res.json();
  for (const key of ['host','port','username','password','remoteDir','openUrl']) {
    if (p[key] !== undefined) $(key).value = p[key];
  }
  $('siteLink').href = p.openUrl || '#';
}

function currentProfile() {
  return {
    host: $('host').value.trim(),
    port: Number($('port').value) || 22,
    username: $('username').value.trim(),
    password: $('password').value,
    remoteDir: $('remoteDir').value.trim(),
    openUrl: $('openUrl').value.trim(),
  };
}

function setRunning(on) {
  deployBtn.disabled = on;
  deployBtn.textContent = on ? '部署中…' : '开始部署';
  badge.className = 'badge' + (on ? '' : '');
  badge.textContent = on ? '运行中' : '就绪';
}

function connectStream() {
  if (es) es.close();
  es = new EventSource('/api/logs');
  es.onmessage = (event) => {
    const line = JSON.parse(event.data);
    append(line);
  };
  es.addEventListener('state', (event) => {
    const state = JSON.parse(event.data);
    if (state.running) {
      setRunning(true);
    } else {
      setRunning(false);
      if (state.result) {
        badge.className = 'badge ' + (state.result.ok ? 'ok' : 'err');
        badge.textContent = state.result.ok ? '部署成功' : '部署失败';
      }
    }
  });
}

$('save').onclick = async () => {
  await fetch('/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(currentProfile()) });
  append({ text: '配置已保存到本机', kind: 'ok' });
};

$('check').onclick = async () => {
  append({ text: '检查服务状态 …', kind: 'info' });
  const res = await fetch('/api/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(currentProfile()) });
  const data = await res.json();
  if (data.ok) data.lines.forEach((text) => append({ text, kind: text.includes('active') ? 'ok' : 'err' }));
  else append({ text: data.message, kind: 'err' });
};

deployBtn.onclick = async () => {
  logEl.innerHTML = '';
  append({ text: '开始部署 …', kind: 'info' });
  setRunning(true);
  const res = await fetch('/api/deploy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(currentProfile()) });
  if (!res.ok) {
    append({ text: '部署请求被拒绝：' + (await res.text()), kind: 'err' });
    setRunning(false);
  }
};

fetchProfile().then(connectStream);
</script>
</body>
</html>`;

/** ---------- HTTP 服务 ---------- */
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/' ) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }

  if (url.pathname === '/api/profile' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(loadProfile()));
    return;
  }

  if (url.pathname === '/api/profile' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body || '{}');
        saveProfile({ ...loadProfile(), ...incoming });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400).end('bad request');
      }
    });
    return;
  }

  if (url.pathname === '/api/logs') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    res.write(`event: state\ndata: ${JSON.stringify({ running, result: lastResult })}\n\n`);
    streams.add(res);
    req.on('close', () => streams.delete(res));
    return;
  }

  if (url.pathname === '/api/deploy' && req.method === 'POST') {
    if (running) {
      res.writeHead(409).end('部署已在进行中');
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const profile = { ...loadProfile(), ...JSON.parse(body || '{}') };
        if (!profile.host || !profile.username || !profile.password) {
          res.writeHead(400).end('缺少主机、用户名或密码');
          return;
        }
        saveProfile(profile);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        void runDeploy(profile);
      } catch {
        res.writeHead(400).end('bad request');
      }
    });
    return;
  }

  if (url.pathname === '/api/status' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const profile = { ...loadProfile(), ...JSON.parse(body || '{}') };
        const conn = await connect(profile);
        const status = await sshExec(conn, 'systemctl is-active cc-api cc-room');
        const lastLog = await sshExec(conn, 'tail -1 /tmp/deploy.log 2>/dev/null || echo (无日志)');
        conn.end();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            lines: [
              ...status.out.split('\n').filter(Boolean).map((line, i) => `${i === 0 ? 'cc-api' : 'cc-room'}: ${line.trim()}`),
              `最近部署日志：${lastLog.out.trim()}`,
            ],
          }),
        );
      } catch (error) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: error.message }));
      }
    });
    return;
  }

  res.writeHead(404).end('not found');
});

server.listen(PORT, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`\n  部署面板已启动：${url}\n  配置保存在 ${PROFILE_PATH}\n`);
  if (OPEN_BROWSER) {
    const { spawn } = await import('node:child_process');
    const cmd =
      process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(cmd, [url], { shell: process.platform === 'win32', detached: true, stdio: 'ignore' }).unref();
  }
});
