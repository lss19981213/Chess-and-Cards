/**
 * 游戏插件规则冒烟测试：直接驱动内置游戏插件 + 动态注册验证。
 * 运行：
 *   pnpm --filter @cc/room-server exec tsx scripts/game-smoke.ts
 *   GAME_ID=dice pnpm --filter @cc/room-server exec tsx scripts/game-smoke.ts
 *   pnpm --filter @cc/room-server exec tsx scripts/game-smoke.ts texas
 */
import type { GamePlugin, PlayerContext, RoomContext, SettlementInput } from '@cc/game-sdk';
import { BaccaratPlugin } from '@cc/game-baccarat';
import { BlackjackPlugin } from '@cc/game-blackjack';
import { ChessPlugin } from '@cc/game-chess';
import { DicePlugin } from '@cc/game-dice';
import { DoudizhuPlugin } from '@cc/game-doudizhu';
import { GoldenFlowerPlugin } from '@cc/game-goldenflower';
import { GomokuPlugin } from '@cc/game-gomoku';
import { NiuniuPlugin } from '@cc/game-niuniu';
import { PaodekuaiPlugin } from '@cc/game-paodekuai';
import { StudPlugin } from '@cc/game-stud';
import { TexasPlugin } from '@cc/game-texas';
import { TuizhuanziPlugin } from '@cc/game-tuizhuanzi';
import { XiangqiPlugin } from '@cc/game-xiangqi';
import { config } from '../src/config';
import { registerBuiltinGames } from '../src/plugins';
import { RoomManager } from '../src/registry';

let failures = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${message}`);
  }
}

function makePlayers(count: number, botFrom = count): PlayerContext[] {
  return Array.from({ length: count }, (_, index) => ({
    playerId: `p${index + 1}`,
    nickname: `玩家${index + 1}`,
    seat: index,
    connected: true,
    isBot: index >= botFrom,
    ...(index >= botFrom ? { botDifficulty: (['low', 'medium', 'high'] as const)[index % 3] } : {}),
  }));
}

interface Harness {
  ctx: RoomContext;
  settled: SettlementInput[];
  charged: number[];
}

function makeCtx(players: PlayerContext[], round = 1, seed = 'a1b2c3d4e5f60718'): Harness {
  const settled: SettlementInput[] = [];
  const charged: number[] = [];
  let seq = 0;
  const ctx: RoomContext = {
    config: {
      roomId: 'room-test',
      gameId: 'test',
      mode: 'casual',
      maxPlayers: players.length,
      round,
      seed,
    },
    players,
    getPlayer: (id: string) => players.find((p) => p.playerId === id),
    broadcast: () => undefined,
    sendTo: () => undefined,
    markDirty: () => undefined,
    settle: (input: SettlementInput) => {
      if (settled.length === 0) settled.push(input);
    },
    charge: async (_playerId: string, amount: number) => {
      charged.push(amount);
      seq += 1;
      return `ref-${seq}`;
    },
    refund: async () => undefined,
    beginRound: () => undefined,
    log: () => undefined,
  };
  return { ctx, settled, charged };
}

function sumDelta(input: SettlementInput | undefined): number {
  if (!input) return Number.NaN;
  return input.entries.reduce((sum, entry) => sum + entry.delta, 0);
}

async function withMockedClock<T>(fn: (advanceMs: (ms: number) => void) => Promise<T>): Promise<T> {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    return await fn((ms) => {
      now += ms;
    });
  } finally {
    Date.now = realNow;
  }
}

async function testBettingGame(name: string, plugin: GamePlugin, area: string): Promise<void> {
  console.log(`\n[${name}]`);
  const players = makePlayers(3, 2); // 2 真人 + 1 机器人
  const { ctx, settled, charged } = makeCtx(players);

  await withMockedClock(async (advanceMs) => {
    plugin.onRoundStart?.(ctx);
    const initial = plugin.getSnapshot(ctx, 'p1') as Record<string, any>;
    assert(initial.phase === 'bet', `${name} 开局进入押注阶段`);

    await plugin.onIntent(ctx, 'p1', { cmd: 'bet', payload: { area, amount: 100 } });
    await plugin.onIntent(ctx, 'p2', { cmd: 'bet', payload: { area, amount: 200 } });
    assert(charged.length === 2, `${name} 真人下注即时扣款`);

    // 推进阶段倒计时（最多经过 play / settle 等多个短阶段）
    for (let i = 0; i < 6 && settled.length === 0; i += 1) {
      advanceMs(35_000);
      plugin.onTick?.(ctx, 200);
    }

    assert(settled.length === 1, `${name} 倒计时结束后正常结算`);
    assert(
      settled[0]!.entries.some((e) => e.playerId === 'p1') &&
        settled[0]!.entries.some((e) => e.playerId === 'p2'),
      `${name} 下注玩家均进入结算条目`,
    );
  });
}

function testPaodekuai(): void {
  console.log('\n[跑得快]');
  const players = makePlayers(3);
  const plugin = new PaodekuaiPlugin();
  const { ctx } = makeCtx(players);

  plugin.onRoundStart(ctx);
  const views = players.map((p) => plugin.getSnapshot(ctx, p.playerId) as Record<string, any>);
  const handSizes = views.map((v) => (v.myHand as unknown[]).length);
  assert(handSizes.every((size) => size === 16), `每人 16 张（${handSizes.join(',')}）`);

  const ids = views.flatMap((v) => (v.myHand as Array<{ id: string }>).map((c) => c.id));
  assert(new Set(ids).size === 48, '48 张牌无重复');

  const turn = views[0]!.turn as string;
  const starterIndex = players.findIndex((p) => p.playerId === turn);
  const hand = views[starterIndex]!.myHand as Array<{ id: string; rank: number }>;
  const single = hand[hand.length - 1]!;
  plugin.onIntent(ctx, turn, { cmd: 'play', payload: { cards: [single.id] } });

  const afterPlay = plugin.getSnapshot(ctx, turn) as Record<string, any>;
  assert((afterPlay.myHand as unknown[]).length === 15, '出单张后手牌减少');
  assert(afterPlay.lastCombo !== null, '场上有待压的牌');
}

function testDoudizhu(): void {
  console.log('\n[斗地主]');
  const players = makePlayers(3);
  const plugin = new DoudizhuPlugin();
  const { ctx } = makeCtx(players);

  plugin.onRoundStart(ctx);
  const initView = plugin.getSnapshot(ctx, 'p1') as Record<string, any>;
  assert(initView.phase === 'bidding', '开局进入叫分抢地主阶段');
  assert(initView.turn === 'p1', '叫分阶段由首家开始');

  // p1 直接叫 3 分抢地主，立即进入加倍阶段并获得底牌
  plugin.onIntent(ctx, 'p1', { cmd: 'bid', payload: { score: 3 } });
  const views = players.map((p) => plugin.getSnapshot(ctx, p.playerId) as Record<string, any>);

  assert(views[0]!.landlordId === 'p1', '叫3分者成为地主');
  assert((views[0]!.myHand as unknown[]).length === 20, '地主 20 张');
  assert((views[1]!.myHand as unknown[]).length === 17, '农民 17 张');
  assert((views[0]!.bottomCards as unknown[]).length === 3, '底牌三张公开');

  const total = views.reduce((sum, view) => sum + (view.myHand as unknown[]).length, 0);
  assert(total === 54, '总牌数 54');

  // 完成加倍阶段
  let guard = 0;
  while (guard < 6) {
    const snap = plugin.getSnapshot(ctx, 'p1') as Record<string, any>;
    if (snap.phase !== 'doubling') break;
    const actor = snap.turn as string;
    plugin.onIntent(ctx, actor, { cmd: 'double', payload: { factor: actor === 'p2' ? 2 : 1 } });
    guard += 1;
  }

  const playingSnap = plugin.getSnapshot(ctx, 'p1') as Record<string, any>;
  assert(playingSnap.phase === 'playing' && playingSnap.turn === 'p1', '加倍后进入出牌阶段由地主先出');

  const landlordHand = playingSnap.myHand as Array<{ id: string; rank: number }>;
  const lowest = landlordHand[landlordHand.length - 1]!;
  plugin.onIntent(ctx, 'p1', { cmd: 'play', payload: { cards: [lowest.id] } });
  const after = plugin.getSnapshot(ctx, 'p1') as Record<string, any>;
  assert(after.turn !== 'p1', '出牌后轮到下家');
}

async function testTexas(): Promise<void> {
  console.log('\n[德州扑克]');
  const players = makePlayers(2);
  const plugin = new TexasPlugin();
  const { ctx, settled } = makeCtx(players);

  await plugin.onRoundStart(ctx);
  const view = plugin.getSnapshot(ctx, 'p1') as Record<string, any>;

  assert((view.myHand as unknown[]).length === 2, '每人两张底牌');
  assert(view.pot === 150, `盲注入池（${view.pot}）`);
  assert(view.toCall === 50, '小盲需补 50 跟注');

  await plugin.onIntent(ctx, 'p1', { cmd: 'call', payload: {} });
  const afterCall = plugin.getSnapshot(ctx, 'p1') as Record<string, any>;
  assert(afterCall.turn === 'p2', '跟注后轮到大盲');

  await plugin.onIntent(ctx, 'p2', { cmd: 'check', payload: {} });
  const flop = plugin.getSnapshot(ctx, 'p1') as Record<string, any>;
  assert(flop.phase === 'flop', '进入翻牌圈');
  assert((flop.community as unknown[]).length === 3, '翻牌三张公共牌');

  let guard = 0;
  while (!settled[0] && guard < 20) {
    guard += 1;
    const current = plugin.getSnapshot(ctx, 'p1') as Record<string, any>;
    const turn = current.turn as string | null;
    if (!turn) break;
    await plugin.onIntent(ctx, turn, { cmd: 'check', payload: {} });
  }

  assert(settled.length === 1, '四轮下注后摊牌结算');
  assert(sumDelta(settled[0]) === 0, '德州结算零和');
}

async function testBotMatch(
  name: string,
  plugin: GamePlugin,
  playerCount: number,
  maxSteps = 500,
  requireZeroSum = true,
): Promise<void> {
  console.log(`\n[机器人：${name}]`);
  const players = makePlayers(playerCount, 0);
  const { ctx, settled } = makeCtx(players);
  plugin.onRoundStart?.(ctx);

  let steps = 0;
  while (settled.length === 0 && steps < maxSteps) {
    const actor = plugin.getCurrentActor?.(ctx) ?? null;
    if (!actor) break;
    const diff = ctx.getPlayer(actor)?.botDifficulty ?? 'medium';
    const intent = plugin.botIntent?.(ctx, actor, diff) ?? null;
    if (!intent) break;
    await plugin.onIntent(ctx, actor, intent);
    steps += 1;
  }

  assert(steps > 0, `${name} 机器人推进 ${steps} 步`);
  assert(settled.length === 1 || steps >= 20, `${name} 机器人可稳定对局（settled=${settled.length}）`);
  if (requireZeroSum && settled[0]) {
    assert(sumDelta(settled[0]) === 0, `${name} 结算零和`);
  }
}

async function testDynamicRegistry(filter?: string): Promise<void> {
  console.log('\n[动态插件注册]');
  const manager = new RoomManager(
    config,
    () => undefined,
    async () => 1000,
    async () => 0,
  );
  const loaded = await registerBuiltinGames(manager);
  const games = manager.listGames().map((g) => g.gameId);
  assert(loaded.length >= 15 && games.length >= 15, `动态加载游戏插件（${games.length} 款）`);
  assert(manager.list().length >= 15, `常驻平台台自动初始化（${manager.list().length} 桌）`);
  if (filter) {
    assert(
      manager.hasGame(filter) || games.some((id) => id.includes(filter)),
      `过滤器 ${filter} 对应游戏已注册`,
    );
    // 单游戏运营态：禁用后不可 join 语义由 status 表达
    const target = manager.hasGame(filter) ? filter : games.find((id) => id.includes(filter))!;
    manager.setGameOps(target, 'disabled', '冒烟：临时下架');
    const meta = manager.listGames().find((g) => g.gameId === target);
    assert(meta?.status === 'disabled', `${target} status=disabled`);
    manager.setGameOps(target, 'enabled');
  }
  manager.shutdown();
}

/** 是否应跑该用例（无过滤器时全跑） */
function matchFilter(filter: string | undefined, ...keys: string[]): boolean {
  if (!filter) return true;
  const f = filter.toLowerCase();
  return keys.some((k) => k.toLowerCase().includes(f) || f.includes(k.toLowerCase()));
}

async function main(): Promise<void> {
  const filter = (process.env.GAME_ID || process.argv[2] || '').trim() || undefined;
  if (filter) console.log(`\n[过滤器] GAME_ID=${filter}`);

  await testDynamicRegistry(filter);

  if (matchFilter(filter, 'tuizhuanzi', '推筒子')) {
    await testBettingGame('推筒子', new TuizhuanziPlugin(), 'heaven');
  }
  if (matchFilter(filter, 'baccarat', '百家乐')) {
    await testBettingGame('百家乐', new BaccaratPlugin(), 'player');
  }
  if (matchFilter(filter, 'dice', '骰宝')) {
    await testBettingGame('百人骰宝', new DicePlugin(), 'big');
  }
  if (matchFilter(filter, 'niuniu', '斗牛', '牛牛')) {
    await testBettingGame('百人牛牛', new NiuniuPlugin(), 'niu-1');
  }
  if (matchFilter(filter, 'blackjack', '21')) {
    await testBettingGame('21 点', new BlackjackPlugin(), 'win');
  }

  if (matchFilter(filter, 'paodekuai', '跑得快')) testPaodekuai();
  if (matchFilter(filter, 'doudizhu', '斗地主')) testDoudizhu();
  if (matchFilter(filter, 'texas', '德州')) await testTexas();

  if (matchFilter(filter, 'gomoku', '五子棋')) {
    console.log('\n[五子棋]');
    const gPlugin = new GomokuPlugin();
    const { ctx: gCtx, settled: gSettled } = makeCtx(makePlayers(2));
    gPlugin.onRoundStart(gCtx);
    for (let i = 0; i < 5; i += 1) {
      gPlugin.onIntent(gCtx, 'p1', { cmd: 'place', payload: { x: i, y: 0 } });
      if (i < 4) gPlugin.onIntent(gCtx, 'p2', { cmd: 'place', payload: { x: i, y: 1 } });
    }
    assert(gSettled.length === 1 && gSettled[0]?.winners[0] === 'p1', '先连成五子者胜');
    await testBotMatch('五子棋', new GomokuPlugin(), 2, 40, false);
  }

  if (matchFilter(filter, 'chess', '国际象棋')) {
    await testBotMatch('国际象棋', new ChessPlugin(), 2, 30, false);
  }
  if (matchFilter(filter, 'xiangqi', '中国象棋')) {
    await testBotMatch('中国象棋', new XiangqiPlugin(), 2, 30, false);
  }
  if (matchFilter(filter, 'doudizhu', '斗地主') && !filter) {
    /* 全量时上面已跑规则，下面补机器人 */
  }
  if (matchFilter(filter, 'doudizhu', '斗地主')) {
    await testBotMatch('斗地主', new DoudizhuPlugin(), 3, 500, true);
  }
  if (matchFilter(filter, 'paodekuai', '跑得快')) {
    await testBotMatch('跑得快', new PaodekuaiPlugin(), 3, 500, true);
  }
  if (matchFilter(filter, 'goldenflower', '扎金花', '翻金花')) {
    await testBotMatch('扎金花', new GoldenFlowerPlugin(), 3, 120, true);
  }
  if (matchFilter(filter, 'stud', '梭哈')) {
    await testBotMatch('五张梭哈', new StudPlugin(), 3, 120, true);
  }
  if (matchFilter(filter, 'texas', '德州')) {
    await testBotMatch('德州扑克', new TexasPlugin(), 3, 120, true);
  }

  console.log('');
  if (failures > 0) {
    console.error(`失败 ${failures} 项`);
    process.exit(1);
  }
  console.log(filter ? `过滤器 ${filter} 通过 ✓` : '全部通过 ✓');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
