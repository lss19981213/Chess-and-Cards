import { useEffect, useMemo, useRef, useState } from 'react';
import { chipArt } from '../chips';
import { DEALER_MAIN } from '../assets';
import { audio } from '../audio';
import { cardArt, cardBackArt, cardLabel, isRedCard, type CardView } from './cards';

interface NiuniuSnapshot {
  phase: string;
  round: number;
  remainMs: number;
  phaseDurationMs: number;
  cards: CardView[];
  niu: number | null;
  label: string;
  myBet: Record<string, number>;
  zoneTotals: Record<string, number>;
  results: Array<{ playerId: string; nickname: string; delta: number; detail: string }>;
  history: Array<{ round: number; cards: number[]; niu: number; label: string }>;
  limits: { min: number; max: number; total: number };
  areas: Array<{ area: string; label: string; odds?: number }>;
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

function niuValueToArea(niu: number | null): string | null {
  if (niu === null || niu === undefined) return null;
  if (niu === 0) return 'none';
  if (niu >= 10) return 'niu-n';
  return `niu-${niu}`;
}

export function Niuniu({ snapshot, myId, status, balance, onBet, onClear }: Props) {
  const data = snapshot as unknown as NiuniuSnapshot | undefined;
  const [amount, setAmount] = useState(100);
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

  // 监听开牌与结算阶段，播放真实发牌声 + 胜负音效 + 居中动效横幅
  useEffect(() => {
    if (!data) return;
    const key = `${data.round}:${data.phase}`;
    if (key === lastPhaseKeyRef.current) return;
    lastPhaseKeyRef.current = key;

    const showBanner = (kind: string, text: string, sub?: string, ms = 1750) => {
      const id = bannerIdRef.current++;
      if (bannerTimerRef.current !== null) window.clearTimeout(bannerTimerRef.current);
      setCenterBanner({ id, kind, text, sub });
      bannerTimerRef.current = window.setTimeout(() => {
        setCenterBanner((cur) => (cur?.id === id ? null : cur));
      }, ms);
    };

    if (data.phase !== 'bet' && data.cards.length > 0) {
      [0, 110, 220, 330, 440].forEach((delay) => {
        window.setTimeout(() => audio.play('poker_deal'), delay);
      });
      const myRow = data.results.find((r) => r.playerId === myId);
      window.setTimeout(() => {
        if (data.niu !== null && data.niu >= 10) {
          audio.play('jackpot');
        } else if (myRow && myRow.delta > 0) {
          audio.play('win');
        } else if (myRow && myRow.delta < 0) {
          audio.play('lose');
        }
      }, 540);

      const isBig = data.niu !== null && data.niu >= 8;
      showBanner(
        isBig ? 'allin' : 'showdown',
        `🐮 庄家开出：${data.label || '结算中'}`,
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
  }, [data?.round, data?.phase, data?.cards?.length, data?.niu, data?.label, data?.results, myId]);

  const canBet = data?.phase === 'bet' && status === 'playing';
  const betting = useMemo(
    () => Object.values(data?.myBet ?? {}).reduce((sum, value) => sum + (value ?? 0), 0),
    [data?.myBet],
  );
  const canPlace = canBet && amount > 0 && amount <= balance;
  const hitArea = data?.phase !== 'bet' ? niuValueToArea(data?.niu ?? null) : null;

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

  const left = Math.max(0, Math.ceil((data?.remainMs ?? 0) / 1000));
  const duration = Math.max(1, Math.round((data?.phaseDurationMs ?? 30000) / 1000));
  const progress = Math.min(100, Math.max(0, ((duration - left) / duration) * 100));

  if (!data) return <div className="board-placeholder">等待发牌…</div>;

  return (
    <div className="lobby-game lobby-game--niuniu lobby-game--poker-pro">
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
          <span className={`lobby-game__phase ${data.phase === 'bet' ? (left <= 5 ? 'is-urgent' : 'is-open') : 'is-reveal'}`}>
            {data.phase === 'bet' ? `下注阶段 · ${left}s` : '开牌核算中'}
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
            <span className="dealer-action">{data.phase === 'bet' ? '五张牛牛 · 买定离手' : '亮牌比牛中'}</span>
          </div>
        </div>

        {/* 庄家超大清晰手牌展示 */}
        <div className="banker-box niuniu-banker-box">
          <div className="banker-box__label">庄家五张牌</div>
          <div className="niuniu-cards-row niuniu-cards-row--pro">
            {data.cards.length === 0
              ? [0, 1, 2, 3, 4].map((i) => (
                  <span key={i} className="pcard pcard--back poker-stage-card">
                    <img src={cardBackArt()} alt="" draggable={false} />
                  </span>
                ))
              : data.cards.map((card, idx) => (
                  <span
                    key={card.id}
                    className={`pcard poker-stage-card ${isRedCard(card) ? 'is-red' : ''}`}
                    style={{ ['--i' as string]: idx }}
                  >
                    <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
                  </span>
                ))}
          </div>
          <div className="banker-box__points">
            {data.label ? <strong className="niuniu-result-badge">{data.label}</strong> : '等待开牌…'}
          </div>
        </div>

        {/* 下注区域 */}
        <div className="niuniu-doors--luxury">
          {(data.areas ?? [
            { area: 'none', label: '无牛', odds: 1 },
            { area: 'niu-1', label: '牛一', odds: 2 },
            { area: 'niu-2', label: '牛二', odds: 2 },
            { area: 'niu-3', label: '牛三', odds: 2 },
            { area: 'niu-4', label: '牛四', odds: 2 },
            { area: 'niu-5', label: '牛五', odds: 2 },
            { area: 'niu-6', label: '牛六', odds: 2 },
            { area: 'niu-7', label: '牛七', odds: 2 },
            { area: 'niu-8', label: '牛八', odds: 3 },
            { area: 'niu-9', label: '牛九', odds: 4 },
            { area: 'niu-n', label: '牛牛', odds: 5 },
          ]).map((area) => {
            const bet = data.myBet[area.area] ?? 0;
            const pool = data.zoneTotals?.[area.area] ?? 0;
            const odds =
              area.odds ??
              (area.area === 'none' ? 1 : area.area === 'niu-n' ? 5 : area.area === 'niu-9' ? 4 : area.area === 'niu-8' ? 3 : 2);
            const isNiuNiu = area.area === 'niu-n';
            const isHit = hitArea === area.area;
            return (
              <button
                key={area.area}
                type="button"
                className={`niuniu-door-card ${bet > 0 ? 'is-bet' : ''} ${isNiuNiu ? 'is-niuniu' : ''} ${
                  isHit ? 'is-win' : ''
                }`}
                disabled={!canPlace}
                onClick={() => {
                  audio.play('poker_chip_bet');
                  onBet(area.area, amount);
                }}
              >
                <div className="niuniu-door-top">
                  <span className="niuniu-door-name">{area.label}</span>
                  <span className="niuniu-door-payout">1赔{odds}</span>
                </div>
                {pool > 0 && <span className="niuniu-door-pool">全台 {pool.toLocaleString()}</span>}
                {bet > 0 ? (
                  <span className="niuniu-door-mybet">
                    <img src={chipArt(bet)} alt="" />
                    <span>我押 {bet.toLocaleString()}</span>
                    {canBet && (
                      <span
                        className="bet-cancel"
                        role="button"
                        tabIndex={0}
                        title="取消该区下注"
                        onClick={(e) => {
                          e.stopPropagation();
                          audio.play('poker_fold');
                          onClear(area.area);
                        }}
                      >
                        ×
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="niuniu-door-empty">{canBet ? '点击放筹码' : '未下注'}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* 筹码控制栏 */}
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
        </div>

        {/* 结果明细 */}
        {data.results.length > 0 && (
          <div className="lobby-results">
            {rankedResults.map((row) => (
              <span
                key={row.playerId}
                className={`${row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : 'muted'} ${
                  row.playerId === myId ? 'is-me' : ''
                }`}
              >
                {row.playerId === myId ? '我' : row.nickname} {row.delta > 0 ? `+${row.delta.toLocaleString()}` : row.delta.toLocaleString()}
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
          <span>牌型</span>
          <span>点数</span>
        </div>
        <div className="history__list">
          {data.history.length === 0 && <p className="history__empty">暂无记录</p>}
          {[...data.history].reverse().map((item) => (
            <div key={item.round} className="history__row">
              <span className="history__no">{item.round}</span>
              <span className="history__banker">{item.label}</span>
              <span>{item.niu !== null ? `${item.niu}点` : '—'}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
