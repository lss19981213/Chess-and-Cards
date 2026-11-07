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
