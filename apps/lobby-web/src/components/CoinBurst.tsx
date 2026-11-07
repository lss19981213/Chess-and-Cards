import { useMemo } from 'react';

/** 结算时桌心爆散的金币粒子，纯 CSS 动画 */
export function CoinBurst() {
  const items = useMemo(
    () =>
      Array.from({ length: 16 }, (_, index) => ({
        id: index,
        angle: (index / 16) * 360 + (index % 3) * 8,
        distance: 110 + ((index * 37) % 90),
        delay: (index % 5) * 45,
        size: 9 + ((index * 13) % 7),
      })),
    [],
  );

  return (
    <div className="coin-burst" aria-hidden>
      {items.map((item) => (
        <span
          key={item.id}
          style={
            {
              '--a': `${item.angle}deg`,
              '--d': `${item.distance}px`,
              '--delay': `${item.delay}ms`,
              '--size': `${item.size}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
