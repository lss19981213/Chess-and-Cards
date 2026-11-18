import { useEffect, useState } from 'react';

export interface SystemMaintenanceState {
  mode: 'normal' | 'draining' | 'updating';
  message: string;
  compensationCoins: number;
  activeHumanGames: number;
}

interface OverlayProps {
  state: SystemMaintenanceState;
  inRoom: boolean;
  onRetryNow: () => void;
}

/**
 * 平台维护与优雅更新 UI：
 * - draining 阶段：顶部轻量醒目提示条（不遮挡正在进行中的牌局，让玩家安心打完本局）
 * - updating / 502 / 503 阶段：全屏豪华「平台正在紧急更新中」等待页，彻底告别生硬 502 报错
 */
export function MaintenanceOverlay({ state, inRoom, onRetryNow }: OverlayProps) {
  const [dots, setDots] = useState('…');

  useEffect(() => {
    if (state.mode !== 'updating') return;
    const seq = ['.', '..', '...', '…'];
    let i = 0;
    const t = window.setInterval(() => {
      i = (i + 1) % seq.length;
      setDots(seq[i]!);
    }, 550);
    return () => window.clearInterval(t);
  }, [state.mode]);

  if (state.mode === 'normal') return null;

  const coinsText = (state.compensationCoins || 1000).toLocaleString();

  if (state.mode === 'draining') {
    return (
      <div className="maintenance-drain-banner" role="status" aria-live="polite">
        <span className="maintenance-drain-banner__badge">🛠️ 即将更新</span>
        <span className="maintenance-drain-banner__text">
          {inRoom
            ? `平台即将紧急更新：请安心打完本局，结束后暂停开新局 · 更新完成后自动补偿 ${coinsText} 欢乐豆！`
            : `平台即将紧急更新（等待进行中的 ${Math.max(0, state.activeHumanGames)} 桌对局结束），当前暂停开始新游戏 · 更新完自动补偿 ${coinsText} 欢乐豆！`}
        </span>
      </div>
    );
  }

  return (
    <div className="maintenance-fullscreen" role="alertdialog" aria-modal="true" aria-label="平台正在紧急更新中">
      <div className="maintenance-card">
        <div className="maintenance-card__emblem" aria-hidden="true">
          🛠️
        </div>
        <h2 className="maintenance-card__title">平台正在紧急更新中{dots}</h2>
        <p className="maintenance-card__sub">
          {state.message || '我们正在为您部署全新功能与体验升级，请耐心等待，恢复后将自动刷新进入大厅。'}
        </p>

        <div className="maintenance-card__reward">
          <span>🎁</span>
          <span>
            更新完成后，平台将自动为每位玩家补偿 <strong>{coinsText} 欢乐豆</strong>（前往信箱领取）
          </span>
        </div>

        <div className="maintenance-card__bar" aria-hidden="true">
          <i />
        </div>

        <p className="maintenance-card__hint">每 3 秒自动检测平台恢复状态，恢复后将立即自动重连</p>

        <button type="button" className="maintenance-card__btn" onClick={onRetryNow}>
          立即检测恢复
        </button>
      </div>
    </div>
  );
}
