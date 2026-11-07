/**
 * 端到端冒烟测试：注册 → 匹配 → 对局 → 结算 → 任务 → 排行榜。
 * 用法：先启动 api-server 与 room-server，再执行 pnpm e2e
 */

const API = process.env.API_BASE ?? 'http://127.0.0.1:8080';
const WS_URL = process.env.WS_BASE ?? 'ws://127.0.0.1:9000/ws';

interface Envelope {
  t: string;
  d: unknown;
}

interface AuthResult {
  token: string;
  user: { id: string; nickname: string; username: string; balance: number };
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`断言失败: ${message}`);
  console.log(`  ✓ ${message}`);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 图形验证码以 SVG 文本渲染，脚本按序提取字符 */
function extractCaptcha(svg: string): string {
  const matches = [...svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map((m) => m[1] ?? '');
  return matches.join('');
}

async function fetchCaptcha(): Promise<{ id: string; code: string }> {
  const res = await fetch(`${API}/api/captcha`);
  if (!res.ok) throw new Error(`获取验证码失败: ${res.status}`);
  const body = (await res.json()) as { id: string; svg: string };
  return { id: body.id, code: extractCaptcha(body.svg) };
}

async function register(usernamePrefix: string, nicknamePrefix: string): Promise<AuthResult> {
  const suffix = Date.now().toString().slice(-6) + Math.floor(Math.random() * 90 + 10);
  const username = `${usernamePrefix}${suffix}`;
  const captcha = await fetchCaptcha();
  const res = await fetch(`${API}/api/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username,
      password: 'test123456',
      nickname: `${nicknamePrefix}${suffix.slice(-4)}`,
      captchaId: captcha.id,
      captcha: captcha.code,
    }),
  });
  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(`注册失败: ${res.status} ${body.error ?? ''}`);
  }
  return (await res.json()) as AuthResult;
}

async function login(username: string, password: string): Promise<AuthResult> {
  const captcha = await fetchCaptcha();
  const res = await fetch(`${API}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, captchaId: captcha.id, captcha: captcha.code }),
  });
  if (!res.ok) {
    const body = (await res.json()) as { error?: string };
    throw new Error(`登录失败: ${res.status} ${body.error ?? ''}`);
  }
  return (await res.json()) as AuthResult;
}

async function fetchMe(token: string): Promise<AuthResult['user']> {
  const res = await fetch(`${API}/api/me`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`获取用户失败: ${res.status}`);
  const body = (await res.json()) as { user: AuthResult['user'] };
  return body.user;
}

async function fetchTasks(token: string): Promise<{ balance: number; tasks: Array<Record<string, any>> }> {
  const res = await fetch(`${API}/api/tasks`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`获取任务失败: ${res.status}`);
  return (await res.json()) as { balance: number; tasks: Array<Record<string, any>> };
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

async function gomokuFlow(): Promise<void> {
  console.log('\n[1/3] 五子棋对局与结算');
  const userA = await register('userA', '甲');
  const userB = await register('userB', '乙');
  assert(userA.user.balance === 1000, '注册赠送 1000 筹码');

  const relogin = await login(userA.user.username, 'test123456');
  assert(relogin.user.id === userA.user.id, '账号密码登录成功');

  const a = new TestClient(userA.token);
  const b = new TestClient(userB.token);
  await Promise.all([a.opened, b.opened]);
  await Promise.all([a.waitFor('server:hello'), b.waitFor('server:hello')]);

  a.send('client:join_room', { gameId: 'gomoku', maxPlayers: 2 });
  const roomA = await a.waitFor('server:room_view');
  b.send('client:join_room', { gameId: 'gomoku', maxPlayers: 2 });
  const roomB = await b.waitFor('server:room_view');
  assert(roomA.room.roomId === roomB.room.roomId, '两名玩家进入同一房间');

  a.send('client:ready', { ready: true });
  b.send('client:ready', { ready: true });
  const started = await a.waitFor('server:snapshot');
  assert(started.status === 'playing', '双方准备后自动开局');

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
  assert(settlementA.settlement.winners.includes(userA.user.id), '甲连成五子获胜');

  await sleep(600);
  const meA = await fetchMe(userA.token);
  const meB = await fetchMe(userB.token);
  assert(meA.balance === 1100, `胜者余额正确 (${meA.balance})`);
  assert(meB.balance === 900, `败者余额正确 (${meB.balance})`);

  a.close();
  b.close();

  console.log('\n[2/3] 任务系统');
  const tasks = await fetchTasks(userA.token);
  const playTask = tasks.tasks.find((t) => t.key === 'daily_play');
  const winTask = tasks.tasks.find((t) => t.key === 'daily_win');
  assert(playTask?.progress === 1, `对局任务进度已累加 (${playTask?.progress})`);
  assert(winTask?.progress === 1, '胜场任务进度已累加');

  const loginTask = tasks.tasks.find((t) => t.key === 'daily_login');
  assert(loginTask?.claimable === true, '每日签到可领取');

  const claimRes = await fetch(`${API}/api/tasks/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${userA.token}` },
    body: JSON.stringify({ key: 'daily_login' }),
  });
  assert(claimRes.ok, '任务奖励领取成功');
  const claimed = (await claimRes.json()) as { balance: number; reward: number };
  assert(claimed.balance === meA.balance + 100, `奖励入账 (${claimed.balance})`);

  const relief = tasks.tasks.find((t) => t.key === 'relief');
  assert(relief?.locked === true, '余额充足时救济金被锁定');

  console.log('\n[3/3] 排行榜');
  const boardRes = await fetch(`${API}/api/leaderboard?limit=10`);
  assert(boardRes.ok, '排行榜接口可访问');
  const board = (await boardRes.json()) as { entries: Array<{ rank: number; title: string; balance: number }> };
  assert(board.entries.length > 0, '排行榜返回数据');
  assert(board.entries[0]?.title === '赌神', `榜首称号为「${board.entries[0]?.title}」`);
  const sorted = board.entries.every((row, i, arr) => i === 0 || arr[i - 1]!.balance >= row.balance);
  assert(sorted, '排行榜按筹码降序');
}

async function multiGameSmoke(): Promise<void> {
  console.log('\n[附加] 多游戏可加载性');
  const res = await fetch(`${API}/api/games`);
  const body = (await res.json()) as { games: Array<{ gameId: string; name: string }> };
  const ids = body.games.map((g) => g.gameId);
  for (const expected of ['gomoku', 'doudizhu', 'paodekuai', 'tuizhuanzi', 'texas']) {
    assert(ids.includes(expected), `已注册游戏：${expected}`);
  }
}

async function main(): Promise<void> {
  await gomokuFlow();
  await multiGameSmoke();
  console.log('\n全部通过 ✓');
}

main().catch((error) => {
  console.error('\n冒烟测试失败:', error);
  process.exit(1);
});
