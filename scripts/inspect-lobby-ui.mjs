import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const chromePath =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// 截图输出目录可用 SHOT_DIR 覆盖，默认写到项目下的 screenshots/
const OUT_DIR = process.env.SHOT_DIR ?? path.join(process.cwd(), 'screenshots');
fs.mkdirSync(OUT_DIR, { recursive: true });
const port = 9225;

async function inspectResolution(width, height, label) {
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
      if (chk?.result?.value) {
        break;
      }
    }

    // Inspect layout
    const evalRes = await send('Runtime.evaluate', {
      expression: `(() => {
        function info(selector) {
          const el = document.querySelector(selector);
          if (!el) return { selector, exists: false };
          const rect = el.getBoundingClientRect();
          const cs = window.getComputedStyle(el);
          return {
            selector,
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            height: Math.round(rect.height),
            width: Math.round(rect.width)
          };
        }

        const elements = [
          '.landscape-app-root',
          '.landscape-stage-container',
          '.lobby',
          '.lobby-main-header',
          '.commercial-lobby-stage',
          '.commercial-nav-rail',
          '.commercial-games-carousel-wrapper',
          '.commercial-games-carousel-viewport',
          '.commercial-games-strip',
          '.commercial-game-card',
          '.commercial-game-card__poster',
          '.commercial-game-card__meta',
          '.commercial-dealer-companion'
        ];

        const card = document.querySelector('.commercial-game-card');
        const cardBottom = card ? card.getBoundingClientRect().bottom : 0;
        const stage = document.querySelector('.commercial-lobby-stage');
        const stageBottom = stage ? stage.getBoundingClientRect().bottom : 0;

        return {
          window: { innerWidth: window.innerWidth, innerHeight: window.innerHeight },
          bottomBlankSpace: window.innerHeight - cardBottom,
          stageBottomBlankSpace: window.innerHeight - stageBottom,
          items: elements.map(info)
        };
      })()`,
      returnByValue: true
    });

    console.log(`=== Layout for ${label} (${width}x${height}) ===`);
    console.log(JSON.stringify(evalRes.result.value, null, 2));

    const shotRes = await send('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(shotRes.data, 'base64');
    const outPath = path.join(OUT_DIR, `inspect_${label}.png`);
    fs.writeFileSync(outPath, buffer);
    console.log('Saved screenshot:', outPath);

    ws.close();
  } finally {
    chrome.kill();
  }
}

async function main() {
  await inspectResolution(1920, 1080, '1920x1080');
  await inspectResolution(1166, 514, '1166x514');
  await inspectResolution(956, 440, '956x440');
}

main().catch(console.error);
