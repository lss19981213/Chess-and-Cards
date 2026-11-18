import { useEffect, useMemo, useRef, useState } from 'react';
import { chipArt } from '../chips';
import { DEALER_MAIN } from '../assets';
import { audio } from '../audio';
import { cardArt, cardLabel, isRedCard, type CardView } from './cards';

interface SideView {
  points: number | null;
  cards: CardView[];
}

interface BacSnapshot {
  phase: 'bet' | 'reveal' | 'idle';
  round: number;
  remainMs: number;
  player: SideView;
  banker: SideView;
  outcome: 'player' | 'banker' | 'tie' | null;
  myBet: Record<string, number>;
  zoneTotals: Record<string, number>;
  myStreak: number;
  phaseDurationMs: number;
  results: Array<{ playerId: string; nickname: string; delta: number; detail: string }>;
  history: Array<{ round: number; playerPoints: number; bankerPoints: number; outcome: string }>;
  limits: { min: number; max: number; total: number };
}

interface Props {
  snapshot: Record<string, unknown> | null;
  myId: string;
  status: string;
  balance: number;
  onBet: (area: string, amount: number) => void;
  onClear: (area?: string) => void;
}

const PRESET = [10, 50, 100, 500, 1000, 2000, 5000, 10000, 100000];

const ZONES: Array<{ key: string; label: string; odds: string; desc: string }> = [
  { key: 'player_pair', label: '闲对子', odds: '1 : 11', desc: '闲家两张同点' },
  { key: 'player', label: '闲 (Player)', odds: '1 : 1', desc: '闲家点数大于庄家' },
  { key: 'tie', label: '和 (Tie)', odds: '1 : 8', desc: '闲庄双方同点' },
  { key: 'super_six', label: '幸运6', odds: '1 : 12', desc: '庄家6点赢(2张12倍/3张20倍)' },
  { key: 'banker', label: '庄 (Banker)', odds: '1 : 0.95', desc: '庄家点数大于闲家' },
  { key: 'banker_pair', label: '庄对子', odds: '1 : 11', desc: '庄家两张同点' },
];

const OUTCOME_TEXT: Record<string, string> = { player: '闲赢', banker: '庄赢', tie: '和局' };

function Hand({ side, revealed, isWinner }: { side: SideView; revealed: boolean; isWinner?: boolean }) {
  const cards = revealed ? side.cards : [];
  return (
    <div className={`bac-hand ${isWinner ? 'is-winner-hand' : ''}`}>
      <div className="bac-hand__cards">
        {revealed ? (
          cards.map((card, idx) => (
            <div
              key={card.id}
              className={`pcard poker-stage-card bac-card-pro ${isRedCard(card) ? 'is-red' : ''}`}
              style={{ ['--i' as string]: idx }}
            >
              <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
            </div>
          ))
        ) : (
          <>
            <div className="pcard poker-stage-card bac-card-pro pcard--back">
              <img src={cardArt('back')} alt="" draggable={false} />
            </div>
            <div className="pcard poker-stage-card bac-card-pro pcard--back">
              <img src={cardArt('back')} alt="" draggable={false} />
            </div>
          </>
        )}
      </div>
      <div className="bac-hand__points">{revealed && side.points !== null ? `${side.points} 点` : '—'}</div>
    </div>
  );
}

export function Baccarat({ snapshot, myId, status, balance, onBet, onClear }: Props) {
  const data = snapshot as unknown as BacSnapshot | undefined;
  const [centerBanner, setCenterBanner] = useState<{ id: number; kind: string; text: string; sub?: string } | null>(
    null,
  );
  const lastPhaseKeyRef = useRef<string>('');
  const bannerIdRef = useRef<number>(1);
  const bannerTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (bannerTimerRef.current !== null) window.clearTimeout(bannerTimerRef.current);
    };
  }, []);

  // 监听开牌阶段与新局：播放连续清脆发牌声、胜负音效与居中播报
  useEffect(() => {
    if (!data) return;
    const key = `${data.round}:${data.phase}`;
    if (key === lastPhaseKeyRef.current) return;
    lastPhaseKeyRef.current = key;

    const showBanner = (kind: string, text: string, sub?: string, ms = 1850) => {
      const id = bannerIdRef.current++;
      if (bannerTimerRef.current !== null) window.clearTimeout(bannerTimerRef.current);
      setCenterBanner({ id, kind, text, sub });
      bannerTimerRef.current = window.setTimeout(() => {
        setCenterBanner((cur) => (cur?.id === id ? null : cur));
      }, ms);
    };

    if (data.phase === 'reveal') {
      const totalCards = (data.player.cards?.length ?? 2) + (data.banker.cards?.length ?? 2);
      for (let i = 0; i < Math.min(6, totalCards); i += 1) {
        window.setTimeout(() => audio.play('poker_deal'), i * 115);
      }
      const myRow = data.results.find((r) => r.playerId === myId);
      window.setTimeout(() => {
        if (myRow && myRow.delta > 0) audio.play('win');
        else if (myRow && myRow.delta < 0) audio.play('lose');
      }, Math.min(6, totalCards) * 115 + 140);

      const outcomeLabel = data.outcome ? OUTCOME_TEXT[data.outcome] ?? data.outcome : '开牌';
      showBanner(
        data.outcome === 'tie' ? 'raise' : 'showdown',
        `👑 ${outcomeLabel}！（闲 ${data.player.points ?? '—'} : 庄 ${data.banker.points ?? '—'}）`,
        myRow && myRow.delta !== 0
          ? myRow.delta > 0
            ? `恭喜赢取 +${myRow.delta.toLocaleString()} 欢乐豆`
            : `本局结算 ${myRow.delta.toLocaleString()}`
          : undefined,
        2000,
      );
    } else if (data.phase === 'bet' && data.round > 0) {
      audio.play('poker_deal');
    }
  }, [data?.round, data?.phase, data?.outcome, data?.player?.points, data?.banker?.points, data?.player?.cards?.length, data?.banker?.cards?.length, data?.results, myId]);

  const rankedResults = useMemo(() => {
    const list = [...(data?.results ?? [])];
    list.sort((a, b) => {
      if (a.playerId === myId) return -1;
      if (b.playerId === myId) return 1;
      return Math.abs(b.delta) - Math.abs(a.delta);
    });
    return list;
  }, [data?.results, myId]);

  const [amount, setAmount] = useState<number>(100);
  const [deadline, setDeadline] = useState<number>(() => Date.now() + (data?.remainMs ?? 0));
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (data) setDeadline(Date.now() + data.remainMs);
  }, [data?.remainMs, data?.phase, data?.round]);

  if (!data) return <div className="board-placeholder">正在连接牌桌…</div>;

  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  const durationSec = Math.max(1, Math.round((data?.phaseDurationMs ?? 30_000) / 1000));
  const progress = Math.min(100, Math.max(0, (left / durationSec) * 100));
  const phaseLabel = data?.phase === 'reveal' ? '开牌中' : data?.phase === 'idle' ? '准备下一局' : '下注中';
  const phaseClass =
    data?.phase === 'bet' ? (left <= 5 ? 'is-urgent' : 'is-open') : data?.phase === 'reveal' ? 'is-reveal' : 'is-idle';
  const canBet = data.phase === 'bet' && status === 'playing';
  const canPlace = canBet && amount > 0 && amount <= balance;
  const revealed = data.phase !== 'bet';
  const betting = Object.values(data.myBet ?? {}).reduce((s, v) => s + (v ?? 0), 0);

  return (
    <div className="lobby-game lobby-game--poker-pro">
      {centerBanner && (
        <div key={centerBanner.id} className={`texas-fx-banner is-${centerBanner.kind}`} role="status" aria-live="polite">
          <strong>{centerBanner.text}</strong>
          {centerBanner.sub && <span>{centerBanner.sub}</span>}
        </div>
      )}

      <div className="lobby-game__main">
        <div className="lobby-game__bar">
          <span className="lobby-game__round">第 {data.round} 局</span>
          <span className={`lobby-game__phase ${phaseClass}`}>
            {phaseLabel} · {left}s
          </span>
          {betting > 0 && <span className="lobby-game__mine">我已下注 {betting.toLocaleString()}</span>}
          {data.myStreak >= 2 && <span className="streak-badge">🔥 连续命中 {data.myStreak}</span>}
          <div className="phase-progress"><i style={{ width: `${progress}%` }} /></div>
        </div>

        {/* 动漫美女荷官专属席位 */}
        <div className="table-dealer-host">
          <div className="dealer-mini-portrait">
            <img src={DEALER_MAIN} alt="荷官艾莉丝" draggable={false} />
          </div>
          <div className="dealer-text-badge">
            <span className="dealer-title">荷官·艾莉丝</span>
            <span className="dealer-action">{revealed ? '验牌开奖' : '派牌中 (闲/庄)'}</span>
          </div>
        </div>

        <div className="bac-table">
          <div className="bac-side">
            <span className="bac-side__label">闲 (PLAYER)</span>
            <Hand side={data.player} revealed={revealed} isWinner={revealed && data.outcome === 'player'} />
          </div>

          <div className="bac-center">
            {revealed && data.outcome ? (
              <span className={`bac-outcome is-${data.outcome}`}>{OUTCOME_TEXT[data.outcome] ?? data.outcome}</span>
            ) : (
              <span className="muted">VS</span>
            )}
          </div>

          <div className="bac-side">
            <span className="bac-side__label">庄 (BANKER)</span>
            <Hand side={data.banker} revealed={revealed} isWinner={revealed && data.outcome === 'banker'} />
          </div>
        </div>

        <div className="bac-zones bac-zones--six">
          {ZONES.map((zone) => {
            const bet = data.myBet[zone.key] ?? 0;
            const won = revealed && data.outcome === zone.key;
            return (
              <button
                key={zone.key}
                type="button"
                className={`bac-zone ${bet > 0 ? 'is-bet' : ''} ${won ? 'is-win' : ''}`}
                disabled={!canPlace}
                onClick={() => {
                  audio.play('poker_chip_bet');
                  onBet(zone.key, amount);
                }}
                title={zone.desc}
              >
                <span className="bac-zone__label">{zone.label}</span>
                <span className="bac-zone__odds">{zone.odds}</span>
                {(data.zoneTotals?.[zone.key] ?? 0) > 0 && (
                  <span className="bac-zone__pool" key={`pool-${data.zoneTotals[zone.key]}`}>
                    全台 {data.zoneTotals[zone.key]?.toLocaleString()}
                  </span>
                )}
                {bet > 0 ? (
                  <span className="bac-zone__bet" key={bet}>
                    <img src={chipArt(bet)} alt="" />
                    <span>我押 {bet.toLocaleString()}</span>
                    {canBet && (
                      <span
                        className="bet-cancel"
                        role="button"
                        tabIndex={0}
                        title="取消该区下注"
                        onClick={(event) => {
                          event.stopPropagation();
                          audio.play('poker_fold');
                          onClear(zone.key);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.stopPropagation();
                            audio.play('poker_fold');
                            onClear(zone.key);
                          }
                        }}
                      >
                        ×
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="bac-zone__hint">{canBet ? '点击放筹码' : '未下注'}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="bet-controls">
          <div className="bet-controls__chips">
            {PRESET.map((value) => (
              <button
                key={value}
                type="button"
                className={`chip-btn ${amount === value ? 'is-active' : ''}`}
                onClick={() => {
                  audio.play('click');
                  setAmount(value);
                }}
              >
                <img src={chipArt(value)} alt="" />
                <span>{value}</span>
              </button>
            ))}
          </div>
          {canBet && betting > 0 && (
            <button
              type="button"
              className="ghost clear-bet-btn"
              onClick={() => {
                audio.play('poker_fold');
                onClear();
              }}
            >
              清空下注
            </button>
          )}
          <div className="bet-controls__custom">
            <span>自定义</span>
            <input
              type="number"
              min={data.limits.min}
              step={10}
              value={amount}
              onChange={(event) => {
                const next = Number(event.target.value);
                setAmount(Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0);
              }}
            />
            <span className="bet-controls__hint">
              底注 {data.limits.min} · 无上限自由下注
            </span>
          </div>
        </div>

        {data.results.length > 0 && (
          <div className="lobby-results">
            {rankedResults.map((row) => (
              <span
                key={row.playerId}
                className={`${row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : 'muted'} ${
                  row.playerId === myId ? 'is-me' : ''
                }`}
              >
                {row.playerId === myId ? '我' : row.nickname}{' '}
                {row.delta > 0 ? `+${row.delta.toLocaleString()}` : row.delta.toLocaleString()}
              </span>
            ))}
          </div>
        )}
      </div>

      <aside className="history">
        <div className="history__title">走势</div>
        <div className="history__legend history__legend--dice">
          <span>局</span>
          <span>闲</span>
          <span>庄</span>
          <span>果</span>
        </div>
        <div className="history__list">
          {data.history.length === 0 && <p className="history__empty">暂无记录</p>}
          {[...data.history].reverse().map((item) => (
            <div key={item.round} className="history__row history__row--dice">
              <span className="history__no">{item.round}</span>
              <span className="history__banker">{item.playerPoints}</span>
              <span>{item.bankerPoints}</span>
              <span
                className={
                  item.outcome === 'player' ? 'is-small' : item.outcome === 'banker' ? 'is-big' : 'is-triple'
                }
              >
                {item.outcome === 'player' ? '闲' : item.outcome === 'banker' ? '庄' : '和'}
              </span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
