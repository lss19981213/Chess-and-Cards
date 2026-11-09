#!/usr/bin/env node
/**
 * GM 桌面工具的命令行执行器。
 * 由 tools/GM工具.ps1 调用，逐行输出 JSON，方便 GUI 实时显示。
 *
 * 用法：
 *   node tools/gm-cli.mjs deploy  --host H --port 22 --user U --pass P --dir /opt/chess-and-cards
 *   node tools/gm-cli.mjs status  --host H --user U --pass P
 *   node tools/gm-cli.mjs restart --host H --user U --pass P
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'ssh2';

const execFileAsync = promisify(execFile);

const argv = process.argv.slice(2);
const command = argv[0] ?? '';
const flag = (name, fallback = '') => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
};

const HOST = flag('host');
const PORT = Number(flag('port', '22'));
const USER = flag('user');
const PASS = flag('pass');
const DIR = flag('dir', '/opt/chess-and-cards');
const ROOT = process.cwd();

/** 输出一行结构化日志，GUI 按行解析 */
function emit(text, kind = 'info') {
  process.stdout.write(`${JSON.stringify({ text, kind })}\n`);
}

function connect() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on('ready', () => resolve(conn))
      .on('error', (err) => reject(err))
      .connect({ host: HOST, port: PORT, username: USER, password: PASS, readyTimeout: 25000 });
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

function sshExec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      stream
        .on('close', (code) => resolve({ code: code ?? 0, out }))
        .on('data', (chunk) => {
          out += chunk.toString();
        })
        .stderr.on('data', (chunk) => {
          out += chunk.toString();
        });
    });
  });
}

/** 跟踪远程 deploy.log，把新增行实时吐给 GUI */
async function follow(conn, timeoutMs = 240_000) {
  const started = Date.now();
  let printed = '';
  while (Date.now() - started < timeoutMs) {
    const { out } = await sshExec(conn, 'cat /tmp/deploy.log 2>/dev/null || true');
    if (out.length > printed.length) {
      const chunk = out.slice(printed.length);
      printed = out;
      for (const line of chunk.split('\n').map((l) => l.trim()).filter(Boolean)) {
        emit(line, line.includes('ERROR') || line.includes('失败') ? 'err' : 'remote');
      }
    }
    if (printed.includes('部署完成')) return true;
    if (printed.includes('部署失败')) return false;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return false;
}

async function deploy() {
  const work = mkdtempSync(join(tmpdir(), 'cc-deploy-'));
  const archive = join(work, 'deploy.tar.gz');

  emit(`目标：${USER}@${HOST}:${DIR}`, 'info');

  emit('打包当前版本 …');
  await execFileAsync('git', ['archive', '--format=tar.gz', '-o', archive, 'HEAD'], { cwd: ROOT });
  if (!existsSync(archive)) throw new Error('打包失败，请确认当前目录是 Git 仓库');
  emit('打包完成', 'ok');

  emit('连接服务器 …');
  const conn = await connect();
  emit('SSH 连接成功', 'ok');

  emit('上传构建包 …');
  await sftpPut(conn, archive, '/tmp/cc-deploy.tar.gz');
  emit('上传完成', 'ok');

  emit('执行远程部署脚本 …');
  const kick = await sshExec(
    conn,
    `tar -xzf /tmp/cc-deploy.tar.gz -C ${DIR} && cd ${DIR} && (nohup bash infra/deploy.sh > /tmp/deploy.log 2>&1 &) ; echo started`,
  );
  if (kick.code !== 0) throw new Error(`启动部署失败：${kick.out.slice(-200)}`);

  emit('部署进行中，正在读取日志 …');
  const ok = await follow(conn);

  const status = await sshExec(conn, 'systemctl is-active cc-api cc-room');
  const lines = status.out.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) emit(`服务 ${line === 'active' ? '' : '异常 '}${line}`, line === 'active' ? 'ok' : 'err');

  conn.end();
  if (!ok) throw new Error('部署未在预期时间完成，请查看服务器 /tmp/deploy.log');

  emit('部署完成，版本已生效', 'done');
}

async function status() {
  const conn = await connect();
  const svc = await sshExec(conn, 'systemctl is-active cc-api cc-room');
  const log = await sshExec(conn, 'tail -1 /tmp/deploy.log 2>/dev/null || echo no-log-yet');
  const disk = await sshExec(conn, "df -h / | tail -1 | awk '{print $5}'");
  conn.end();

  const lines = svc.out.split('\n').map((l) => l.trim()).filter(Boolean);
  emit(`cc-api：${lines[0] ?? '未知'}`, lines[0] === 'active' ? 'ok' : 'err');
  emit(`cc-room：${lines[1] ?? '未知'}`, lines[1] === 'active' ? 'ok' : 'err');
  emit(`磁盘占用：${disk.out.trim()}`, 'info');
  emit(`最近部署：${log.out.trim()}`, 'info');
  emit('状态检查完成', 'done');
}

async function restart() {
  const conn = await connect();
  emit('重启 cc-api / cc-room …');
  const res = await sshExec(conn, 'sudo systemctl restart cc-api cc-room 2>&1 || systemctl restart cc-api cc-room 2>&1');
  if (res.out.trim()) emit(res.out.trim(), 'remote');
  const svc = await sshExec(conn, 'systemctl is-active cc-api cc-room');
  conn.end();
  for (const line of svc.out.split('\n').map((l) => l.trim()).filter(Boolean)) {
    emit(`服务 ${line}`, line === 'active' ? 'ok' : 'err');
  }
  emit('重启完成', 'done');
}

const run = async () => {
  if (!HOST || !USER || !PASS) throw new Error('缺少 SSH 连接信息');
  if (command === 'deploy') return deploy();
  if (command === 'status') return status();
  if (command === 'restart') return restart();
  throw new Error(`未知命令：${command}`);
};

run().catch((error) => {
  emit(`失败：${error.message}`, 'err');
  process.exit(1);
});
