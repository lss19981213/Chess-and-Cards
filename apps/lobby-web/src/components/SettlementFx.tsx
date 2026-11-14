import { useEffect, useRef } from 'react';

interface Props {
  delta: number;
  onDismiss: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  vRot: number;
  shape: 'coin' | 'confetti' | 'star';
  alpha: number;
}

export function SettlementFx({ delta, onDismiss }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isWin = delta > 0;
  const isLose = delta < 0;

  useEffect(() => {
    // 自动在 2.8 秒后淡出关闭
    const timer = window.setTimeout(onDismiss, 2800);
    return () => window.clearTimeout(timer);
  }, [onDismiss]);

  useEffect(() => {
    if (!isWin) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    const width = (canvas.width = window.innerWidth);
    const height = (canvas.height = window.innerHeight);

    const colors = ['#FFE28A', '#F5C542', '#D8A228', '#FFFFFF', '#38D39F', '#FF8F3D'];
    const particles: Particle[] = [];

    // 初始化 80 颗金币与彩屑粒子
    for (let i = 0; i < 90; i++) {
      const angle = (Math.random() * Math.PI) + Math.PI; // 向上辐射喷发
      const speed = 6 + Math.random() * 14;
      particles.push({
        x: width / 2 + (Math.random() - 0.5) * 200,
        y: height * 0.45 + (Math.random() - 0.5) * 80,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 6 + Math.random() * 12,
        color: colors[Math.floor(Math.random() * colors.length)]!,
        rotation: Math.random() * 360,
        vRot: (Math.random() - 0.5) * 12,
        shape: Math.random() > 0.4 ? 'coin' : Math.random() > 0.5 ? 'star' : 'confetti',
        alpha: 1,
      });
    }

    const start = performance.now();
    const render = (now: number) => {
      const elapsed = (now - start) / 1000;
      ctx.clearRect(0, 0, width, height);

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.38; // 重力加速度
        p.rotation += p.vRot;
        if (elapsed > 1.8) {
          p.alpha = Math.max(0, p.alpha - 0.025);
        }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);

        if (p.shape === 'coin') {
          // 金币粒子
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#8B6A14';
          ctx.stroke();
          // 内圈方形方孔
          ctx.fillStyle = '#8B6A14';
          ctx.fillRect(-p.size / 6, -p.size / 6, p.size / 3, p.size / 3);
        } else if (p.shape === 'star') {
          // 闪光十字星
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -1.5, p.size, 3);
          ctx.fillRect(-1.5, -p.size / 2, 3, p.size);
        } else {
          // 矩形丝带彩屑
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        }
        ctx.restore();
      });

      if (elapsed < 2.8) {
        animId = requestAnimationFrame(render);
      }
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [isWin]);

  if (!isWin && !isLose) return null;

  return (
    <div
      className={`settlement-fx-overlay ${isWin ? 'is-win' : 'is-lose'}`}
      onClick={onDismiss}
      role="presentation"
    >
      {isWin && <canvas ref={canvasRef} className="settlement-fx-canvas" />}

      <div className="settlement-fx-banner">
        {/* 光芒背景 */}
        <div className="settlement-fx-sunburst" />

        <div className="settlement-fx-card">
          <div className="settlement-fx-icon-wrap">
            <span className="settlement-fx-icon">{isWin ? '👑' : '🛡️'}</span>
          </div>

          <div className="settlement-fx-title">
            {isWin ? 'VICTORY' : 'DEFEAT'}
          </div>
          <div className="settlement-fx-sub">
            {isWin ? '旗开得胜 · 财源广进' : '局结惜败 · 重整旗鼓'}
          </div>

          <div className={`settlement-fx-delta ${isWin ? 'is-pos' : 'is-neg'}`}>
            {isWin ? `+${delta.toLocaleString()}` : delta.toLocaleString()}
            <span className="settlement-fx-unit"> 筹码</span>
          </div>

          <div className="settlement-fx-tap-hint">点击任意区域轻触关闭</div>
        </div>
      </div>
    </div>
  );
}
