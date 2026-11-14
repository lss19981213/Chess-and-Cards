import React from 'react';

interface Props {
  tile: string;
  size?: 'sm' | 'md' | 'lg';
  isBack?: boolean;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}

export function mahjongTileArt(tile: string): string {
  if (tile === 'back') return `${import.meta.env.BASE_URL}assets/mahjong/back.svg`;
  return `${import.meta.env.BASE_URL}assets/mahjong/${tile}.svg`;
}

export function MahjongTile({
  tile,
  size = 'md',
  isBack = false,
  active = false,
  onClick,
  className = '',
}: Props) {
  const art = isBack ? mahjongTileArt('back') : mahjongTileArt(tile);

  return (
    <div
      className={`mahjong-tile mahjong-tile--${size} ${active ? 'is-active' : ''} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="mahjong-tile__body">
        <img src={art} alt={tile} draggable={false} />
      </div>
    </div>
  );
}
