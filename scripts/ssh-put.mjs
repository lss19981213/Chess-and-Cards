/**
 * 上传文件到远程服务器（开发运维工具）。
 * 用法：node scripts/ssh-put.mjs <本地文件> <远程绝对路径>
 * 环境变量：SSH_HOST / SSH_USER / SSH_PASS（或 SSH_KEY_PATH）
 */
import { readFileSync } from 'node:fs';
import { Client } from 'ssh2';

const [localPath, remotePath] = process.argv.slice(2);
if (!localPath || !remotePath) {
  console.error('用法: node scripts/ssh-put.mjs <本地文件> <远程绝对路径>');
  process.exit(2);
}

const connectConfig = {
  host: process.env.SSH_HOST,
  port: Number(process.env.SSH_PORT ?? 22),
  username: process.env.SSH_USER,
  readyTimeout: 25000,
};
if (process.env.SSH_KEY_PATH) connectConfig.privateKey = readFileSync(process.env.SSH_KEY_PATH);
else connectConfig.password = process.env.SSH_PASS;

const conn = new Client();
conn
  .on('ready', () => {
    conn.sftp((err, sftp) => {
      if (err) {
        console.error('SFTP_ERROR:', err.message);
        process.exit(1);
      }
      sftp.fastPut(localPath, remotePath, (putErr) => {
        conn.end();
        if (putErr) {
          console.error('PUT_ERROR:', putErr.message);
          process.exit(1);
        }
        console.log(`已上传 ${localPath} -> ${remotePath}`);
        process.exit(0);
      });
    });
  })
  .on('error', (err) => {
    console.error('SSH_ERROR:', err.message);
    process.exit(1);
  })
  .connect(connectConfig);
