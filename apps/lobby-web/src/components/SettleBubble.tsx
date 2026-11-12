import { useEffect, useState } from 'react';
import { audio } from '../audio';
import { Chip } from './Chip';

export interface ResultRow {
  playerId: string;
  nickname: string;
  delta: number;
  isBot?: boolean;
}

interface Props {
  gameId: string;
  round: number;
  rows: ResultRow[];
  myId: string;
  balance: number;
  persistent: boolean;
  onContinue: () => void;
  onClose: () => void;
}

const GAME_NAME: Record<string, string> = {
  gomoku: '五子棋',
  doudizhu: '斗地主',
  paodekuai: '跑得快',
  tuizhuanzi: '推筒子',
  texas: '德州扑克',
  dice: '骰宝',
  baccarat: '百家乐',
  niuniu: '斗牛',
  blackjack: '21点',
  stud: '梭哈',
  goldenflower: '翻金花',
  chess: '国际象棋',
  xiangqi: '中国象棋',
};

/**
 * 结算气泡 HUD (彻底告别遮挡牌桌的弹窗，轻量浮动于牌桌上方，非阻断式战报)
 */
export function SettleBubble({
  gameId,
  round,
  rows,
  myId,
  balance,
  persistent,
  onContinue,
  onClose,
}: Props) {
  const [closing, setClosing] = useState(false);
  const safeRows = Array.isArray(rows) ? rows : [];
  const mine = safeRows.find((row) => row?.playerId === myId);
  const delta = mine?.delta ?? 0;
  const isWin = delta > 0;
  const isLose = delta < 0;

  const ranked = [...safeRows].sort((a, b) => (b?.delta ?? 0) - (a?.delta ?? 0));
  const titleText = isWin ? '旗开得胜 · 收益入账' : isLose ? '局结惜败 · 虽败犹荣' : '本局平局 · 势均力敌';

  // 常驻玩法 8 秒后自动收起气泡，不阻挡下注
  useEffect(() => {
    if (persistent) {
      const timer = window.setTimeout(() => {
        handleDismiss();
      }, 8000);
      return () => window.clearTimeout(timer);
    }
  }, [persistent]);

  const handleDismiss = () => {
    setClosing(true);
    window.setTimeout(onClose, 260);
  };

  const handleContinue = () => {
    audio.play('click');
    setClosing(true);
    window.setTimeout(onContinue, 200);
  };

  return (
    <aside className="settle-bubble-viewport" aria-label="对局结算战报">
      <div
        className={`settle-bubble-card ${isWin ? 'is-win' : isLose ? 'is-lose' : 'is-draw'} ${
          closing ? 'is-closing' : ''
        }`}
      >
        {/* 左侧胜负徽章与主收益 */}
        <div className="settle-bubble__hero">
          <span className="settle-bubble__badge">{isWin ? '👑 胜' : isLose ? '🛡️ 负' : '⚖️ 平'}</span>
          <div className="settle-bubble__title-col">
            <strong className="settle-bubble__title">{titleText}</strong>
            <span className="settle-bubble__meta">
              {GAME_NAME[gameId] ?? gameId} · 第 <strong>{round}</strong> 局
            </span>
          </div>
          <div className="settle-bubble__delta-badge">
            <strong className={`bubble-delta-val ${delta > 0 ? 'is-pos' : delta < 0 ? 'is-neg' : ''}`}>
              {delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString()}
            </strong>
            <div className="bubble-balance-pill">
              <Chip size={13} />
              <span>{balance.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* 中间积分榜胶囊条 (一行展开，直观清晰) */}
        {ranked.length > 1 && (
          <div className="settle-bubble__scoreboard">
            {ranked.map((row, idx) => {
              const rowIsMe = row.playerId === myId;
              return (
                <div key={row.playerId} className={`bubble-player-chip ${rowIsMe ? 'is-me' : ''}`}>
                  <span className="rank-dot">{idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'}</span>
                  <span className="player-name">{row.nickname}</span>
                  {row.isBot && <em className="ai-tag">人机</em>}
                  <strong className={`player-delta ${row.delta > 0 ? 'is-pos' : row.delta < 0 ? 'is-neg' : ''}`}>
                    {row.delta > 0 ? `+${row.delta.toLocaleString()}` : row.delta.toLocaleString()}
                  </strong>
                </div>
              );
            })}
          </div>
        )}

        {/* 右侧行动按键 */}
        <div className="settle-bubble__actions">
          {!persistent && (
            <button type="button" className="bubble-btn bubble-btn--gold" onClick={handleContinue}>
              ✦ 再来一局 (准备) ✦
            </button>
          )}
          <button
            type="button"
            className="bubble-btn bubble-btn--close"
            onClick={() => {
              audio.play('click');
              handleDismiss();
            }}
            title="收起战报气泡"
          >
            ✕
          </button>
        </div>
      </div>
    </aside>
  );
}
