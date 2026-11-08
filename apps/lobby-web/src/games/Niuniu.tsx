import { useMemo, useState } from 'react';
import { chipArt } from '../chips';
import { DEALER_MAIN } from '../assets';
import { audio } from '../audio';
import { cardArt, cardBackArt, cardLabel, type CardView } from './cards';

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
  areas: Array<{ area: string; label: string }>;
}

interface Props {
  snapshot: Record<string, unknown> | null;
  myId: string;
  status: string;
  balance: number;
  onBet: (area: string, amount: number) => void;
  onClear: (area?: string) => void;
}

const PRESET = [10, 50, 100, 500, 1000];

export function Niuniu({ snapshot, myId, status, balance, onBet, onClear }: Props) {
  const data = snapshot as unknown as NiuniuSnapshot | undefined;
  const [amount, setAmount] = useState(100);

  const canBet = data?.phase === 'bet' && status === 'playing';
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

  const left = Math.max(0, Math.ceil((data?.remainMs ?? 0) / 1000));
  const duration = Math.max(1, Math.round((data?.phaseDurationMs ?? 30000) / 1000));
  const progress = Math.min(100, Math.max(0, ((duration - left) / duration) * 100));

  if (!data) return <div className="board-placeholder">等待发牌…</div>;

  return (
    <div className="lobby-game lobby-game--niuniu">
      <div className="lobby-game__main">
        {/* 顶部状态条 */}
        <div className="lobby-game__bar">
          <span className="lobby-game__round">第 {data.round} 局</span>
          <span className={`lobby-game__phase ${data.phase === 'bet' ? 'is-open' : 'is-reveal'}`}>
            {data.phase === 'bet' ? `下注阶段 · ${left}s` : `开牌核算中`}
          </span>
          {betting > 0 && <span className="lobby-game__mine">已下注 {betting}</span>}
          <div className="phase-progress"><i style={{ width: `${progress}%` }} /></div>
        </div>

        {/* 动漫美女荷官专属席位 */}
        <div className="table-dealer-host">
          <div className="dealer-mini-portrait">
            <img src={DEALER_MAIN} alt="荷官艾莉丝" draggable={false} />
          </div>
          <div className="dealer-text-badge">
            <span className="dealer-title">荷官·艾莉丝</span>
            <span className="dealer-action">{data.phase === 'bet' ? '开盅请下注' : '看牌比点中'}</span>
          </div>
        </div>

        {/* 庄家手牌展示 */}
        <div className="banker-box niuniu-banker-box">
          <div className="banker-box__label">庄家手牌</div>
          <div className="niuniu-cards-row">
            {data.cards.length === 0 ? (
              [0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="pcard pcard--back">
                  <img src={cardBackArt()} alt="" draggable={false} />
                </span>
              ))
            ) : (
              data.cards.map((card) => (
                <span key={card.id} className="pcard">
                  <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
                </span>
              ))
            )}
          </div>
          <div className="banker-box__points">
            {data.label ? <strong className="niuniu-result-badge">{data.label}</strong> : '待开牌'}
          </div>
        </div>

        {/* 下注区域 */}
        <div className="doors niuniu-doors">
          {(data.areas ?? [{ area: 'normal', label: '平倍' }, { area: 'double', label: '翻倍' }]).map((area) => {
            const bet = data.myBet[area.area] ?? 0;
            return (
              <button
                key={area.area}
                type="button"
                className={`door ${bet > 0 ? 'is-bet' : ''}`}
                disabled={!canPlace}
                onClick={() => {
                  audio.play('chip_clack');
                  onBet(area.area, amount);
                }}
              >
                <span className="door__label">{area.label}</span>
                <span className="door__points">
                  {(data.zoneTotals?.[area.area] ?? 0) > 0 ? `共押 ${data.zoneTotals[area.area]}` : '可下注'}
                </span>
                {bet > 0 && (
                  <span className="door__bet">
                    <img src={chipArt(bet)} alt="" />
                    我 {bet}
                    {canBet && (
                      <span
                        className="bet-cancel"
                        role="button"
                        tabIndex={0}
                        title="取消该区下注"
                        onClick={(e) => {
                          e.stopPropagation();
                          audio.play('click');
                          onClear(area.area);
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
                audio.play('click');
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
                {row.playerId === myId ? '我' : row.nickname} {row.delta > 0 ? `+${row.delta}` : row.delta}
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
