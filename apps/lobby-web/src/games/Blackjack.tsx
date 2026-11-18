import { useEffect, useMemo, useRef, useState } from 'react';
import { chipArt } from '../chips';
import { DEALER_MAIN } from '../assets';
import { audio } from '../audio';
import { cnPointText, speakDealerQuote, speakDealerSequence, stopDealerSpeech, type SpeechSequenceStep } from '../speech';
import { cardArt, cardBackArt, cardLabel, isRedCard, type CardView } from './cards';
import { usePhaseCountdown } from './usePhaseCountdown';

interface BlackjackSnapshot {
  phase: string;
  round: number;
  remainMs: number;
  phaseDurationMs: number;
  dealerCards: Array<CardView | null>;
  dealerPoints: number | null;
  myCards: CardView[];
  myPoints: number | null;
  myDone: boolean;
  others: Array<{ playerId: string; count: number; done: boolean }>;
  myBet: Record<string, number>;
  zoneTotals: Record<string, number>;
  results: Array<{ playerId: string; nickname: string; delta: number; detail: string }>;
  history: Array<{ round: number; playerPoints: number | null; dealerPoints: number; outcome: string }>;
  limits: { min: number; max: number; total: number };
  areas: Array<{ area: string; label: string; odds: number }>;
}

interface Props {
  snapshot: Record<string, unknown> | null;
  myId: string;
  status: string;
  balance: number;
  onBet: (area: string, amount: number) => void;
  onClear: (area?: string) => void;
  onAction: (cmd: string, amount?: number) => void;
}

const PRESET = [10, 50, 100, 500, 1000, 2000, 5000, 10000, 100000];

const BLACKJACK_BET_CALLS = [
  '请下注，买定离手喔！',
  '二十一点火爆开局，请各位老板下注喔！',
  '买定离手啦，二十一点马上发牌！',
  '下注倒计时，买定离手咯！',
];

export function Blackjack({ snapshot, myId, status, balance, onBet, onClear, onAction }: Props) {
  const data = snapshot as unknown as BlackjackSnapshot | undefined;
  const [amount, setAmount] = useState(100);
  /** 开牌进度：0=未开牌, 1=已报庄家点数, 2=已报我的手牌点数, 3=已播报最终胜负 */
  const [revealStep, setRevealStep] = useState<number>(0);
  const [centerBanner, setCenterBanner] = useState<{ id: number; kind: string; text: string; sub?: string } | null>(
    null,
  );
  const lastPhaseKeyRef = useRef<string>('');
  const betCallIdxRef = useRef<number>(0);
  const prevCardCountRef = useRef<{ my: number; dealer: number }>({ my: 0, dealer: 0 });
  const cancelSeqRef = useRef<(() => void) | null>(null);
  const bannerIdRef = useRef<number>(1);
  const bannerTimerRef = useRef<number | null>(null);

  // 下注阶段轮播「请下注、买定离手」荷官热场语音
  useEffect(() => {
    if (data?.phase !== 'bet' || status !== 'playing') return;
    const speakNext = () => {
      if (!audio.sfxOn) return;
      const line = BLACKJACK_BET_CALLS[betCallIdxRef.current % BLACKJACK_BET_CALLS.length]!;
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

  const showBanner = (kind: string, text: string, sub?: string, ms = 1650) => {
    const id = bannerIdRef.current++;
    if (bannerTimerRef.current !== null) window.clearTimeout(bannerTimerRef.current);
    setCenterBanner({ id, kind, text, sub });
    bannerTimerRef.current = window.setTimeout(() => {
      setCenterBanner((cur) => (cur?.id === id ? null : cur));
    }, ms);
  };

  useEffect(() => {
    return () => {
      cancelSeqRef.current?.();
      stopDealerSpeech();
      if (bannerTimerRef.current !== null) window.clearTimeout(bannerTimerRef.current);
    };
  }, []);

  // 21点完整流程：开牌阶段严格按 先报庄家几点 → 再报我的手牌几点 → 最后播报你赢还是庄家赢
  useEffect(() => {
    if (!data) return;
    const phaseKey = `${data.round}:${data.phase}`;
    if (phaseKey !== lastPhaseKeyRef.current) {
      lastPhaseKeyRef.current = phaseKey;
      if (data.phase === 'bet') {
        cancelSeqRef.current?.();
        cancelSeqRef.current = null;
        setRevealStep(0);
      } else if (data.phase === 'play') {
        cancelSeqRef.current?.();
        setRevealStep(0);
        audio.play('poker_deal');
        window.setTimeout(() => audio.play('poker_deal'), 140);
        window.setTimeout(() => audio.play('poker_deal'), 280);
        if (data.myPoints === 21 && data.myCards.length === 2) {
          window.setTimeout(() => audio.play('jackpot'), 420);
          showBanner('allin', '👑 BLACKJACK 21点！', '天牌绝杀', 1800);
        } else {
          showBanner('deal', '发牌完成', '请选择 要牌 / 停牌 / 加倍', 1200);
        }
      } else if (data.phase === 'idle') {
        setRevealStep(3);
      } else if (data.phase === 'reveal') {
        cancelSeqRef.current?.();
        setRevealStep(0);

        const dPts = data.dealerPoints;
        const mPts = data.myPoints;
        const myRow = data.results.find((r) => r.playerId === myId);

        const dealerVoice =
          dPts === null ? '庄家开牌' : dPts > 21 ? '庄家爆牌！' : `庄家${cnPointText(dPts)}点`;
        const dealerSub =
          dPts === null ? '' : dPts > 21 ? `${dPts} 点（爆牌）` : `${dPts} 点`;

        const steps: SpeechSequenceStep[] = [
          {
            text: dealerVoice,
            onStart: () => {
              setRevealStep(1);
              audio.play('poker_deal');
              showBanner('street', `庄家：${dealerSub || '开牌'}`, undefined, 1600);
            },
            delayAfterMs: 320,
          },
        ];

        if (mPts !== null) {
          const myVoice = mPts > 21 ? '我的手牌爆牌！' : `我的手牌${cnPointText(mPts)}点`;
          const mySub = mPts > 21 ? `${mPts} 点（爆牌）` : `${mPts} 点`;
          steps.push({
            text: myVoice,
            onStart: () => {
              setRevealStep(2);
              audio.play('poker_deal');
              showBanner('deal', `我的手牌：${mySub}`, undefined, 1600);
            },
            delayAfterMs: 360,
          });
        }

        // 判断胜负播报：优先按我方手牌 vs 庄家手牌比较，无手牌时按结算盈亏
        let verdict: 'player' | 'dealer' | 'tie' = 'tie';
        if (mPts !== null && dPts !== null) {
          if (mPts > 21) verdict = 'dealer';
          else if (dPts > 21) verdict = 'player';
          else if (mPts > dPts) verdict = 'player';
          else if (mPts < dPts) verdict = 'dealer';
          else verdict = 'tie';
        } else if (myRow) {
          verdict = myRow.delta > 0 ? 'player' : myRow.delta < 0 ? 'dealer' : 'tie';
        }

        const verdictVoice =
          verdict === 'player'
            ? mPts === 21
              ? '二十一点，你赢了！'
              : '恭喜你赢了！'
            : verdict === 'dealer'
              ? '庄家赢了！'
              : '本局平局！';

        const verdictTitle =
          verdict === 'player'
            ? mPts === 21
              ? '👑 21点 · 你赢了！'
              : '🎉 恭喜你赢了！'
            : verdict === 'dealer'
              ? '庄家赢了'
              : '⚖️ 本局平局';

        steps.push({
          text: verdictVoice,
          onStart: () => {
            setRevealStep(3);
            if (verdict === 'player') {
              audio.play(mPts === 21 ? 'jackpot' : 'win');
            } else if (verdict === 'dealer') {
              audio.play('lose');
            } else {
              audio.play('dice_open');
            }
            showBanner(
              verdict === 'player' ? 'raise' : verdict === 'dealer' ? 'fold' : 'showdown',
              verdictTitle,
              myRow && myRow.delta !== 0
                ? myRow.delta > 0
                  ? `赢得 +${myRow.delta.toLocaleString()} 欢乐豆`
                  : `本局结算 ${myRow.delta.toLocaleString()}`
                : `庄 ${dPts ?? '—'} 点 vs 我 ${mPts ?? '—'} 点`,
              2300,
            );
          },
          delayAfterMs: 0,
        });

        cancelSeqRef.current = speakDealerSequence(steps, { gapMs: 280, mutedStepMs: 1100 });
      }
    }

    const myCount = data.myCards.length;
    const dealerCount = data.dealerCards.length;
    if (data.phase === 'play' && myCount > prevCardCountRef.current.my && prevCardCountRef.current.my > 0) {
      audio.play('poker_deal');
      if (data.myPoints !== null && data.myPoints > 21) {
        window.setTimeout(() => audio.play('poker_fold'), 140);
        showBanner('fold', `💥 爆牌 (${data.myPoints} 点)`, '超过 21 点', 1400);
      } else if (data.myPoints === 21) {
        window.setTimeout(() => audio.play('jackpot'), 160);
        showBanner('allin', '✨ 恰好 21 点！', '完美停牌', 1400);
      }
    } else if (data.phase === 'play' && dealerCount > prevCardCountRef.current.dealer && prevCardCountRef.current.dealer > 0) {
      audio.play('poker_deal');
    }
    prevCardCountRef.current = { my: myCount, dealer: dealerCount };
  }, [
    data?.round,
    data?.phase,
    data?.myCards?.length,
    data?.dealerCards?.length,
    data?.myPoints,
    data?.dealerPoints,
    data?.results,
    myId,
  ]);

  const canBet = data?.phase === 'bet' && status === 'playing';
  const playing = data?.phase === 'play' && status === 'playing';
  const betting = useMemo(
    () => Object.values(data?.myBet ?? {}).reduce((sum, value) => sum + (value ?? 0), 0),
    [data?.myBet],
  );
  const canPlace = canBet && amount > 0 && amount <= balance;

  const rankedResults = useMemo(() => {
    const list = [...(data?.results ?? [])];
    list.sort((a, b) => {
      const aBot = a.playerId.startsWith('ambient:');
      const bBot = b.playerId.startsWith('ambient:');
      if (aBot !== bBot) return aBot ? 1 : -1;
      return b.delta - a.delta;
    });
    const mine = list.filter((row) => row.playerId === myId);
    const rest = list.filter((row) => row.playerId !== myId);
    return [...mine, ...rest].slice(0, 12);
  }, [data?.results, myId]);

  const { leftSec: left, progressPct: progress } = usePhaseCountdown(
    data?.remainMs,
    data?.phaseDurationMs,
    data?.phase,
    data?.round,
    25_000,
  );

  if (!data) return <div className="board-placeholder">等待发牌…</div>;

  const handleHit = () => {
    audio.play('poker_deal');
    onAction('hit');
  };

  const handleStand = () => {
    audio.play('poker_check');
    showBanner('check', '停牌 (Stand)', data.myPoints !== null ? `锁定 ${data.myPoints} 点` : undefined, 1100);
    onAction('stand');
  };

  const handleDouble = () => {
    audio.play('poker_raise');
    showBanner('raise', '加倍 (Double)！', '双倍下注再要 1 张', 1300);
    onAction('double');
  };

  const isRevealing = data.phase === 'reveal' || data.phase === 'idle';
  const dealerPointsVisible = !isRevealing || revealStep >= 1;
  const resultsVisible = !isRevealing || revealStep >= 3;

  return (
    <div className="lobby-game lobby-game--bj lobby-game--poker-pro">
      {centerBanner && (
        <div key={centerBanner.id} className={`texas-fx-banner is-${centerBanner.kind}`} role="status" aria-live="polite">
          <strong>{centerBanner.text}</strong>
          {centerBanner.sub && <span>{centerBanner.sub}</span>}
        </div>
      )}

      <div className="lobby-game__main">
        {/* 顶部状态条 */}
        <div className="lobby-game__bar">
          <span className="lobby-game__round">第 {data.round} 局</span>
          <span
            className={`lobby-game__phase ${
              data.phase === 'bet' ? (left <= 5 ? 'is-urgent' : 'is-open') : 'is-reveal'
            }`}
          >
            {data.phase === 'bet' ? `下注阶段 · ${left}s` : data.phase === 'play' ? `要牌决战 · ${left}s` : '结算开牌'}
          </span>
          {betting > 0 && <span className="lobby-game__mine">已下注 {betting.toLocaleString()}</span>}
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
              {playing
                ? '要牌还是停牌呢？'
                : data.phase === 'reveal'
                  ? revealStep <= 1
                    ? '报庄家点数…'
                    : revealStep === 2
                      ? '报玩家点数…'
                      : '宣布本局胜负'
                  : '21点 · 买定离手'}
            </span>
          </div>
        </div>

        {/* 庄家手牌与我的超大高清手牌展台 */}
        <div className="dice-stage__cards bj-table-cards bj-table-cards--pro">
          <div className={`bj-row ${revealStep === 1 ? 'is-focus-reveal' : ''}`}>
            <span className="bj-row__tag">庄家手牌</span>
            <div className="bj-row__hand">
              {data.dealerCards.length === 0 ? (
                <>
                  <span className="pcard pcard--back poker-stage-card">
                    <img src={cardBackArt()} alt="" draggable={false} />
                  </span>
                  <span className="pcard pcard--back poker-stage-card">
                    <img src={cardBackArt()} alt="" draggable={false} />
                  </span>
                </>
              ) : (
                data.dealerCards.map((card, index) => (
                  <span
                    key={card?.id ?? `hole-${index}`}
                    className={`pcard poker-stage-card ${card && isRedCard(card) ? 'is-red' : ''} ${
                      !card ? 'pcard--back' : ''
                    }`}
                  >
                    <img src={card ? cardArt(card.id) : cardBackArt()} alt={card ? cardLabel(card) : ''} draggable={false} />
                  </span>
                ))
              )}
            </div>
            {dealerPointsVisible && data.dealerPoints !== null && (
              <strong className={`bj-row__points ${data.dealerPoints > 21 ? 'is-bust' : ''}`}>
                {data.dealerPoints > 21 ? `${data.dealerPoints} 点 (爆牌)` : `${data.dealerPoints} 点`}
              </strong>
            )}
          </div>

          <div className={`bj-row ${revealStep === 2 ? 'is-focus-reveal' : ''}`}>
            <span className="bj-row__tag">我的手牌</span>
            <div className="bj-row__hand">
              {data.myCards.length === 0 ? (
                <span className="muted">下注后立即发牌</span>
              ) : (
                data.myCards.map((card) => (
                  <span key={card.id} className={`pcard poker-stage-card ${isRedCard(card) ? 'is-red' : ''}`}>
                    <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
                  </span>
                ))
              )}
            </div>
            {data.myPoints !== null && (
              <strong
                className={`bj-row__points ${data.myPoints > 21 ? 'is-bust' : data.myPoints === 21 ? 'is-bj21' : ''}`}
              >
                {data.myPoints > 21
                  ? `${data.myPoints} 点 (爆牌)`
                  : data.myPoints === 21
                    ? '21 点 ★'
                    : `${data.myPoints} 点`}
              </strong>
            )}
          </div>
        </div>

        {/* 要牌 / 停牌 / 加倍 操作区 */}
        {playing && !data.myDone && (
          <div className="bj-actions hand-actions--luxury">
            <button type="button" className="action-btn texas-btn-call" onClick={handleHit}>
              + 要牌 (Hit)
            </button>
            <button type="button" className="action-btn texas-btn-fold" onClick={handleStand}>
              停牌 (Stand)
            </button>
            {data.myCards.length === 2 && balance >= betting && (
              <button type="button" className="action-btn texas-btn-raise" onClick={handleDouble}>
                🔥 加倍 (Double)
              </button>
            )}
          </div>
        )}

        {/* 21点下注区域 */}
        <div className="bj-bet-zones bj-bet-zones--prominent">
          {(data.areas ?? [
            { area: 'win', label: '闲胜 (Win)', odds: 1 },
            { area: 'lose', label: '庄胜 (Lose)', odds: 1 },
            { area: 'tie', label: '和局 (Push)', odds: 8 },
            { area: 'bj', label: '21点 (Blackjack)', odds: 2 },
          ]).map((area) => {
            const bet = data.myBet[area.area] ?? 0;
            const pool = data.zoneTotals?.[area.area] ?? 0;
            return (
              <button
                key={area.area}
                type="button"
                className={`bj-zone-btn ${bet > 0 ? 'is-bet' : ''}`}
                disabled={!canPlace}
                onClick={() => {
                  audio.play('poker_chip_bet');
                  onBet(area.area, amount);
                }}
              >
                <div className="bj-zone-header">
                  <span className="bj-zone-label">{area.label}</span>
                  <span className="bj-zone-odds">1:{area.odds}</span>
                </div>
                {pool > 0 && <span className="bj-zone-pool">全台 {pool.toLocaleString()}</span>}
                {bet > 0 ? (
                  <span className="bj-zone-mybet">
                    <img src={chipArt(bet)} alt="" />
                    <span>我已押 {bet.toLocaleString()}</span>
                    {canBet && (
                      <span
                        className="bet-cancel"
                        role="button"
                        tabIndex={0}
                        title="取消该选项下注"
                        onClick={(event) => {
                          event.stopPropagation();
                          audio.play('poker_fold');
                          onClear(area.area);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.stopPropagation();
                            audio.play('poker_fold');
                            onClear(area.area);
                          }
                        }}
                      >
                        ×
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="bj-zone-empty">{canBet ? '点击放筹码' : '未下注'}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* 下注控制区 */}
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

        {/* 结果栏 */}
        {resultsVisible && data.results.length > 0 && (
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

      {/* 历史走势 */}
      <aside className="history">
        <div className="history__title">走势</div>
        <div className="history__legend">
          <span>局</span>
          <span>我</span>
          <span>庄</span>
          <span>果</span>
        </div>
        <div className="history__list">
          {data.history.length === 0 && <p className="history__empty">暂无记录</p>}
          {[...data.history].reverse().map((item) => (
            <div key={item.round} className="history__row">
              <span className="history__no">{item.round}</span>
              <span>{item.playerPoints ?? '—'}</span>
              <span>{item.dealerPoints}</span>
              <span className={item.outcome === 'win' ? 'is-hit' : ''}>
                {item.outcome === 'win' ? '胜' : item.outcome === 'lose' ? '负' : '平'}
              </span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
