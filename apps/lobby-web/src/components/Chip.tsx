import { CHIP_IMG } from '../assets';
import { chipArt, toChipStack } from '../chips';

/** 筹码图标：默认使用 100 面额矢量筹码，可指定面额 */
export function Chip({ size = 16, value, className = '' }: { size?: number; value?: number; className?: string }) {
  const src = value ? chipArt(value) : CHIP_IMG;
  return (
    <img
      className={`chip-ico ${className}`}
      src={src}
      alt=""
      width={size}
      height={size}
      draggable={false}
    />
  );
}

/**
 * 桌面筹码堆：按金额拆解成真实面额筹码，错位叠放。
 * 使用生成的矢量筹码素材，避免纯色圆片带来的塑料感。
 */
export function ChipStack({ amount, limit = 6 }: { amount: number; limit?: number }) {
  if (amount <= 0) return null;
  const stack = toChipStack(amount, limit);
  return (
    <div className="chip-stack" aria-hidden>
      {stack.map((denom, index) => (
        <img
          key={`${denom}-${index}`}
          className="chip-stack__chip"
          src={chipArt(denom)}
          alt=""
          style={{ ['--i' as string]: index }}
          draggable={false}
        />
      ))}
    </div>
  );
}
