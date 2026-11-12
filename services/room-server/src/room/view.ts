import type { GameMeta, PlayerView, RoomStatus, RoomSummary, RoomView, TrendMark } from '@cc/protocol';
import type { GamePlugin, PlayerContext, RoomContext } from '@cc/game-sdk';
import type { Seat } from './types';

export function toPlayerContexts(seats: Iterable<Seat>): PlayerContext[] {
  return [...seats]
    .sort((a, b) => a.seat - b.seat)
    .map((s) => ({
      playerId: s.playerId,
      nickname: s.nickname,
      seat: s.seat,
      connected: s.socket !== null || s.isBot,
      isBot: s.isBot,
      ...(s.isBot ? { botDifficulty: s.botDifficulty ?? 'medium' } : {}),
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
      ...(s.isBot ? { botDifficulty: s.botDifficulty ?? 'medium' } : {}),
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
  platformNo: number;
  hostId: string | null;
  seats: Iterable<Seat>;
  capacity: number;
  status: RoomStatus;
  joinable: boolean;
  recent: TrendMark[];
}): RoomSummary {
  const list = [...input.seats];
  const host = list.find((seat) => seat.playerId === input.hostId);
  const bots = list.filter((seat) => seat.isBot).length;
  return {
    roomId: input.roomId,
    gameId: input.meta.gameId,
    roomName: input.persistent
      ? `${input.meta.name} · ${input.platformNo || 1} 号台`
      : `${host?.nickname ?? '玩家'}的${input.meta.name}`,
    hostId: input.hostId,
    hostName: input.persistent ? '平台庄' : (host?.nickname ?? '玩家'),
    players: list.length,
    humans: list.length - bots,
    bots,
    maxPlayers: input.capacity,
    status: input.status === 'closed' ? 'settled' : input.status,
    persistent: input.persistent,
    joinable: input.joinable || input.persistent,
    recent: input.recent,
  };
}
