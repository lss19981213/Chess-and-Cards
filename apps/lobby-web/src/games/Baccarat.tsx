import { useEffect, useMemo, useRef, useState } from 'react';
import { BET_PRESET_CHIPS, chipArt, chipTierClass, formatChipLabel } from '../chips';
import { DEALER_MAIN } from '../assets';
import { audio } from '../audio';
import { cnPointText, speakDealerQuote, speakDealerSequence, stopDealerSpeech } from '../speech';
import { cardArt, cardLabel, isRedCard, type CardView } from './cards';
import { usePhaseCountdown } from './usePhaseCountdown';

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

const PRESET = BET_PRESET_CHIPS;

const ZONES: Array<{ key: string; label: string; odds: string; desc: string }> = [
  { key: 'player_pair', label: '闲对子', odds: '1 : 11', desc: '闲家两张同点' },
  { key: 'player', label: '闲 (Player)', odds: '1 : 1', desc: '闲家点数大于庄家' },
  { key: 'tie', label: '和 (Tie)', odds: '1 : 8', desc: '闲庄双方同点' },
  { key: 'super_six', label: '幸运6', odds: '1 : 12', desc: '庄家6点赢(2张12倍/3张20倍)' },
  { key: 'banker', label: '庄 (Banker)', odds: '1 : 0.95', desc: '庄家点数大于闲家' },
  { key: 'banker_pair', label: '庄对子', odds: '1 : 11', desc: '庄家两张同点' },
];

const OUTCOME_TEXT: Record<string, string> = { player: '闲家赢', banker: '庄家赢', tie: '和局' };

const BACCARAT_BET_CALLS = [
  '请下注，买定离手喔！',
  '闲庄大战即将开牌，请各位老板下注喔！',
  '买定离手啦，这把押闲还是押庄呢？',
  '下注倒计时，买定离手咯！',
];

function Hand({
  side,
  revealed,
  isWinner,
  isFocusing,
}: {
  side: SideView;
  revealed: boolean;
  isWinner?: boolean;
  isFocusing?: boolean;
}) {
  const cards = revealed ? side.cards : [];
  return (
    <div className={`bac-hand ${isWinner ? 'is-winner-hand' : ''} ${isFocusing ? 'is-focus-reveal' : ''}`}>
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
  /** 开牌进度：0=未开牌, 1=已开闲家, 2=已开庄家, 3=已宣布胜负 */
  const [revealStep, setRevealStep] = useState<number>(0);
  const [centerBanner, setCenterBanner] = useState<{ id: number; kind: string; text: string; sub?: string } | null>(
    null,
  );
  const lastPhaseKeyRef = useRef<string>('');
  const betCallIdxRef = useRef<number>(0);
  const cancelSeqRef = useRef<(() => void) | null>(null);
  const bannerIdRef = useRef<number>(1);
  const bannerTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      cancelSeqRef.current?.();
      stopDealerSpeech();
      if (bannerTimerRef.current !== null) window.clearTimeout(bannerTimerRef.current);
    };
  }, []);

  // 下注阶段轮播「请下注、买定离手」荷官热场语音
  useEffect(() => {
    if (data?.phase !== 'bet' || status !== 'playing') return;
    const speakNext = () => {
      if (!audio.sfxOn) return;
      const line = BACCARAT_BET_CALLS[betCallIdxRef.current % BACCARAT_BET_CALLS.length]!;
      betCallIdxRef.current += 1;
      speakDealerQuote(line);
    };
    const firstTimer = window.setTimeout(speakNext, 750);
    const interval = window.setInterval(speakNext, 7200);
    return () => {
      window.clearTimeout(firstTimer);
      window.clearInterval(interval);
    };
  }, [data?.phase, data?.round, status]);

  // 严格按标准百家乐流程：先开闲家牌并报点数 → 再开庄家牌并报点数 → 最后播报闲家赢/庄家赢/和局
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

    if (data.phase === 'bet') {
      cancelSeqRef.current?.();
      cancelSeqRef.current = null;
      setRevealStep(0);
      if (data.round > 0) audio.play('poker_deal');
      return;
    }

    if (data.phase === 'idle') {
      setRevealStep(3);
      return;
    }

    if (data.phase === 'reveal') {
      cancelSeqRef.current?.();
      setRevealStep(0);

      const pPts = data.player.points ?? 0;
      const bPts = data.banker.points ?? 0;
      const outcome = data.outcome ?? (pPts > bPts ? 'player' : bPts > pPts ? 'banker' : 'tie');
      const outcomeVoice = outcome === 'player' ? '闲家赢！' : outcome === 'banker' ? '庄家赢！' : '和局！';
      const outcomeText = OUTCOME_TEXT[outcome] ?? outcome;
      const myRow = data.results.find((r) => r.playerId === myId);

      cancelSeqRef.current = speakDealerSequence(
        [
          {
            text: `闲家${cnPointText(pPts)}点`,
            onStart: () => {
              setRevealStep(1);
              audio.play('poker_deal');
              window.setTimeout(() => audio.play('poker_deal'), 120);
              showBanner('deal', `闲家开牌 · ${pPts} 点`, undefined, 1600);
            },
            delayAfterMs: 320,
          },
          {
            text: `庄家${cnPointText(bPts)}点`,
            onStart: () => {
              setRevealStep(2);
              audio.play('poker_deal');
              window.setTimeout(() => audio.play('poker_deal'), 120);
              showBanner('street', `庄家开牌 · ${bPts} 点`, undefined, 1600);
            },
            delayAfterMs: 360,
          },
          {
            text: outcomeVoice,
            onStart: () => {
              setRevealStep(3);
              if (myRow && myRow.delta > 0) audio.play('win');
              else if (myRow && myRow.delta < 0) audio.play('lose');
              else audio.play('dice_open');
              showBanner(
                outcome === 'tie' ? 'raise' : 'showdown',
                `👑 ${outcomeText}！（闲 ${pPts} : 庄 ${bPts}）`,
                myRow && myRow.delta !== 0
                  ? myRow.delta > 0
                    ? `恭喜赢取 +${myRow.delta.toLocaleString()} 欢乐豆`
                    : `本局结算 ${myRow.delta.toLocaleString()}`
                  : undefined,
                2400,
              );
            },
            delayAfterMs: 0,
          },
        ],
        { gapMs: 280, mutedStepMs: 1100 },
      );
    }
  }, [
    data?.round,
    data?.phase,
    data?.outcome,
    data?.player?.points,
    data?.banker?.points,
    data?.results,
    myId,
  ]);

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
  const { leftSec: left, progressPct: progress } = usePhaseCountdown(
    data?.remainMs,
    data?.phaseDurationMs,
    data?.phase,
    data?.round,
    30_000,
  );

  if (!data) return <div className="board-placeholder">正在连接牌桌…</div>;

  const phaseLabel = data?.phase === 'reveal' ? '开牌中' : data?.phase === 'idle' ? '准备下一局' : '下注中';
  const phaseClass =
    data?.phase === 'bet' ? (left <= 5 ? 'is-urgent' : 'is-open') : data?.phase === 'reveal' ? 'is-reveal' : 'is-idle';
  const canBet = data.phase === 'bet' && status === 'playing';
  const canPlace = canBet && amount > 0 && amount <= balance;
  const playerRevealed = data.phase !== 'bet' && revealStep >= 1;
  const bankerRevealed = data.phase !== 'bet' && revealStep >= 2;
  const outcomeRevealed = data.phase !== 'bet' && revealStep >= 3;
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
            <span className="dealer-action">
              {data.phase === 'bet'
                ? '买定离手 (闲/庄)'
                : revealStep === 1
                  ? '正在开闲家牌…'
                  : revealStep === 2
                    ? '正在开庄家牌…'
                    : '开牌结算完毕'}
            </span>
          </div>
        </div>

        <div className="bac-table">
          <div className="bac-side">
            <span className="bac-side__label">闲 (PLAYER)</span>
            <Hand
              side={data.player}
              revealed={playerRevealed}
              isWinner={outcomeRevealed && data.outcome === 'player'}
              isFocusing={revealStep === 1}
            />
          </div>

          <div className="bac-center">
            {outcomeRevealed && data.outcome ? (
              <span className={`bac-outcome is-${data.outcome}`}>{OUTCOME_TEXT[data.outcome] ?? data.outcome}</span>
            ) : (
              <span className="muted">VS</span>
            )}
          </div>

          <div className="bac-side">
            <span className="bac-side__label">庄 (BANKER)</span>
            <Hand
              side={data.banker}
              revealed={bankerRevealed}
              isWinner={outcomeRevealed && data.outcome === 'banker'}
              isFocusing={revealStep === 2}
            />
          </div>
        </div>

        <div className="bac-zones bac-zones--six">
          {ZONES.map((zone) => {
            const bet = data.myBet[zone.key] ?? 0;
            const won = outcomeRevealed && data.outcome === zone.key;
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
                className={`chip-btn ${chipTierClass(value)} ${amount === value ? 'is-active' : ''}`}
                onClick={() => {
                  audio.play('click');
                  setAmount(value);
                }}
              >
                <img src={chipArt(value)} alt="" />
                <span>{formatChipLabel(value)}</span>
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

        {outcomeRevealed && data.results.length > 0 && (
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
