import { useEffect, useState } from 'react';

interface TuiCard {
  id: string;
  rank: number;
}

interface TuiPlayer {
  playerId: string;
  nickname: string;
  seat: number;
  isBanker: boolean;
  bet: number | null;
  points: number | null;
  cards: TuiCard[];
}

interface TuiResult {
  playerId: string;
  points: number;
  isBanker: boolean;
  delta: number;
}

interface TuiSnapshot {
  phase: 'bet' | 'reveal';
  bankerId: string | null;
  betOptions: number[];
  deadline: number;
  myBet: number | null;
  myPoints: number | null;
  results: TuiResult[];
  players: TuiPlayer[];
}

interface Props {
  snapshot: Record<string, unknown> | null;
  myId: string;
  status: string;
  onBet: (amount: number) => void;
}

export function Tuizhuanzi({ snapshot, myId, status, onBet }: Props) {
  const data = snapshot as unknown as TuiSnapshot | undefined;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  if (!data) return <div className="board-placeholder">等待开局…</div>;

  const me = data.players.find((p) => p.playerId === myId);
  const isBanker = me?.isBanker ?? false;
  const phase = data.phase;
  const remain = Math.max(0, Math.ceil((data.deadline - now) / 1000));
  const canBet = phase === 'bet' && !isBanker && status === 'playing';

  return (
    <div className="tui">
      <div className="tui__head">
        <span className={`badge ${phase === 'bet' ? 'badge--waiting' : 'badge--playing'}`}>
          {phase === 'bet' ? '押注中' : '已开牌'}
        </span>
        {phase === 'bet' && <span className="tui__timer">{remain}s</span>}
        <span className="tui__pot">
          底池 <strong>{data.players.reduce((sum, p) => sum + (p.bet ?? 0), 0)}</strong>
        </span>
      </div>

      <div className="tui__players">
        {data.players.map((player) => (
          <div
            key={player.playerId}
            className={`tui-seat ${player.isBanker ? 'is-banker' : ''} ${
              player.playerId === myId ? 'is-me' : ''
            }`}
          >
            <div className="tui-seat__head">
              <span>{player.nickname}</span>
              {player.isBanker && <em>庄</em>}
            </div>

            <div className="tui-seat__cards">
              {player.cards.length > 0 ? (
                player.cards.map((card) => (
                  <span key={card.id} className="tui-card">
                    {card.rank}
                  </span>
                ))
              ) : (
                <>
                  <span className="tui-card tui-card--back">?</span>
                  <span className="tui-card tui-card--back">?</span>
                </>
              )}
            </div>

            <div className="tui-seat__meta">
              {player.points !== null ? (
                <span className="tui-seat__points">{player.points} 点</span>
              ) : (
                <span className="tui-seat__points muted">
                  {player.isBanker ? '庄家' : player.bet ? `押 ${player.bet}` : '未押注'}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {phase === 'bet' && (
        <div className="tui__actions">
          {isBanker ? (
            <p className="hint">你是庄家，等待闲家押注…</p>
          ) : (
            <>
              <span className="hint">选择押注额</span>
              <div className="tui__bets">
                {data.betOptions.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    className={data.myBet === amount ? 'primary' : 'secondary'}
                    disabled={!canBet}
                    onClick={() => onBet(amount)}
                  >
                    {amount}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {phase === 'reveal' && (
        <div className="tui__result">
          {data.results.map((row) => {
            const player = data.players.find((p) => p.playerId === row.playerId);
            return (
              <div key={row.playerId} className="tui__result-row">
                <span>{player?.nickname ?? '玩家'}</span>
                <span>{row.points} 点</span>
                <span className={row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : ''}>
                  {row.delta > 0 ? `+${row.delta}` : row.delta}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
