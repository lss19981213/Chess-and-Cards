import { useEffect, useState } from 'react';
import { Chip, ChipStack } from '../components/Chip';
import { SeatPanel, TableStage } from '../components/TableStage';

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

function TuiCards({ cards, size = 'sm' }: { cards: TuiCard[]; size?: 'sm' | 'lg' }) {
  if (cards.length === 0) {
    return (
      <div className="tui-cards">
        <span className={`tui-card tui-card--back tui-card--${size}`}>?</span>
        <span className={`tui-card tui-card--back tui-card--${size}`}>?</span>
      </div>
    );
  }
  return (
    <div className="tui-cards">
      {cards.map((card) => (
        <span key={card.id} className={`tui-card tui-card--${size}`}>
          {card.rank}
        </span>
      ))}
    </div>
  );
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
  const others = data.players.filter((p) => p.playerId !== myId);
  const isBanker = me?.isBanker ?? false;
  const phase = data.phase;
  const remain = Math.max(0, Math.ceil((data.deadline - now) / 1000));
  const canBet = phase === 'bet' && !isBanker && status === 'playing';
  const pot = data.players.reduce((sum, p) => sum + (p.bet ?? 0), 0);

  return (
    <TableStage
      watermark="TUI ZHUAN ZI"
      seats={others.map((player) => ({
        key: player.playerId,
        active: player.isBanker,
        node: (
          <SeatPanel
            nickname={player.nickname}
            initial={player.nickname.replace(/^🤖\s*/, '').slice(0, 1)}
            isBot={player.nickname.startsWith('🤖')}
            badge={player.isBanker ? <em className="badge-dealer">庄</em> : null}
            active={player.isBanker}
            meta={
              player.points !== null
                ? `${player.points} 点`
                : player.isBanker
                  ? '庄家'
                  : player.bet
                    ? `押 ${player.bet}`
                    : '未押注'
            }
            cards={<TuiCards cards={player.cards} />}
          />
        ),
      }))}
      center={
        phase === 'bet' ? (
          <div className="pot-display">
            <span className="pot-display__label">底池</span>
            <span className="pot-display__value">
              <Chip size={19} />
              <strong>{pot}</strong>
            </span>
            <ChipStack amount={pot} />
            <span className="pot-display__timer">{remain}s</span>
          </div>
        ) : (
          <div className="reveal-list">
            {data.results.map((row) => {
              const player = data.players.find((p) => p.playerId === row.playerId);
              return (
                <div key={row.playerId} className="reveal-row">
                  <span className="reveal-row__name">{player?.nickname ?? '玩家'}</span>
                  <span className="reveal-row__pt">{row.points} 点</span>
                  <span className={row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : 'muted'}>
                    {row.delta > 0 ? `+${row.delta}` : row.delta}
                  </span>
                </div>
              );
            })}
          </div>
        )
      }
      bottom={
        <div className="hand-area">
          <div className="my-lane">
            <div className="my-lane__head">
              <span className="my-lane__name">
                你
                {isBanker && <em className="badge-dealer">庄</em>}
              </span>
              {me?.points !== null && me?.points !== undefined && (
                <span className="my-lane__points">{me.points} 点</span>
              )}
              {me?.bet && <span className="my-lane__bet">已押 {me.bet}</span>}
            </div>
            {me && <TuiCards cards={me.cards} size="lg" />}
          </div>

          {phase === 'bet' &&
            (isBanker ? (
              <p className="hint">你是庄家，等待闲家押注…</p>
            ) : (
              <div className="bet-row">
                <span className="bet-row__label">押注</span>
                {data.betOptions.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    className={data.myBet === amount ? 'primary' : 'secondary'}
                    disabled={!canBet}
                    onClick={() => onBet(amount)}
                  >
                    <Chip size={14} /> {amount}
                  </button>
                ))}
              </div>
            ))}
        </div>
      }
    />
  );
}
