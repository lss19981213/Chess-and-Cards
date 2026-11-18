import { useEffect, useMemo, useRef, useState } from 'react';
import { BET_PRESET_CHIPS, chipArt, chipTierClass, formatChipLabel } from '../chips';
import { DEALER_MAIN } from '../assets';
import { audio } from '../audio';
import { cnPointText, speakDealerQuote, speakDealerSequence, stopDealerSpeech, type SpeechSequenceStep } from '../speech';
import { MahjongTile } from '../components/MahjongTile';
import { usePhaseCountdown } from './usePhaseCountdown';

interface DoorView {
  label: string;
  points: number | null;
  cards: Array<{ id: string; rank: number }>;
}

interface TuiSnapshot {
  phase: 'bet' | 'reveal' | 'idle';
  round: number;
  remainMs: number;
  banker: { points: number | null; cards: Array<{ id: string; rank: number }> };
  doors: { heaven: DoorView; earth: DoorView; human: DoorView };
  myBet: { heaven: number; earth: number; human: number };
  doorTotals: { heaven: number; earth: number; human: number };
  myStreak: number;
  phaseDurationMs: number;
  results: Array<{ playerId: string; nickname: string; delta: number; detail: string }>;
  history: Array<{
    round: number;
    banker: number;
    heaven: number;
    earth: number;
    human: number;
    winningDoors: string[];
  }>;
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

const DOOR_KEYS = ['heaven', 'earth', 'human'] as const;

const PRESET = BET_PRESET_CHIPS;

const TUI_BET_CALLS = [
  '请下注，买定离手喔！',
  '天地人三门请下注，买定离手啦！',
  '买定离手啦，马上开牌比大小！',
  '各位老板请下注，祝您三门通赢喔！',
];

function DoorCards({ cards, revealed }: { cards: Array<{ id: string; rank: number }>; revealed: boolean }) {
  const list = revealed && cards.length > 0 ? cards : [null, null];
  return (
    <div className="tui-cards mahjong-tui-cards">
      {list.map((card, index) => (
        <MahjongTile
          key={card?.id ?? `back-${index}`}
          tile={card ? (card.rank === 10 ? 'bai' : `dot${card.rank}`) : 'back'}
          isBack={!card}
          size="md"
        />
      ))}
    </div>
  );
}

export function Tuizhuanzi({ snapshot, myId, status, balance, onBet, onClear }: Props) {
  const data = snapshot as unknown as TuiSnapshot | undefined;
  /** 开牌进度：0=未开, 1=天门, 2=地门, 3=人门, 4=庄家, 5=最终通杀/通赔与胜负判定 */
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

  // 下注阶段循环播报「买定离手」等热场话语
  useEffect(() => {
    if (data?.phase !== 'bet' || status !== 'playing') return;
    const speakNext = () => {
      if (!audio.sfxOn) return;
      const line = TUI_BET_CALLS[betCallIdxRef.current % TUI_BET_CALLS.length]!;
      betCallIdxRef.current += 1;
      speakDealerQuote(line);
    };
    const firstTimer = window.setTimeout(speakNext, 700);
    const interval = window.setInterval(speakNext, 7000);
    return () => {
      window.clearTimeout(firstTimer);
      window.clearInterval(interval);
    };
  }, [data?.phase, data?.round, status]);

  // 开牌阶段：依次播报 天门点数 → 地门点数 → 人门点数 → 庄家点数 → 通杀 / 通赔判定音效与语音
  useEffect(() => {
    if (!data) return;
    const key = `${data.round}:${data.phase}`;
    if (key === lastPhaseKeyRef.current) return;
    lastPhaseKeyRef.current = key;

    const showBanner = (kind: string, text: string, sub?: string, ms = 1900) => {
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
      if (data.round > 0) audio.play('mahjong_clack');
      return;
    }

    if (data.phase === 'idle') {
      setRevealStep(5);
      return;
    }

    if (data.phase === 'reveal') {
      cancelSeqRef.current?.();
      setRevealStep(0);

      const hPts = data.doors.heaven.points ?? 0;
      const ePts = data.doors.earth.points ?? 0;
      const uPts = data.doors.human.points ?? 0;
      const bPts = data.banker.points ?? 0;

      const winCount = (hPts > bPts ? 1 : 0) + (ePts > bPts ? 1 : 0) + (uPts > bPts ? 1 : 0);
      const isTongSha = winCount === 0; // 庄家通杀（三门均不大于庄家）
      const isTongPei = winCount === 3; // 庄家通赔（天、地、人三门全赢）
      const myRow = data.results.find((r) => r.playerId === myId);

      const steps: SpeechSequenceStep[] = [
        {
          text: `天门${cnPointText(hPts)}点`,
          onStart: () => {
            setRevealStep(1);
            audio.play('mahjong_discard');
            showBanner('deal', `天门 · ${hPts} 点`, undefined, 1300);
          },
          delayAfterMs: 220,
        },
        {
          text: `地门${cnPointText(ePts)}点`,
          onStart: () => {
            setRevealStep(2);
            audio.play('mahjong_discard');
            showBanner('deal', `地门 · ${ePts} 点`, undefined, 1300);
          },
          delayAfterMs: 220,
        },
        {
          text: `人门${cnPointText(uPts)}点`,
          onStart: () => {
            setRevealStep(3);
            audio.play('mahjong_discard');
            showBanner('deal', `人门 · ${uPts} 点`, undefined, 1300);
          },
          delayAfterMs: 260,
        },
        {
          text: `庄家${cnPointText(bPts)}点`,
          onStart: () => {
            setRevealStep(4);
            audio.play('mahjong_peng');
            showBanner('street', `庄家 · ${bPts} 点`, undefined, 1400);
          },
          delayAfterMs: 320,
        },
      ];

      if (isTongSha) {
        steps.push({
          text: '庄家通杀！',
          onStart: () => {
            setRevealStep(5);
            audio.play('bomb');
            window.setTimeout(() => audio.play('lose'), 220);
            showBanner(
              'allin',
              '💥 庄家通杀！',
              `庄 ${bPts} 点力压三门（天${hPts} · 地${ePts} · 人${uPts}）`,
              2400,
            );
          },
          delayAfterMs: 0,
        });
      } else if (isTongPei) {
        steps.push({
          text: '庄家通赔，三门全赢！',
          onStart: () => {
            setRevealStep(5);
            audio.play('jackpot');
            showBanner(
              'raise',
              '👑 庄家通赔 · 三门全赢！',
              `天${hPts} · 地${ePts} · 人${uPts} 全部击败庄 ${bPts} 点`,
              2400,
            );
          },
          delayAfterMs: 0,
        });
      } else {
        steps.push({
          onStart: () => {
            setRevealStep(5);
            if (myRow && myRow.delta > 0) audio.play('win');
            else if (myRow && myRow.delta < 0) audio.play('lose');
            else audio.play('dice_open');
            const winNames = [
              hPts > bPts ? '天门' : '',
              ePts > bPts ? '地门' : '',
              uPts > bPts ? '人门' : '',
            ]
              .filter(Boolean)
              .join('、');
            showBanner(
              'showdown',
              `${winNames} 赢庄！`,
              myRow && myRow.delta !== 0
                ? myRow.delta > 0
                  ? `恭喜赢取 +${myRow.delta.toLocaleString()} 欢乐豆`
                  : `本局结算 ${myRow.delta.toLocaleString()}`
                : `庄 ${bPts} 点（天${hPts} · 地${ePts} · 人${uPts}）`,
              2100,
            );
          },
          delayAfterMs: 0,
        });
      }

      cancelSeqRef.current = speakDealerSequence(steps, { gapMs: 220, mutedStepMs: 850 });
    }
  }, [
    data?.round,
    data?.phase,
    data?.doors?.heaven?.points,
    data?.doors?.earth?.points,
    data?.doors?.human?.points,
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

  const phaseLabel = data?.phase === 'reveal' ? '依次开牌中' : data?.phase === 'idle' ? '准备下一局' : '下注中';
  const phaseClass =
    data?.phase === 'bet' ? (left <= 5 ? 'is-urgent' : 'is-open') : data?.phase === 'reveal' ? 'is-reveal' : 'is-idle';

  const canBet = data.phase === 'bet' && status === 'playing';
  const canPlace = canBet && amount > 0 && amount <= balance;
  const isRevealing = data.phase !== 'bet';
  const doorStepIndex: Record<(typeof DOOR_KEYS)[number], number> = { heaven: 1, earth: 2, human: 3 };
  const bankerRevealed = isRevealing && revealStep >= 4;
  const verdictRevealed = isRevealing && revealStep >= 5;
  const totals = data.myBet.heaven + data.myBet.earth + data.myBet.human;
  const history = data.history ?? [];

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
          {totals > 0 && <span className="lobby-game__mine">我押了 {totals.toLocaleString()}</span>}
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
              {!isRevealing
                ? '买定离手 · 天地人请下注'
                : revealStep === 1
                  ? '开天门…'
                  : revealStep === 2
                    ? '开地门…'
                    : revealStep === 3
                      ? '开人门…'
                      : revealStep === 4
                        ? '开庄家…'
                        : '开牌结算完毕'}
            </span>
          </div>
        </div>

        <div className={`banker-box ${revealStep === 4 ? 'is-focus-reveal' : ''}`}>
          <div className="banker-box__label">庄家</div>
          <DoorCards cards={data.banker.cards} revealed={bankerRevealed} />
          <div className="banker-box__points">
            {bankerRevealed && data.banker.points !== null ? `${data.banker.points} 点` : '—'}
          </div>
        </div>

        <div className="doors">
          {DOOR_KEYS.map((key) => {
            const door = data.doors[key];
            const bet = data.myBet[key] ?? 0;
            const stepNeed = doorStepIndex[key];
            const doorRevealed = isRevealing && revealStep >= stepNeed;
            const isFocused = revealStep === stepNeed;
            const won =
              verdictRevealed &&
              door.points !== null &&
              data.banker.points !== null &&
              door.points > data.banker.points;
            return (
              <button
                key={key}
                type="button"
                className={`door ${bet > 0 ? 'is-bet' : ''} ${won ? 'is-win' : ''} ${isFocused ? 'is-focus-reveal' : ''}`}
                disabled={!canPlace}
                onClick={() => {
                  audio.play('poker_chip_bet');
                  onBet(key, amount);
                }}
              >
                <span className="door__label">{door.label}门</span>
                <DoorCards cards={door.cards} revealed={doorRevealed} />
                <span className="door__points">
                  {doorRevealed && door.points !== null ? `${door.points} 点` : '待开牌'}
                </span>
                {(data.doorTotals?.[key] ?? 0) > 0 && (
                  <span className="door__pool" key={`pool-${data.doorTotals[key]}`}>
                    <img src={chipArt(data.doorTotals[key])} alt="" />
                    共押 {data.doorTotals[key].toLocaleString()}
                  </span>
                )}
                {bet > 0 && (
                  <span className="door__bet" key={bet}>
                    <img src={chipArt(bet)} alt="" />
                    我 {bet.toLocaleString()}
                    {canBet && (
                      <span
                        className="bet-cancel"
                        role="button"
                        tabIndex={0}
                        title="取消该区下注"
                        onClick={(event) => {
                          event.stopPropagation();
                          audio.play('poker_fold');
                          onClear(key);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.stopPropagation();
                            audio.play('poker_fold');
                            onClear(key);
                          }
                        }}
                      >
                        ×
                      </span>
                    )}
                  </span>
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
          {canBet && totals > 0 && (
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

        {verdictRevealed && data.results.length > 0 && (
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
        <div className="history__legend">
          <span>局</span>
          <span>庄</span>
          <span>天</span>
          <span>地</span>
          <span>人</span>
        </div>
        <div className="history__list">
          {history.length === 0 && <p className="history__empty">暂无记录</p>}
          {[...history].reverse().map((item) => (
            <div key={item.round} className="history__row">
              <span className="history__no">{item.round}</span>
              <span className="history__banker">{item.banker}</span>
              <span className={item.winningDoors.includes('heaven') ? 'is-hit' : ''}>{item.heaven}</span>
              <span className={item.winningDoors.includes('earth') ? 'is-hit' : ''}>{item.earth}</span>
              <span className={item.winningDoors.includes('human') ? 'is-hit' : ''}>{item.human}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
