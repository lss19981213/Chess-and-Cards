import type { Settlement } from '@cc/protocol';
import type { SettlementInput } from '@cc/game-sdk';
import type { Seat } from './types';

export function buildSettlementEnvelope(params: {
  roomId: string;
  gameId: string;
  round: number;
  seed: string;
  input: SettlementInput;
}): Settlement {
  const entries = params.input.entries.filter((entry) => {
    const valid = Number.isInteger(entry.delta) && Math.abs(entry.delta) <= 1_000_000;
    if (!valid) console.warn(`[room ${params.roomId}] 结算条目非法，已丢弃`, entry);
    return valid;
  });

  return {
    settlementId: `${params.roomId}:${params.round}`,
    roomId: params.roomId,
    gameId: params.gameId,
    round: params.round,
    seed: params.seed,
    winners: params.input.winners,
    entries,
    finishedAt: Date.now(),
  };
}

export function applySettlementScores(seats: Map<string, Seat>, settlement: Settlement): void {
  for (const entry of settlement.entries) {
    const seat = seats.get(entry.playerId);
    if (seat) seat.score += entry.delta;
  }
}
