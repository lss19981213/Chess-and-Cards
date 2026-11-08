import { ClientMsg, ServerMsg } from '../packages/protocol/src/index.ts';

const API = 'http://127.0.0.1:8080';
const WS_URL = 'ws://127.0.0.1:9000/ws';

interface Envelope {
  t: string;
  d: unknown;
}

function extractCaptcha(svg: string): string {
  const matches = [...svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map((m) => m[1] ?? '');
  return matches.join('');
}

async function register(prefix: string): Promise<{ token: string; user: any }> {
  const suffix = Date.now().toString().slice(-6) + Math.floor(Math.random() * 90 + 10);
  const captchaRes = await fetch(`${API}/api/captcha`);
  const captcha = (await captchaRes.json()) as any;
  const code = extractCaptcha(captcha.svg);

  const res = await fetch(`${API}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: `${prefix}${suffix}`,
      password: 'password123',
      nickname: `${prefix}_${suffix.slice(-4)}`,
      captchaId: captcha.id,
      captcha: code,
    }),
  });
  return (await res.json()) as any;
}

class TestClient {
  private readonly ws: WebSocket;
  private readonly queue: Envelope[] = [];
  private readonly waiters: Array<{ type: string; resolve: (d: unknown) => void }> = [];
  readonly opened: Promise<void>;

  constructor(token: string) {
    this.ws = new WebSocket(WS_URL);
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => {
        this.send(ClientMsg.Hello, { token });
        resolve();
      });
      this.ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')));
    });
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)) as Envelope;
      const index = this.waiters.findIndex((w) => w.type === msg.t);
      if (index >= 0) {
        const [waiter] = this.waiters.splice(index, 1);
        waiter?.resolve(msg.d);
      } else {
        this.queue.push(msg);
      }
    });
  }

  send(t: string, d: unknown): void {
    this.ws.send(JSON.stringify({ t, d, ts: Date.now() }));
  }

  waitFor(type: string, timeoutMs = 8000): Promise<Record<string, any>> {
    const hit = this.queue.findIndex((m) => m.t === type);
    if (hit >= 0) {
      const [msg] = this.queue.splice(hit, 1);
      return Promise.resolve(msg?.d as Record<string, any>);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`等待 ${type} 超时`)), timeoutMs);
      this.waiters.push({
        type,
        resolve: (d) => {
          clearTimeout(timer);
          resolve(d as Record<string, any>);
        },
      });
    });
  }

  close(): void {
    this.ws.close();
  }
}

async function testGame(gameId: string) {
  process.stdout.write(`\n▶ [${gameId.toUpperCase()}] `);
  const auth = await register('t_' + gameId.slice(0, 4));
  const client = new TestClient(auth.token);
  await client.opened;

  const hello = await client.waitFor(ServerMsg.Hello);
  if (!hello.playerId) throw new Error('认证缺少 playerId');

  // 加入房间
  client.send(ClientMsg.JoinRoom, { gameId, create: false });
  const joined = await client.waitFor(ServerMsg.RoomView);
  const room = joined.room;
  process.stdout.write(`入房 #${room.roomId.slice(0, 6)} (${room.players.length}/${room.maxPlayers}人) `);

  const persistent = room.persistent === true || ['tuizhuanzi', 'dice', 'baccarat'].includes(gameId);

  if (persistent) {
    const snap = await client.waitFor(ServerMsg.Snapshot, 10000);
    process.stdout.write(`快照[${snap.status}, round=${snap.round}] `);

    // 下注测试
    if (gameId === 'dice') {
      client.send(ClientMsg.Intent, { cmd: 'bet', payload: { area: 'big', amount: 10 } });
    } else if (gameId === 'baccarat') {
      client.send(ClientMsg.Intent, { cmd: 'bet', payload: { area: 'player', amount: 10 } });
    } else if (gameId === 'tuizhuanzi') {
      client.send(ClientMsg.Intent, { cmd: 'bet', payload: { area: 'heaven', amount: 10 } });
    }
    process.stdout.write(`下注已发 `);
  } else {
    // 准备
    client.send(ClientMsg.Ready, { ready: true });
    // 添加机器人
    const botsToAdd = room.maxPlayers - room.players.length;
    for (let i = 0; i < botsToAdd; i++) {
      client.send(ClientMsg.AddBot, {});
      await new Promise((r) => setTimeout(r, 100));
    }
    process.stdout.write(`加Bot×${botsToAdd}+准备 `);

    // 等待开局
    const snap = await client.waitFor(ServerMsg.Snapshot, 12000);
    process.stdout.write(`开局成功[${snap.status}, r=${snap.round}] `);
  }

  client.send(ClientMsg.LeaveRoom, {});
  await new Promise((r) => setTimeout(r, 200));
  client.close();
  console.log(`✓ 通过`);
}

async function main() {
  const games = [
    'gomoku',
    'doudizhu',
    'paodekuai',
    'tuizhuanzi',
    'dice',
    'baccarat',
    'niuniu',
    'blackjack',
    'texas',
    'stud',
    'goldenflower',
    'chess',
    'xiangqi',
  ];

  console.log(`准备试玩全部 ${games.length} 款游戏...`);
  let passed = 0;
  for (const g of games) {
    try {
      await testGame(g);
      passed++;
    } catch (err: any) {
      console.log(`✗ 错误: ${err.message}`);
    }
  }
  console.log(`\n测试汇总: 成功 ${passed}/${games.length}`);
}

main().catch(console.error);
