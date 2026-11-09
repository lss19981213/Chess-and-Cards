import { spawn } from 'node:child_process';
import fs from 'node:fs';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 9226;

async function testAllViews(width, height) {
  const chrome = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-extensions',
    `--window-size=${width},${height}`,
    'about:blank'
  ]);

  await new Promise((r) => setTimeout(r, 1200));

  try {
    const listRes = await fetch(`http://127.0.0.1:${port}/json`);
    const tabs = await listRes.json();
    const pageTab = tabs.find((t) => t.type === 'page');
    if (!pageTab?.webSocketDebuggerUrl) throw new Error('No page tab webSocketDebuggerUrl');

    const ws = new WebSocket(pageTab.webSocketDebuggerUrl);
    await new Promise((resolve) => ws.onopen = resolve);

    let id = 1;
    const send = (method, params = {}) => new Promise((resolve) => {
      const msgId = id++;
      const handler = (evt) => {
        const data = JSON.parse(evt.data);
        if (data.id === msgId) {
          ws.removeEventListener('message', handler);
          resolve(data.result);
        }
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    });

    await send('Page.navigate', { url: 'http://localhost:5173/lobby/' });

    // Wait until .commercial-game-card is present
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const chk = await send('Runtime.evaluate', {
        expression: `!!document.querySelector('.commercial-game-card')`,
        returnByValue: true
      });
      if (chk?.result?.value) break;
    }

    const clickAndShot = async (selector, filename, waitMs = 500) => {
      await send('Runtime.evaluate', {
        expression: `(() => { const el = document.querySelector('${selector}'); if (el) el.click(); })()`
      });
      await new Promise((r) => setTimeout(r, waitMs));
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`C:/Users/Administrator/.gemini/antigravity/brain/fae149e2-b550-4e8f-b4c3-39f124675ee9/${filename}`, Buffer.from(shot.data, 'base64'));
      console.log('Saved:', filename);
    };

    // 1. Lobby
    const lobbyShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`C:/Users/Administrator/.gemini/antigravity/brain/fae149e2-b550-4e8f-b4c3-39f124675ee9/view_lobby_${width}x${height}.png`, Buffer.from(lobbyShot.data, 'base64'));

    // 2. Welfare
    await clickAndShot('.top-feature-pill--welfare', `view_tasks_${width}x${height}.png`);

    // Back to lobby
    await clickAndShot('.hub-back-btn', 'temp.png', 300);

    // 3. Rules
    await clickAndShot('button[title*="规则"]', `view_rules_${width}x${height}.png`);

    // Back to lobby
    await clickAndShot('.hub-back-btn', 'temp.png', 300);

    // 4. Enter Gomoku (Quick play)
    await clickAndShot('.commercial-game-card .btn-quick-play-gold', `view_game_gomoku_${width}x${height}.png`, 1000);

    ws.close();
  } finally {
    chrome.kill();
  }
}

async function main() {
  await testAllViews(1920, 1080);
}

main().catch(console.error);
