/**
 * 远程执行命令（开发运维工具，不提交任何凭证）。
 * 用法：node scripts/ssh-exec.mjs "命令"
 * 环境变量：SSH_HOST / SSH_USER / SSH_PASS（或 SSH_KEY_PATH）
 */
import { readFileSync } from 'node:fs';
import { Client } from 'ssh2';

const host = process.env.SSH_HOST;
const username = process.env.SSH_USER;
const password = process.env.SSH_PASS;
const keyPath = process.env.SSH_KEY_PATH;

const arg = process.argv[2];
const command = arg
  ? arg
  : await new Promise((resolve) => {
      let buf = '';
      process.stdin.on('data', (chunk) => (buf += chunk));
      process.stdin.on('end', () => resolve(buf.trim()));
    });

if (!host || !username) {
  console.error('缺少 SSH_HOST 或 SSH_USER 环境变量');
  process.exit(2);
}
if (!command) {
  console.error('缺少要执行的命令');
  process.exit(2);
}

const connectConfig = { host, port: Number(process.env.SSH_PORT ?? 22), username, readyTimeout: 25000 };
if (keyPath) connectConfig.privateKey = readFileSync(keyPath);
else connectConfig.password = password;

const conn = new Client();
conn
  .on('ready', () => {
    conn.exec(command, (err, stream) => {
      if (err) {
        console.error('EXEC_ERROR:', err.message);
        conn.end();
        process.exit(1);
      }
      let code = 0;
      stream
        .on('close', (exitCode) => {
          conn.end();
          process.exit(exitCode ?? code);
        })
        .on('data', (data) => process.stdout.write(data))
        .stderr.on('data', (data) => process.stderr.write(data));
    });
  })
  .on('error', (err) => {
    console.error('SSH_ERROR:', err.message);
    process.exit(1);
  })
  .connect(connectConfig);
