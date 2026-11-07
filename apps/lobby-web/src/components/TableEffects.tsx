import { useEffect, useState } from 'react';

/**
 * 牌桌殿堂级全局特效层 (Table FX Layer)
 * 包含炸弹轰炸、火箭升空、顺子流光、摇骰开盅与全屏震颤
 */

export interface EffectTrigger {
  id: string;
  type: 'bomb' | 'rocket' | 'shunzi' | 'allin' | 'jackpot' | 'dice';
  text?: string;
}

interface Props {
  trigger: EffectTrigger | null;
  onComplete?: () => void;
}

export function TableEffects({ trigger, onComplete }: Props) {
  const [activeEffect, setActiveEffect] = useState<EffectTrigger | null>(null);

  useEffect(() => {
    if (!trigger) return;
    setActiveEffect(trigger);
    const duration = trigger.type === 'rocket' ? 2200 : 1600;
    const timer = window.setTimeout(() => {
      setActiveEffect(null);
      onComplete?.();
    }, duration);
    return () => window.clearTimeout(timer);
  }, [trigger, onComplete]);

  if (!activeEffect) return null;

  return (
    <div className={`table-fx-layer fx--${activeEffect.type}`}>
      {/* 炸弹轰炸特效 */}
      {activeEffect.type === 'bomb' && (
        <div className="fx-bomb-container">
          <div className="fx-screen-flash" />
          <div className="fx-bomb-shockwave" />
          <div className="fx-bomb-core">
            <span className="bomb-icon">💣</span>
            <div className="bomb-sparks" />
            <h2 className="bomb-text">BOMB! 炸弹</h2>
          </div>
        </div>
      )}

      {/* 王炸火箭升空特效 */}
      {activeEffect.type === 'rocket' && (
        <div className="fx-rocket-container">
          <div className="fx-rocket-body">
            <span className="rocket-icon">🚀</span>
            <div className="rocket-fire-tail" />
          </div>
          <div className="fx-rocket-explosion">
            <div className="explosion-ring" />
            <h2 className="rocket-text">ROCKET! 王炸登顶</h2>
          </div>
        </div>
      )}

      {/* 顺子/连对流光掠过 */}
      {activeEffect.type === 'shunzi' && (
        <div className="fx-shunzi-container">
          <div className="shunzi-beam" />
          <div className="shunzi-text-box">
            <span className="beam-star">✦</span>
            <h2>{activeEffect.text || '顺子 · 势如破竹'}</h2>
            <span className="beam-star">✦</span>
          </div>
        </div>
      )}

      {/* ALL-IN 全下视效 */}
      {activeEffect.type === 'allin' && (
        <div className="fx-allin-container">
          <div className="allin-flames" />
          <div className="allin-badge">
            <span className="allin-title">ALL IN</span>
            <span className="allin-sub">孤注一掷 · 决战巅峰</span>
          </div>
        </div>
      )}

      {/* 骰宝摇盅开盅特效 */}
      {activeEffect.type === 'dice' && (
        <div className="fx-dice-container">
          <div className="dice-cup-glow" />
          <div className="dice-reveal-title">开盅大吉</div>
        </div>
      )}

      {/* 暴击金币大奖 */}
      {activeEffect.type === 'jackpot' && (
        <div className="fx-jackpot-container">
          <div className="jackpot-burst-rays" />
          <h2 className="jackpot-title">JACKPOT 大获全胜</h2>
        </div>
      )}
    </div>
  );
}
