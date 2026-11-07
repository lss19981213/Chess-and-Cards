/**
 * 端到端冒烟测试：登录 → 匹配 → 准备 → 对局 → 结算 → 余额校验。
 * 用法：先启动 api-server 与 room-server，再执行 pnpm e2e
 */

const API = process.env.API_BASE ?? 'http://127.0.0.1:8080';
const WS_URL = process.env.WS_BASE ?? 'ws://127.0.0.1:9000/ws';

interface Envelope {
  t: string;
  d: unknown;
}

interface LoginResult {
  token: string;
  user: { id: string; nickname: string; balance: number };
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function login(nickname: string): Promise<LoginResult> {
  const res = await fetch(`${API}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname }),
  });
  if (!res.ok) throw new Error(`登录失败: ${res.status}`);
  return (await res.json()) as LoginResult;
}

async function fetchMe(token: string): Promise<LoginResult['user']> {
  const res = await fetch(`${API}/api/me`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`获取用户失败: ${res.status}`);
  const body = (await res.json()) as { user: LoginResult['user'] };
  return body.user;
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
        this.send('client:hello', { token });
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

async function main(): Promise<void> {
  const suffix = Date.now().toString().slice(-6);
  const userA = await login(`甲${suffix}`);
  const userB = await login(`乙${suffix}`);
  console.log(`账号就绪: ${userA.user.nickname} / ${userB.user.nickname}`);

  const a = new TestClient(userA.token);
  const b = new TestClient(userB.token);
  await Promise.all([a.opened, b.opened]);
  await Promise.all([a.waitFor('server:hello'), b.waitFor('server:hello')]);
  console.log('连接与认证通过');

  a.send('client:join_room', { gameId: 'gomoku', maxPlayers: 2 });
  const roomA = await a.waitFor('server:room_view');
  b.send('client:join_room', { gameId: 'gomoku', maxPlayers: 2 });
  const roomB = await b.waitFor('server:room_view');

  assert(roomA.room.roomId === roomB.room.roomId, '两名玩家被匹配到同一房间');
  assert(roomB.room.players.length === 2, '房间内有两名玩家');

  a.send('client:ready', { ready: true });
  b.send('client:ready', { ready: true });
  const started = await a.waitFor('server:snapshot');
  assert(started.status === 'playing', '双方准备后自动开局');

  // 甲执黑先手，走对角线；乙走横线，故意让甲连成五子
  const moves: Array<[TestClient, number, number]> = [
    [a, 0, 0],
    [b, 10, 0],
    [a, 1, 1],
    [b, 10, 1],
    [a, 2, 2],
    [b, 10, 2],
    [a, 3, 3],
    [b, 10, 3],
    [a, 4, 4],
  ];
  for (const [client, x, y] of moves) {
    client.send('client:intent', { cmd: 'place', payload: { x, y } });
    await sleep(150);
  }

  const settlementA = await a.waitFor('server:settlement');
  await b.waitFor('server:settlement');
  const settlement = settlementA.settlement;
  assert(settlement.winners.includes(userA.user.id), '甲连成五子获胜');

  const entryA = settlement.entries.find((e: { playerId: string }) => e.playerId === userA.user.id);
  const entryB = settlement.entries.find((e: { playerId: string }) => e.playerId === userB.user.id);
  assert(entryA?.delta === 100, '胜者积分 +100');
  assert(entryB?.delta === -100, '败者积分 -100');

  await sleep(500);
  const meA = await fetchMe(userA.token);
  const meB = await fetchMe(userB.token);
  assert(meA.balance === 1100, `胜者余额正确 (${meA.balance})`);
  assert(meB.balance === 900, `败者余额正确 (${meB.balance})`);

  // 非法落子应被服务端拒绝
  a.send('client:intent', { cmd: 'place', payload: { x: 0, y: 0 } });
  const error = await a.waitFor('server:error');
  assert(typeof error.message === 'string', `非法操作被拒绝 (${error.message})`);

  a.close();
  b.close();
  console.log('\n全部通过 ✓');
}

main().catch((error) => {
  console.error('\n冒烟测试失败:', error);
  process.exit(1);
});
