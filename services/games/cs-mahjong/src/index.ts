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

export interface MahjongVariantConfig {
  meta: GameMeta;
  /** 平胡是否严格要求 2/5/8 硬将（长沙麻将为 true，四川/广东/国标为 false） */
  is258Strict: boolean;
  /** 胡牌后摸鸟/买马张数（0 表示不摸鸟） */
  birdCount: number;
  /** 奖励牌展示文案（如 抓鸟 / 买马） */
  bonusLabel: string;
  /** 基础胡牌底分 */
  baseWin: number;
  /** 番型倍率加成（如四川血战高番玩法） */
  fanBoost: number;
  /** 结算原因标识 */
  settleReason: string;
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

/** 生成 108 张筒条万麻将牌（筒、条、万 各 1~9，每样 4 张） */
function buildMahjongDeck(): MahjongTileData[] {
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

/** 判断是否符合胡牌：将将胡、清一色、七小对/龙七对、碰碰胡或标准平胡 */
function canHu(
  tiles: MahjongTileData[],
  is258Strict: boolean,
): { ok: boolean; type: string; fan: number } {
  if (tiles.length % 3 !== 2) return { ok: false, type: '', fan: 0 };

  const allJiang = tiles.every((t) => t.val === 2 || t.val === 5 || t.val === 8);
  if (allJiang) return { ok: true, type: '将将胡', fan: 3 };

  const sameSuit = tiles.every((t) => t.suit === tiles[0]!.suit);

  // 七小对 / 龙七对
  if (tiles.length === 14) {
    const counts = new Map<string, number>();
    for (const t of tiles) {
      counts.set(`${t.suit}${t.val}`, (counts.get(`${t.suit}${t.val}`) ?? 0) + 1);
    }
    let pairCount = 0;
    let hasQuad = false;
    for (const count of counts.values()) {
      if (count === 4) {
        pairCount += 2;
        hasQuad = true;
      } else if (count === 2) {
        pairCount += 1;
      }
    }
    if (pairCount === 7) {
      if (sameSuit && hasQuad) return { ok: true, type: '清龙七对', fan: 6 };
      if (sameSuit) return { ok: true, type: '清一色七小对', fan: 4 };
      if (hasQuad) return { ok: true, type: '龙七对', fan: 4 };
      return { ok: true, type: '七小对', fan: 2 };
    }
  }

  // 标准拆解：1 个将对 + 若干刻子/顺子
  const counts = new Map<string, number>();
  for (const t of tiles) {
    counts.set(`${t.suit}_${t.val}`, (counts.get(`${t.suit}_${t.val}`) ?? 0) + 1);
  }

  const keys = [...counts.keys()];
  for (const pairKey of keys) {
    if ((counts.get(pairKey) ?? 0) < 2) continue;
    const [, valStr] = pairKey.split('_') as [MahjongSuit, string];
    const val = Number(valStr);

    // 碰碰胡（全刻子）
    const clonePeng = new Map(counts);
    clonePeng.set(pairKey, (clonePeng.get(pairKey) ?? 0) - 2);
    if (canSplitOnlyTriplets(clonePeng)) {
      return {
        ok: true,
        type: sameSuit ? '清一色碰碰胡' : '碰碰胡',
        fan: sameSuit ? 4 : 2,
      };
    }

    // 长沙麻将平胡必须 2/5/8 硬将
    if (is258Strict && !sameSuit && val !== 2 && val !== 5 && val !== 8) continue;

    const clone = new Map(counts);
    clone.set(pairKey, (clone.get(pairKey) ?? 0) - 2);
    if (canSplitSets(clone)) {
      return {
        ok: true,
        type: sameSuit ? '清一色' : '平胡',
        fan: sameSuit ? 3 : 1,
      };
    }
  }

  return { ok: false, type: '', fan: 0 };
}

function canSplitOnlyTriplets(map: Map<string, number>): boolean {
  for (const count of map.values()) {
    if (count > 0 && count !== 3) return false;
  }
  return true;
}

function canSplitSets(map: Map<string, number>): boolean {
  for (const [key, count] of map) {
    if (count <= 0) continue;
    const [suit, valStr] = key.split('_') as [MahjongSuit, string];
    const val = Number(valStr);

    if (count >= 3) {
      map.set(key, count - 3);
      if (canSplitSets(map)) return true;
      map.set(key, count);
    }

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

function handIsFourteen(len: number): boolean {
  return len === 14 || len === 11 || len === 8 || len === 5 || len === 2;
}

class VariantMahjongPlugin extends BaseGamePlugin {
  override readonly meta: GameMeta;
  override readonly commands = ['discard', 'pong', 'kong', 'chow', 'hu', 'pass'] as const;

  private readonly variant: MahjongVariantConfig;
  private state: State = emptyState();

  constructor(variant: MahjongVariantConfig) {
    super();
    this.variant = variant;
    this.meta = variant.meta;
  }

  override onRoomCreate(_ctx: RoomContext): void {
    this.state = emptyState();
  }

  override onRoundStart(ctx: RoomContext): void {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    if (players.length < 2) return;

    this.state = emptyState();
    const deck = shuffleWithSeed(buildMahjongDeck(), ctx.config.seed);

    let cursor = 0;
    for (const player of players) {
      const hand: MahjongTileData[] = [];
      for (let i = 0; i < 13; i++) {
        hand.push(deck[cursor++]!);
      }
      this.state.hands.set(player.playerId, sortHand(hand));
      this.state.melds.set(player.playerId, []);
      this.state.discards.set(player.playerId, []);
    }

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

        const kept = [...hand];
        let removed = 0;
        for (let i = kept.length - 1; i >= 0 && removed < 2; i--) {
          if (kept[i]!.suit === target.suit && kept[i]!.val === target.val) {
            kept.splice(i, 1);
            removed++;
          }
        }
        this.state.hands.set(playerId, sortHand(kept));

        const melds = this.state.melds.get(playerId) ?? [];
        melds.push({ type: 'pong', tiles: [target, matches[0]!, matches[1]!] });
        this.state.melds.set(playerId, melds);

        this.state.turn = playerId;
        this.state.lastDiscard = null;
        break;
      }
      case 'hu': {
        const isSelfDraw = this.state.turn === playerId && handIsFourteen(hand.length);
        const checkTiles = [...hand];
        if (!isSelfDraw && this.state.lastDiscard && this.state.lastDiscard.playerId !== playerId) {
          checkTiles.push(this.state.lastDiscard.tile);
        }
        const res = canHu(checkTiles, this.variant.is258Strict);
        if (!res.ok) throw new Error('当前手牌未达到胡牌标准');

        this.settleHu(ctx, playerId, res.type, res.fan, isSelfDraw);
        return;
      }
      case 'pass': {
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
      this.settleDraw(ctx);
      return;
    }

    const drawn = this.state.wall.shift()!;
    const nextHand = this.state.hands.get(nextPlayer.playerId) ?? [];
    nextHand.push(drawn);
    this.state.hands.set(nextPlayer.playerId, sortHand(nextHand));
    this.state.drawnTile.set(nextPlayer.playerId, drawn);
    this.state.turn = nextPlayer.playerId;
  }

  private settleHu(
    ctx: RoomContext,
    winnerId: string,
    huType: string,
    fan: number,
    isSelfDraw: boolean,
  ): void {
    this.state.settled = true;
    this.state.winners = [winnerId];
    this.state.turn = null;

    const birds: MahjongTileData[] = [];
    for (let i = 0; i < this.variant.birdCount && this.state.wall.length > 0; i++) {
      birds.push(this.state.wall.pop()!);
    }
    this.state.birds = birds;

    let birdHit = 0;
    for (const b of birds) {
      if (b.val === 1 || b.val === 5 || b.val === 9) birdHit++;
    }

    const selfDrawMult = isSelfDraw ? 2 : 1;
    const baseWin = Math.round(
      this.variant.baseWin * fan * this.variant.fanBoost * selfDrawMult * (1 + birdHit),
    );
    const losers = ctx.players.filter((p) => p.playerId !== winnerId);
    const totalWin = baseWin * losers.length;

    const bonusSuffix =
      this.variant.birdCount > 0
        ? ` (${isSelfDraw ? '自摸·' : ''}中${birdHit}${this.variant.bonusLabel})`
        : isSelfDraw
          ? ' (自摸加倍)'
          : ` (${fan}番)`;

    const results: ResultRow[] = ctx.players.map((p) => ({
      playerId: p.playerId,
      nickname: p.nickname,
      delta: p.playerId === winnerId ? totalWin : -baseWin,
      huType: p.playerId === winnerId ? `${huType}${bonusSuffix}` : '未胡',
      birds,
    }));
    this.state.results = results;

    const entries: SettlementEntry[] = ctx.players.map((p) => ({
      playerId: p.playerId,
      currency: 'coin' as const,
      delta: p.playerId === winnerId ? totalWin : -baseWin,
      reason: this.variant.settleReason,
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

  override botIntent(
    _ctx: RoomContext,
    playerId: string,
    _difficulty: BotDifficulty = 'medium',
  ): GameIntent | null {
    if (this.state.settled) return null;
    const hand = this.state.hands.get(playerId) ?? [];

    if (this.state.lastDiscard && this.state.lastDiscard.playerId !== playerId) {
      const check = [...hand, this.state.lastDiscard.tile];
      if (canHu(check, this.variant.is258Strict).ok) {
        return { cmd: 'hu', payload: {} };
      }
    }

    if (this.state.turn === playerId && hand.length > 0) {
      if (canHu(hand, this.variant.is258Strict).ok) {
        return { cmd: 'hu', payload: {} };
      }
      const counts = new Map<string, number>();
      for (const t of hand) {
        counts.set(`${t.suit}${t.val}`, (counts.get(`${t.suit}${t.val}`) ?? 0) + 1);
      }
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

    let canHuFlag = false;
    let canPongFlag = false;
    if (viewerId) {
      if (this.state.turn === viewerId && handIsFourteen(myHand.length)) {
        canHuFlag = canHu(myHand, this.variant.is258Strict).ok;
      } else if (this.state.lastDiscard && this.state.lastDiscard.playerId !== viewerId) {
        canHuFlag = canHu([...myHand, this.state.lastDiscard.tile], this.variant.is258Strict).ok;
        const target = this.state.lastDiscard.tile;
        const matches = myHand.filter((t) => t.suit === target.suit && t.val === target.val);
        canPongFlag = matches.length >= 2;
      }
    }

    return {
      phase: this.state.settled ? 'settled' : 'playing',
      round: ctx.config.round,
      variantId: this.meta.gameId,
      variantName: this.meta.name,
      bonusLabel: this.variant.bonusLabel,
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

export class CsMahjongPlugin extends VariantMahjongPlugin {
  constructor() {
    super({
      meta: {
        gameId: 'cs-mahjong',
        name: '长沙麻将',
        description: '地道湖南长沙麻将，258硬将、将将胡、清一色七小对，开门抓2鸟翻倍',
        icon: '🀄',
        minPlayers: 2,
        maxPlayers: 4,
        version: '1.1.0',
        clientBundle: '',
        tags: ['麻将', '抓鸟', '258将', '国粹'],
        category: 'mahjong',
      },
      is258Strict: true,
      birdCount: 2,
      bonusLabel: '鸟',
      baseWin: 100,
      fanBoost: 1,
      settleReason: 'cs-mahjong.hu',
    });
  }
}

export class ScMahjongPlugin extends VariantMahjongPlugin {
  constructor() {
    super({
      meta: {
        gameId: 'sc-mahjong',
        name: '四川血战麻将',
        description: '巴蜀血战高番玩法，108张筒条万快节奏成胡，清一色龙七对碰碰胡翻倍爽赢',
        icon: '🌶️',
        minPlayers: 2,
        maxPlayers: 4,
        version: '1.0.0',
        clientBundle: '',
        tags: ['麻将', '血战', '高番', '热门'],
        category: 'mahjong',
      },
      is258Strict: false,
      birdCount: 0,
      bonusLabel: '番',
      baseWin: 150,
      fanBoost: 1.5,
      settleReason: 'sc-mahjong.hu',
    });
  }
}

export class GdMahjongPlugin extends VariantMahjongPlugin {
  constructor() {
    super({
      meta: {
        gameId: 'gd-mahjong',
        name: '广东推倒胡',
        description: '岭南经典推倒胡，任意将牌极速开胡，胡牌豪买 4 匹马中马全翻倍',
        icon: '🐎',
        minPlayers: 2,
        maxPlayers: 4,
        version: '1.0.0',
        clientBundle: '',
        tags: ['麻将', '推倒胡', '买马', '爽局'],
        category: 'mahjong',
      },
      is258Strict: false,
      birdCount: 4,
      bonusLabel: '马',
      baseWin: 100,
      fanBoost: 1,
      settleReason: 'gd-mahjong.hu',
    });
  }
}

export class GuobiaoMahjongPlugin extends VariantMahjongPlugin {
  constructor() {
    super({
      meta: {
        gameId: 'guobiao-mahjong',
        name: '大众国标麻将',
        description: '经典竞技国标麻将，碰碰胡、七小对、清一色、自摸翻倍，原汁原味雀坛对决',
        icon: '👑',
        minPlayers: 2,
        maxPlayers: 4,
        version: '1.0.0',
        clientBundle: '',
        tags: ['麻将', '国标', '竞技', '经典'],
        category: 'mahjong',
      },
      is258Strict: false,
      birdCount: 0,
      bonusLabel: '番',
      baseWin: 120,
      fanBoost: 1.2,
      settleReason: 'guobiao-mahjong.hu',
    });
  }
}

export default CsMahjongPlugin;
