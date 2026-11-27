import type { GameMeta, PlayerView, RoomStatus, RoomSummary, RoomView, SpectatorView, StakesTier, TrendMark } from '@cc/protocol';
import type { GamePlugin, PlayerContext, RoomContext } from '@cc/game-sdk';
import type { Seat, Spectator } from './types';

export function toPlayerContexts(seats: Iterable<Seat>): PlayerContext[] {
  return [...seats]
    .sort((a, b) => a.seat - b.seat)
    .map((s) => ({
      playerId: s.playerId,
      nickname: s.nickname,
      seat: s.seat,
      connected: s.socket !== null || s.isBot,
      isBot: s.isBot,
      ...(s.isBot ? { botDifficulty: s.botDifficulty ?? 'high' } : {}),
    }));
}

export function toPlayerViews(seats: Iterable<Seat>): PlayerView[] {
  return [...seats]
    .sort((a, b) => a.seat - b.seat)
    .map((s) => ({
      playerId: s.playerId,
      nickname: s.nickname,
      seat: s.seat,
      ready: s.ready,
      online: s.socket !== null || s.isBot,
      score: s.score,
      isBot: s.isBot,
      ...(s.isBot ? { botDifficulty: s.botDifficulty ?? 'high' } : {}),
      ...(s.avatar !== undefined ? { avatar: s.avatar } : {}),
      ...(s.equippedFrame ? { equippedFrame: s.equippedFrame } : {}),
    }));
}

export function toSpectatorViews(spectators: Iterable<Spectator>): SpectatorView[] {
  return [...spectators].map((s) => ({
    playerId: s.playerId,
    nickname: s.nickname,
    queuedToSit: s.queuedToSit,
  }));
}

export function buildRoomView(input: {
  roomId: string;
  gameId: string;
  mode: string;
  status: RoomStatus;
  round: number;
  maxPlayers: number;
  hostId: string | null;
  seats: Iterable<Seat>;
  botHosted?: boolean;
  spectators?: Iterable<Spectator>;
  stakesTier?: StakesTier;
  stakeMultiplier?: number;
  turnActorId?: string | null;
  turnDeadlineAt?: number | null;
  hostedPlayerIds?: string[];
}): RoomView {
  return {
    roomId: input.roomId,
    gameId: input.gameId,
    mode: input.mode,
    status: input.status,
    round: input.round,
    maxPlayers: input.maxPlayers,
    players: toPlayerViews(input.seats),
    hostId: input.hostId,
    ...(input.botHosted ? { botHosted: true } : {}),
    ...(input.spectators ? { spectators: toSpectatorViews(input.spectators) } : {}),
    ...(input.stakesTier ? { stakesTier: input.stakesTier } : {}),
    ...(input.stakeMultiplier !== undefined ? { stakeMultiplier: input.stakeMultiplier } : {}),
    ...(input.turnActorId !== undefined ? { turnActorId: input.turnActorId } : {}),
    ...(input.turnDeadlineAt !== undefined ? { turnDeadlineAt: input.turnDeadlineAt } : {}),
    ...(input.hostedPlayerIds && input.hostedPlayerIds.length > 0 ? { hostedPlayerIds: input.hostedPlayerIds } : {}),
  };
}

/** 把各玩法不同的历史结构归一化成最近 3 个走势标记 */
export function recentTrendFor(plugin: GamePlugin, ctx: RoomContext, persistent: boolean): TrendMark[] {
  if (!persistent) return [];
  let history: Array<Record<string, unknown>>;
  try {
    const snap = plugin.getSnapshot(ctx, null) as { history?: Array<Record<string, unknown>> };
    history = Array.isArray(snap?.history) ? snap.history : [];
  } catch {
    return [];
  }

  return history.slice(-3).map((row) => {
    const round = Number(row.round ?? 0);
    const gameId = plugin.meta.gameId;

    if (gameId === 'baccarat') {
      const outcome = String(row.outcome ?? '');
      return {
        round,
        text: outcome === 'player' ? '闲' : outcome === 'banker' ? '庄' : '和',
        tone: (outcome === 'player' ? 'blue' : outcome === 'banker' ? 'red' : 'green') as TrendMark['tone'],
      };
    }
    if (gameId === 'dice') {
      if (row.triple === true) return { round, text: '豹', tone: 'green' as const };
      return {
        round,
        text: row.big === true ? '大' : '小',
        tone: (row.big === true ? 'red' : 'blue') as TrendMark['tone'],
      };
    }
    if (gameId === 'niuniu') {
      const niu = Number(row.niu ?? 0);
      if (niu >= 10) return { round, text: '牛牛', tone: 'red' as const };
      if (niu >= 7) return { round, text: `${niu}牛`, tone: 'red' as const };
      if (niu >= 1) return { round, text: `${niu}牛`, tone: 'blue' as const };
      return { round, text: '无牛', tone: 'neutral' as const };
    }
    if (gameId === 'blackjack') {
      const pts = Number(row.dealerPoints ?? 0);
      if (pts > 21) return { round, text: '爆', tone: 'green' as const };
      if (pts === 21) return { round, text: '21点', tone: 'red' as const };
      if (pts > 0) return { round, text: `${pts}点`, tone: 'blue' as const };
      return { round, text: '和', tone: 'neutral' as const };
    }

    const winners = Array.isArray(row.winningDoors) ? (row.winningDoors as string[]) : [];
    const label: Record<string, string> = { heaven: '天', earth: '地', human: '人' };
    if (winners.length === 0) return { round, text: '庄', tone: 'neutral' as const };
    return {
      round,
      text: winners.map((door) => label[door] ?? '').join(''),
      tone: 'green' as const,
    };
  });
}

export function buildRoomSummary(input: {
  roomId: string;
  meta: GameMeta;
  persistent: boolean;
  botHosted?: boolean;
  platformNo: number;
  hostId: string | null;
  seats: Iterable<Seat>;
  spectatorCount?: number;
  capacity: number;
  status: RoomStatus;
  joinable: boolean;
  recent: TrendMark[];
  stakesTier?: StakesTier;
  stakeMultiplier?: number;
}): RoomSummary {
  const list = [...input.seats];
  const host = list.find((seat) => seat.playerId === input.hostId);
  const bots = list.filter((seat) => seat.isBot).length;
  const isBotHosted = input.botHosted === true;
  return {
    roomId: input.roomId,
    gameId: input.meta.gameId,
    roomName: input.persistent
      ? `${input.meta.name} · ${input.platformNo || 1} 号台`
      : isBotHosted
        ? `${input.meta.name} · 机器热战 ${input.platformNo || 1} 号桌`
        : `${host?.nickname ?? '玩家'}的${input.meta.name}`,
    hostId: input.hostId,
    hostName: input.persistent ? '平台庄' : (host?.nickname ?? '玩家'),
    players: list.length,
    humans: list.length - bots,
    bots,
    maxPlayers: input.capacity,
    status: input.status === 'closed' ? 'settled' : input.status,
    persistent: input.persistent,
    ...(isBotHosted ? { botHosted: true } : {}),
    ...(input.spectatorCount ? { spectators: input.spectatorCount } : {}),
    joinable: input.joinable || (input.persistent && list.length < input.capacity) || isBotHosted,
    recent: input.recent,
    ...(input.stakesTier ? { stakesTier: input.stakesTier } : {}),
    ...(input.stakeMultiplier !== undefined ? { stakeMultiplier: input.stakeMultiplier } : {}),
  };
}
