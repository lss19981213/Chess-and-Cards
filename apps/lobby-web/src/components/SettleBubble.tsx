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
  /** 点击右上角 X 或「返回主页」：立即退出牌桌返回大厅主页 */
  onClose: () => void;
  /** 常驻玩法 8 秒自动收起气泡（仅隐藏提示，不退出房间） */
  onAutoDismiss?: () => void;
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
  'cs-mahjong': '长沙麻将',
  'sc-mahjong': '四川血战麻将',
  'gd-mahjong': '广东推倒胡',
  'guobiao-mahjong': '国标麻将',
  'hz-mahjong': '红中麻将',
};

/**
 * 结算展示组件：
 * - 常驻百人场（百家乐/21点/骰宝/斗牛/推筒子）：顶部轻量浮动战报条（8 秒自动收起，不阻挡下注）
 * - 对战/牌桌类（德州/斗地主/跑得快/金花/梭哈/麻将/棋类）：居中精美皇家结算弹窗，绝不变形
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
  onAutoDismiss,
}: Props) {
  const [closing, setClosing] = useState(false);
  const safeRows = Array.isArray(rows) ? rows : [];
  const mine = safeRows.find((row) => row?.playerId === myId);
  const delta = mine?.delta ?? 0;
  const isWin = delta > 0;
  const isLose = delta < 0;

  const ranked = [...safeRows].sort((a, b) => (b?.delta ?? 0) - (a?.delta ?? 0));
  const gameTitle = GAME_NAME[gameId] ?? gameId;

  // 常驻玩法 8 秒后仅自动收起气泡（绝不退出房间），不阻挡下注
  useEffect(() => {
    if (persistent) {
      const timer = window.setTimeout(() => {
        setClosing(true);
        window.setTimeout(() => (onAutoDismiss ?? (() => {}))(), 260);
      }, 8000);
      return () => window.clearTimeout(timer);
    }
  }, [persistent, onAutoDismiss]);

  const handleExitToLobby = () => {
    audio.play('click');
    onClose();
  };

  const handleContinue = () => {
    audio.play('click');
    setClosing(true);
    window.setTimeout(onContinue, 180);
  };

  // 1) 非百人常驻玩法：居中精美皇家战报弹窗（彻底告别挤压变形）
  if (!persistent) {
    const heroTitle = isWin ? '大获全胜' : isLose ? '虽败犹荣' : '势均力敌';
    const heroSub = isWin ? '手气如虹 · 筹码满载而归' : isLose ? '胜败乃兵家常事 · 下局翻盘' : '旗鼓相当 · 不相上下';
    const stateClass = isWin ? 'is-win' : isLose ? 'is-lose' : 'is-draw';

    return (
      <div
        className={`settle-modal-backdrop ${closing ? 'is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="对局结算战报"
      >
        <div className={`settle-modal-card ${stateClass} ${closing ? 'is-closing' : ''}`}>
          {/* 顶部装饰流光条 */}
          <div className="settle-modal__glow" aria-hidden="true" />

          {/* 右上角关闭按钮：立即返回大厅主页 */}
          <button
            type="button"
            className="settle-modal__close"
            onClick={handleExitToLobby}
            title="退出牌桌并返回主页"
            aria-label="退出牌桌并返回主页"
          >
            ✕
          </button>

          {/* 徽章与主标题 */}
          <div className="settle-modal__header">
            <div className="settle-modal__crest" aria-hidden="true">
              {isWin ? '👑' : isLose ? '🛡️' : '⚖️'}
            </div>
            <h2 className="settle-modal__title">{heroTitle}</h2>
            <p className="settle-modal__subtitle">{heroSub}</p>
            <span className="settle-modal__meta-pill">
              {gameTitle} · 第 <strong>{round}</strong> 局
            </span>
          </div>

          {/* 本局筹码盈亏主展台 */}
          <div className="settle-modal__payout">
            <div className={`settle-modal__delta ${delta > 0 ? 'is-pos' : delta < 0 ? 'is-neg' : ''}`}>
              <Chip size={24} />
              <strong>{delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString()}</strong>
            </div>
            <div className="settle-modal__balance">
              当前余额：<span>{balance.toLocaleString()}</span> 欢乐豆
            </div>
          </div>

          {/* 精致竖排本局积分榜单（支持 2~6 人优雅展示，绝不挤压变形） */}
          {ranked.length > 0 && (
            <div className="settle-modal__ranks">
              <div className="settle-modal__ranks-head">
                <span>本局战绩排行</span>
                <span>筹码变动</span>
              </div>
              <div className="settle-modal__ranks-list">
                {ranked.map((row, idx) => {
                  const rowIsMe = row.playerId === myId;
                  const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
                  return (
                    <div key={row.playerId} className={`settle-rank-row ${rowIsMe ? 'is-me' : ''}`}>
                      <span className="settle-rank-row__medal">{medal}</span>
                      <span className="settle-rank-row__name">
                        {row.nickname}
                        {rowIsMe && <em className="settle-tag is-me">我</em>}
                        {row.isBot && <em className="settle-tag is-ai">AI</em>}
                      </span>
                      <strong
                        className={`settle-rank-row__delta ${
                          row.delta > 0 ? 'is-pos' : row.delta < 0 ? 'is-neg' : ''
                        }`}
                      >
                        {row.delta > 0 ? `+${row.delta.toLocaleString()}` : row.delta.toLocaleString()}
                      </strong>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 底部行动按钮区 */}
          <div className="settle-modal__actions">
            <button type="button" className="settle-modal__btn settle-modal__btn--ghost" onClick={handleExitToLobby}>
              返回主页
            </button>
            <button type="button" className="settle-modal__btn settle-modal__btn--gold" onClick={handleContinue}>
              ✦ 再来一局 ✦
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2) 常驻百人场：顶部轻量非阻断战报气泡
  const titleText = isWin ? '旗开得胜 · 收益入账' : isLose ? '局结惜败 · 虽败犹荣' : '本局平局 · 势均力敌';

  return (
    <aside className="settle-bubble-viewport" aria-label="对局结算战报">
      <div
        className={`settle-bubble-card ${isWin ? 'is-win' : isLose ? 'is-lose' : 'is-draw'} ${
          closing ? 'is-closing' : ''
        }`}
      >
        <div className="settle-bubble__hero">
          <span className="settle-bubble__badge">{isWin ? '👑 胜' : isLose ? '🛡️ 负' : '⚖️ 平'}</span>
          <div className="settle-bubble__title-col">
            <strong className="settle-bubble__title">{titleText}</strong>
            <span className="settle-bubble__meta">
              {gameTitle} · 第 <strong>{round}</strong> 局
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

        <div className="settle-bubble__actions">
          <button
            type="button"
            className="bubble-btn bubble-btn--close"
            onClick={handleExitToLobby}
            title="退出牌桌并返回主页"
            aria-label="退出牌桌并返回主页"
          >
            ✕
          </button>
        </div>
      </div>
    </aside>
  );
}
