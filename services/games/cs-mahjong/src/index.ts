import type { BotDifficulty, GameMeta, GameSnapshot, SettlementEntry } from '@cc/protocol';
import type { GameIntent, RoomContext } from '@cc/game-sdk';
import { BaseGamePlugin, shuffleWithSeed } from '@cc/game-sdk';

export type MahjongSuit = 'dot' | 'bamboo' | 'wan';

export interface MahjongTileData {
  id: string;
  suit: MahjongSuit;
  val: number;
}

export interface Meld {
  type: 'pong' | 'kong' | 'chow';
  tiles: MahjongTileData[];
}

interface ResultRow {
  playerId: string;
  nickname: string;
  delta: number;
  huType: string;
  birds: MahjongTileData[];
}

interface State {
  wall: MahjongTileData[];
  hands: Map<string, MahjongTileData[]>;
  melds: Map<string, Meld[]>;
  discards: Map<string, MahjongTileData[]>;
  turn: string | null;
  lastDiscard: { playerId: string; tile: MahjongTileData } | null;
  settled: boolean;
  winners: string[];
  birds: MahjongTileData[];
  results: ResultRow[];
  drawnTile: Map<string, MahjongTileData | null>;
}

function emptyState(): State {
  return {
    wall: [],
    hands: new Map(),
    melds: new Map(),
    discards: new Map(),
    turn: null,
    lastDiscard: null,
    settled: false,
    winners: [],
    birds: [],
    results: [],
    drawnTile: new Map(),
  };
}

/** 生成 108 张长沙麻将牌（筒、条、万 各 1~9，每样 4 张） */
function buildCsMahjongDeck(): MahjongTileData[] {
  const suits: MahjongSuit[] = ['dot', 'bamboo', 'wan'];
  const deck: MahjongTileData[] = [];
  for (const suit of suits) {
    for (let val = 1; val <= 9; val++) {
      for (let copy = 0; copy < 4; copy++) {
        deck.push({ id: `${suit}${val}_${copy}`, suit, val });
      }
    }
  }
  return deck;
}

function sortHand(tiles: MahjongTileData[]): MahjongTileData[] {
  const suitOrder: Record<MahjongSuit, number> = { wan: 1, bamboo: 2, dot: 3 };
  return [...tiles].sort((a, b) => {
    if (a.suit !== b.suit) return suitOrder[a.suit] - suitOrder[b.suit];
    return a.val - b.val;
  });
}

/** 判断是否符合胡牌：七对、碰碰胡、清一色、将将胡或基本胡 */
function canHu(tiles: MahjongTileData[], is258Strict = true): { ok: boolean; type: string } {
  if (tiles.length % 3 !== 2) return { ok: false, type: '' };

  // 1. 将将胡（全2、5、8）
  const allJiang = tiles.every((t) => t.val === 2 || t.val === 5 || t.val === 8);
  if (allJiang) return { ok: true, type: '将将胡' };

  // 2. 清一色
  const sameSuit = tiles.every((t) => t.suit === tiles[0]!.suit);

  // 3. 七小对（14张牌 7 对）
  if (tiles.length === 14) {
    const counts = new Map<string, number>();
    for (const t of tiles) counts.set(`${t.suit}${t.val}`, (counts.get(`${t.suit}${t.val}`) ?? 0) + 1);
    let pairCount = 0;
    for (const count of counts.values()) {
      if (count === 2 || count === 4) pairCount += Math.floor(count / 2);
    }
    if (pairCount === 7) {
      return { ok: true, type: sameSuit ? '清一色七小对' : '七小对' };
    }
  }

  // 4. 标准拆解：1个将对 + 若干顺子/刻子
  const counts = new Map<string, number>();
  for (const t of tiles) counts.set(`${t.suit}_${t.val}`, (counts.get(`${t.suit}_${t.val}`) ?? 0) + 1);

  const keys = [...counts.keys()];
  for (const pairKey of keys) {
    if ((counts.get(pairKey) ?? 0) < 2) continue;
    const [, valStr] = pairKey.split('_') as [MahjongSuit, string];
    const val = Number(valStr);

    // 长沙麻将平胡必须 2、5、8 做将（硬将）
    if (is258Strict && !sameSuit && val !== 2 && val !== 5 && val !== 8) continue;

    // 扣除这组将牌，递归检验剩余牌能否全拆成 刻子 或 顺子
    const clone = new Map(counts);
    clone.set(pairKey, (clone.get(pairKey) ?? 0) - 2);
    if (canSplitSets(clone)) {
      return { ok: true, type: sameSuit ? '清一色' : '平胡' };
    }
  }

  return { ok: false, type: '' };
}

function canSplitSets(map: Map<string, number>): boolean {
  for (const [key, count] of map) {
    if (count <= 0) continue;
    const [suit, valStr] = key.split('_') as [MahjongSuit, string];
    const val = Number(valStr);

    // 尝试作刻子 (3张一样)
    if (count >= 3) {
      map.set(key, count - 3);
      if (canSplitSets(map)) return true;
      map.set(key, count);
    }

    // 尝试作顺子 (val, val+1, val+2)
    if (val <= 7) {
      const k2 = `${suit}_${val + 1}`;
      const k3 = `${suit}_${val + 2}`;
      const c2 = map.get(k2) ?? 0;
      const c3 = map.get(k3) ?? 0;
      if (c2 > 0 && c3 > 0) {
        map.set(key, count - 1);
        map.set(k2, c2 - 1);
        map.set(k3, c3 - 1);
        if (canSplitSets(map)) return true;
        map.set(key, count);
        map.set(k2, c2);
        map.set(k3, c3);
      }
    }
    return false;
  }
  return true;
}

export class CsMahjongPlugin extends BaseGamePlugin {
  override readonly meta: GameMeta = {
    gameId: 'cs-mahjong',
    name: '长沙麻将',
    description: '地道湖南长沙麻将，大四喜板板胡起手小胡，碰碰胡将将胡清一色，开门抓鸟',
    icon: '🀄',
    minPlayers: 2,
    maxPlayers: 4,
    version: '1.0.0',
    clientBundle: '',
    tags: ['麻将', '多人', '竞技', '国粹'],
    category: 'table',
  };

  override readonly commands = ['discard', 'pong', 'kong', 'chow', 'hu', 'pass'] as const;

  private state: State = emptyState();

  override onRoomCreate(_ctx: RoomContext): void {
    this.state = emptyState();
  }

  override onRoundStart(ctx: RoomContext): void {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    if (players.length < 2) return;

    this.state = emptyState();
    const deck = shuffleWithSeed(buildCsMahjongDeck(), ctx.config.seed);

    let cursor = 0;
    // 起手发牌：每人 13 张
    for (const player of players) {
      const hand: MahjongTileData[] = [];
      for (let i = 0; i < 13; i++) {
        hand.push(deck[cursor++]!);
      }
      this.state.hands.set(player.playerId, sortHand(hand));
      this.state.melds.set(player.playerId, []);
      this.state.discards.set(player.playerId, []);
    }

    // 庄家(首家)补摸第 14 张牌
    const dealer = players[0]!;
    const dealerDrawn = deck[cursor++]!;
    const dealerHand = this.state.hands.get(dealer.playerId) ?? [];
    dealerHand.push(dealerDrawn);
    this.state.hands.set(dealer.playerId, sortHand(dealerHand));
    this.state.drawnTile.set(dealer.playerId, dealerDrawn);

    this.state.wall = deck.slice(cursor);
    this.state.turn = dealer.playerId;
    ctx.markDirty();
  }

  override async onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): Promise<void> {
    if (this.state.settled) throw new Error('本局已结束');

    const hand = this.state.hands.get(playerId) ?? [];

    switch (intent.cmd) {
      case 'discard': {
        if (this.state.turn !== playerId) throw new Error('还没轮到你出牌');
        const tileId = String(intent.payload?.tileId ?? '');
        const index = hand.findIndex((t) => t.id === tileId);
        if (index < 0) throw new Error('手牌中没有该牌');
        const [discarded] = hand.splice(index, 1);
        if (!discarded) throw new Error('出牌失败');

        this.state.hands.set(playerId, sortHand(hand));
        const playerDiscards = this.state.discards.get(playerId) ?? [];
        playerDiscards.push(discarded);
        this.state.discards.set(playerId, playerDiscards);

        this.state.lastDiscard = { playerId, tile: discarded };
        this.state.drawnTile.set(playerId, null);

        // 出牌后流转给下家摸牌
        this.advanceToNextDraw(ctx, playerId);
        break;
      }
      case 'pong': {
        if (!this.state.lastDiscard || this.state.lastDiscard.playerId === playerId) {
          throw new Error('没有可以碰的牌');
        }
        const target = this.state.lastDiscard.tile;
        const matches = hand.filter((t) => t.suit === target.suit && t.val === target.val);
        if (matches.length < 2) throw new Error('手牌不足两张相同牌，无法碰牌');

        // 移除手牌中2张
        const kept = [...hand];
        let removed = 0;
        for (let i = kept.length - 1; i >= 0 && removed < 2; i--) {
          if (kept[i]!.suit === target.suit && kept[i]!.val === target.val) {
            kept.splice(i, 1);
            removed++;
          }
        }
        this.state.hands.set(playerId, sortHand(kept));

        // 记录碰面子
        const melds = this.state.melds.get(playerId) ?? [];
        melds.push({ type: 'pong', tiles: [target, matches[0]!, matches[1]!] });
        this.state.melds.set(playerId, melds);

        // 轮到碰牌玩家出牌
        this.state.turn = playerId;
        this.state.lastDiscard = null;
        break;
      }
      case 'hu': {
        const checkTiles = [...hand];
        if (this.state.lastDiscard && this.state.lastDiscard.playerId !== playerId) {
          checkTiles.push(this.state.lastDiscard.tile);
        }
        const res = canHu(checkTiles);
        if (!res.ok) throw new Error('当前手牌未达到胡牌标准');

        this.settleHu(ctx, playerId, res.type);
        return;
      }
      case 'pass': {
        // 玩家过牌，继续流程
        break;
      }
      default:
        throw new Error(`未知操作: ${intent.cmd}`);
    }

    ctx.markDirty();
  }

  private advanceToNextDraw(ctx: RoomContext, currentId: string): void {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const currIndex = players.findIndex((p) => p.playerId === currentId);
    const nextPlayer = players[(currIndex + 1) % players.length]!;

    if (this.state.wall.length === 0) {
      // 黄庄 / 荒庄
      this.settleDraw(ctx);
      return;
    }

    // 下家摸牌
    const drawn = this.state.wall.shift()!;
    const nextHand = this.state.hands.get(nextPlayer.playerId) ?? [];
    nextHand.push(drawn);
    this.state.hands.set(nextPlayer.playerId, sortHand(nextHand));
    this.state.drawnTile.set(nextPlayer.playerId, drawn);
    this.state.turn = nextPlayer.playerId;
  }

  private settleHu(ctx: RoomContext, winnerId: string, huType: string): void {
    this.state.settled = true;
    this.state.winners = [winnerId];
    this.state.turn = null;

    // 扎鸟：从牌墙末尾摸 2 张鸟牌
    const birds: MahjongTileData[] = [];
    for (let i = 0; i < 2 && this.state.wall.length > 0; i++) {
      birds.push(this.state.wall.pop()!);
    }
    this.state.birds = birds;

    // 鸟牌加倍分：1, 5, 9 中鸟算 1 个加倍
    let birdHit = 0;
    for (const b of birds) {
      if (b.val === 1 || b.val === 5 || b.val === 9) birdHit++;
    }

    const baseWin = 100 * (1 + birdHit);
    const losers = ctx.players.filter((p) => p.playerId !== winnerId);
    const totalWin = baseWin * losers.length;

    const results: ResultRow[] = ctx.players.map((p) => ({
      playerId: p.playerId,
      nickname: p.nickname,
      delta: p.playerId === winnerId ? totalWin : -baseWin,
      huType: p.playerId === winnerId ? `${huType} (中${birdHit}鸟)` : '未胡',
      birds,
    }));
    this.state.results = results;

    const entries: SettlementEntry[] = ctx.players.map((p) => ({
      playerId: p.playerId,
      currency: 'coin' as const,
      delta: p.playerId === winnerId ? totalWin : -baseWin,
      reason: 'cs-mahjong.hu',
    }));

    ctx.markDirty();
    ctx.settle({ entries, winners: [winnerId] });
  }

  private settleDraw(ctx: RoomContext): void {
    this.state.settled = true;
    this.state.winners = [];
    this.state.turn = null;
    this.state.results = ctx.players.map((p) => ({
      playerId: p.playerId,
      nickname: p.nickname,
      delta: 0,
      huType: '黄庄 (海底无牌)',
      birds: [],
    }));
    ctx.settle({ entries: [], winners: [] });
    ctx.markDirty();
  }

  override botIntent(ctx: RoomContext, playerId: string, _difficulty: BotDifficulty = 'medium'): GameIntent | null {
    if (this.state.settled) return null;
    const hand = this.state.hands.get(playerId) ?? [];

    // 1. 如果有人刚打出牌，检查是否可胡
    if (this.state.lastDiscard && this.state.lastDiscard.playerId !== playerId) {
      const check = [...hand, this.state.lastDiscard.tile];
      if (canHu(check).ok) {
        return { cmd: 'hu', payload: {} };
      }
    }

    // 2. 如果轮到自己出牌
    if (this.state.turn === playerId && hand.length > 0) {
      // 检查自己是否自摸胡
      if (canHu(hand).ok) {
        return { cmd: 'hu', payload: {} };
      }
      // 出一张孤张单牌
      const counts = new Map<string, number>();
      for (const t of hand) counts.set(`${t.suit}${t.val}`, (counts.get(`${t.suit}${t.val}`) ?? 0) + 1);
      const isolated = hand.find((t) => (counts.get(`${t.suit}${t.val}`) ?? 0) === 1);
      const chosen = isolated ?? hand[hand.length - 1]!;
      return { cmd: 'discard', payload: { tileId: chosen.id } };
    }

    return null;
  }

  override getSnapshot(ctx: RoomContext, viewerId: string | null): GameSnapshot {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const myHand = viewerId ? this.state.hands.get(viewerId) ?? [] : [];
    const myDrawn = viewerId ? this.state.drawnTile.get(viewerId) ?? null : null;

    // 检查当前玩家是否可操作 (胡、碰)
    let canHuFlag = false;
    let canPongFlag = false;
    if (viewerId) {
      if (this.state.turn === viewerId && handIsFourteen(myHand.length)) {
        canHuFlag = canHu(myHand).ok;
      } else if (this.state.lastDiscard && this.state.lastDiscard.playerId !== viewerId) {
        canHuFlag = canHu([...myHand, this.state.lastDiscard.tile]).ok;
        const target = this.state.lastDiscard.tile;
        const matches = myHand.filter((t) => t.suit === target.suit && t.val === target.val);
        canPongFlag = matches.length >= 2;
      }
    }

    return {
      phase: this.state.settled ? 'settled' : 'playing',
      round: ctx.config.round,
      turn: this.state.turn,
      remainingCount: this.state.wall.length,
      lastDiscard: this.state.lastDiscard,
      myHand,
      myDrawn,
      canHu: canHuFlag,
      canPong: canPongFlag,
      birds: this.state.birds,
      winners: this.state.winners,
      results: this.state.results,
      players: players.map((p) => {
        const hand = this.state.hands.get(p.playerId) ?? [];
        const melds = this.state.melds.get(p.playerId) ?? [];
        const discards = this.state.discards.get(p.playerId) ?? [];
        return {
          playerId: p.playerId,
          nickname: p.nickname,
          seat: p.seat,
          isBot: p.isBot,
          cardCount: hand.length,
          melds,
          discards,
          hand: this.state.settled || p.playerId === viewerId ? hand : [],
        };
      }),
    };
  }

  override getCurrentActor(): string | null {
    return this.state.settled ? null : this.state.turn;
  }
}

function handIsFourteen(len: number): boolean {
  return len === 14 || len === 11 || len === 8 || len === 5 || len === 2;
}

export default CsMahjongPlugin;
