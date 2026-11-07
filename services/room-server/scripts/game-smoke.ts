/**
 * 游戏插件规则冒烟测试：直接驱动插件，不经过网络。
 * 运行：pnpm --filter @cc/room-server exec tsx scripts/game-smoke.ts
 */
import type { PlayerContext, RoomContext, SettlementInput } from '@cc/game-sdk';
import { DoudizhuPlugin } from '@cc/game-doudizhu';
import { PaodekuaiPlugin } from '@cc/game-paodekuai';
import { TuizhuanziPlugin } from '@cc/game-tuizhuanzi';
import { TexasPlugin } from '@cc/game-texas';
import { GomokuPlugin } from '@cc/game-gomoku';

let failures = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${message}`);
  }
}

function makePlayers(count: number): PlayerContext[] {
  return Array.from({ length: count }, (_, index) => ({
    playerId: `p${index + 1}`,
    nickname: `玩家${index + 1}`,
    seat: index,
    connected: true,
  }));
}

interface Harness {
  ctx: RoomContext;
  settled: SettlementInput[];
}

function makeCtx(players: PlayerContext[], round = 1, seed = 'a1b2c3d4e5f60718'): Harness {
  const settled: SettlementInput[] = [];
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
    log: () => undefined,
  };
  return { ctx, settled };
}

function sumDelta(input: SettlementInput | undefined): number {
  if (!input) return Number.NaN;
  return input.entries.reduce((sum, entry) => sum + entry.delta, 0);
}

function testTuizhuanzi(): void {
  console.log('\n[推筒子]');
  const players = makePlayers(3);
  const plugin = new TuizhuanziPlugin();
  const { ctx, settled } = makeCtx(players);

  plugin.onRoundStart(ctx);
  const initial = plugin.getSnapshot(ctx, 'p2') as Record<string, any>;
  assert(initial.phase === 'bet', '开局进入押注阶段');
  assert(initial.bankerId === 'p1', '座位最小者坐庄');

  plugin.onIntent(ctx, 'p2', { cmd: 'bet', payload: { amount: 200 } });
  plugin.onIntent(ctx, 'p3', { cmd: 'bet', payload: { amount: 100 } });

  assert(settled.length === 1, '全部押注后自动开牌结算');
  assert(sumDelta(settled[0]) === 0, '庄闲结算零和');
  assert(ctx.players.every((p) => settled[0]?.entries.some((e) => e.playerId === p.playerId)), '所有玩家都有结算条目');

  const after = plugin.getSnapshot(ctx, 'p2') as Record<string, any>;
  assert(after.phase === 'reveal', '开牌后进入亮牌阶段');
  assert(after.players.every((p: { cards: unknown[] }) => p.cards.length === 2), '每人两张牌');
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
  const myView = views.find((v) => {
    const player = players.find((p) => p.playerId === turn);
    return player ? v.myHand && views[players.indexOf(player)] === v : false;
  });
  assert(myView !== undefined, '存在首个出牌玩家');

  const starterIndex = players.findIndex((p) => p.playerId === turn);
  const starterView = views[starterIndex]!;
  const hand = starterView.myHand as Array<{ id: string; rank: number }>;
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
  const views = players.map((p) => plugin.getSnapshot(ctx, p.playerId) as Record<string, any>);

  assert(views[0]!.landlordId === 'p1', '座位最小者为地主');
  assert((views[0]!.myHand as unknown[]).length === 20, '地主 20 张');
  assert((views[1]!.myHand as unknown[]).length === 17, '农民 17 张');
  assert((views[0]!.bottomCards as unknown[]).length === 3, '底牌三张公开');

  const total = views.reduce((sum, view) => sum + (view.myHand as unknown[]).length, 0);
  assert(total === 54, '总牌数 54');

  const landlordHand = views[0]!.myHand as Array<{ id: string; rank: number }>;
  const lowest = landlordHand[landlordHand.length - 1]!;
  plugin.onIntent(ctx, 'p1', { cmd: 'play', payload: { cards: [lowest.id] } });
  const after = plugin.getSnapshot(ctx, 'p1') as Record<string, any>;
  assert(after.turn !== 'p1', '出牌后轮到下家');
}

function testTexas(): void {
  console.log('\n[德州扑克]');
  const players = makePlayers(2);
  const plugin = new TexasPlugin();
  const { ctx, settled } = makeCtx(players);

  plugin.onRoundStart(ctx);
  const view = plugin.getSnapshot(ctx, 'p1') as Record<string, any>;

  assert((view.myHand as unknown[]).length === 2, '每人两张底牌');
  assert(view.pot === 150, `盲注入池（${view.pot}）`);
  assert(view.toCall === 50, '小盲需补 50 跟注');

  plugin.onIntent(ctx, 'p1', { cmd: 'call', payload: {} });
  const afterCall = plugin.getSnapshot(ctx, 'p1') as Record<string, any>;
  assert(afterCall.turn === 'p2', '跟注后轮到大盲');

  plugin.onIntent(ctx, 'p2', { cmd: 'check', payload: {} });
  const flop = plugin.getSnapshot(ctx, 'p1') as Record<string, any>;
  assert(flop.phase === 'flop', '进入翻牌圈');
  assert((flop.community as unknown[]).length === 3, '翻牌三张公共牌');

  // 翻牌后连续过牌走到摊牌
  let guard = 0;
  while (!settled[0] && guard < 20) {
    guard += 1;
    const current = plugin.getSnapshot(ctx, 'p1') as Record<string, any>;
    const turn = current.turn as string | null;
    if (!turn) break;
    plugin.onIntent(ctx, turn, { cmd: 'check', payload: {} });
  }

  assert(settled.length === 1, '四轮下注后摊牌结算');
  assert(sumDelta(settled[0]) === 0, '德州结算零和');
}

function testGomokuStillWorks(): void {
  console.log('\n[五子棋回归]');
  const players = makePlayers(2);
  const plugin = new GomokuPlugin();
  const { ctx, settled } = makeCtx(players);
  plugin.onRoundStart(ctx);
  for (let i = 0; i < 5; i += 1) {
    plugin.onIntent(ctx, 'p1', { cmd: 'place', payload: { x: i, y: 0 } });
    if (i < 4) plugin.onIntent(ctx, 'p2', { cmd: 'place', payload: { x: i, y: 1 } });
  }
  assert(settled.length === 1, '五连后触发结算');
  assert(settled[0]?.winners[0] === 'p1', '先连成五子者胜');
}

testTuizhuanzi();
testPaodekuai();
testDoudizhu();
testTexas();
testGomokuStillWorks();

console.log('');
if (failures > 0) {
  console.error(`失败 ${failures} 项`);
  process.exit(1);
}
console.log('全部通过 ✓');
