import { useEffect, useMemo } from 'react';
import { audio } from '../audio';

interface Props {
  delta: number;
}

/** 胜利璀璨特效：漫天金币雨 + 璀璨星芒 + 胜利光环 (纯 CSS/DOM 高性能动画) */
export function WinCelebration({ delta }: Props) {
  // 播放胜利与金币落袋音效
  useEffect(() => {
    audio.play('win');
    const timer = window.setTimeout(() => {
      audio.play('coin');
    }, 280);
    return () => window.clearTimeout(timer);
  }, []);

  // 生成金币雨与璀璨粒子数据
  const particles = useMemo(() => {
    const symbols = ['🪙', '✨', '⭐', '🎉', '💎', '🪙', '✨', '🪙'];
    return Array.from({ length: 36 }, (_, i) => ({
      id: i,
      symbol: symbols[i % symbols.length]!,
      left: 5 + (i * 2.6) + ((i * 17) % 7), // 5% - 95% 水平分布
      delay: (i * 70) % 900, // 0 - 900ms 随机错落
      duration: 1800 + ((i * 130) % 800), // 1.8s - 2.6s
      scale: 0.8 + ((i * 13) % 8) / 10,
      sway: ((i % 2 === 0 ? 1 : -1) * (20 + (i * 7) % 30)),
    }));
  }, []);

  return (
    <div className="win-celebration-stage" aria-hidden="true">
      {/* 顶部胜利高光光环 */}
      <div className="win-halo-sweep" />

      {/* 浮动飞升收益大字 */}
      {delta > 0 && (
        <div className="win-flying-banner">
          <span className="win-banner-icon">👑</span>
          <span className="win-banner-text">VICTORY +{delta.toLocaleString()}</span>
        </div>
      )}

      {/* 漫天飘洒金币与星辉粒子 */}
      {particles.map((p) => (
        <span
          key={p.id}
          className="win-particle"
          style={
            {
              left: `${p.left}%`,
              animationDelay: `${p.delay}ms`,
              animationDuration: `${p.duration}ms`,
              '--scale': p.scale,
              '--sway': `${p.sway}px`,
            } as React.CSSProperties
          }
        >
          {p.symbol}
        </span>
      ))}
    </div>
  );
}
