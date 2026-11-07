import { CHIP_IMG } from '../assets';

/** 筹码图标：圆形裁剪的筹码堆特写 */
export function Chip({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      className={`chip-ico ${className}`}
      src={CHIP_IMG}
      alt=""
      width={size}
      height={size}
      draggable={false}
    />
  );
}

/** 桌面筹码柱：按底池大小堆叠，纯 CSS 绘制 */
export function ChipStack({ amount }: { amount: number }) {
  if (amount <= 0) return null;
  const count = Math.max(2, Math.min(6, Math.ceil(Math.log2(amount / 40))));
  return (
    <div className="chip-stack" aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={index % 3 === 2 ? 'is-red' : ''} />
      ))}
    </div>
  );
}
