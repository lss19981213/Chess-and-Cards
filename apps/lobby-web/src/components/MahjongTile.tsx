import React from 'react';

interface Props {
  tile: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  isBack?: boolean;
  active?: boolean;
  isNew?: boolean;
  isLastDiscard?: boolean;
  recommended?: boolean;
  isDingque?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  className?: string;
}

const TILE_ASSET_ALIAS: Record<string, string> = {
  wind1: 'east',
  wind2: 'south',
  wind3: 'west',
  wind4: 'north',
  dragon1: 'zhong',
  dragon2: 'fa',
  dragon3: 'bai',
};

export function mahjongTileArt(tile: string): string {
  if (tile === 'back') return `${import.meta.env.BASE_URL}assets/mahjong/back.svg`;
  const mapped = TILE_ASSET_ALIAS[tile] ?? tile;
  return `${import.meta.env.BASE_URL}assets/mahjong/${mapped}.svg`;
}

export function MahjongTile({
  tile,
  size = 'md',
  isBack = false,
  active = false,
  isNew = false,
  isLastDiscard = false,
  recommended = false,
  isDingque = false,
  onClick,
  onDoubleClick,
  className = '',
}: Props) {
  const art = isBack ? mahjongTileArt('back') : mahjongTileArt(tile);

  return (
    <div
      className={`mahjong-tile mahjong-tile--${size}${active ? ' is-active' : ''}${isNew ? ' is-new-draw' : ''}${
        isLastDiscard ? ' is-last-discard' : ''
      }${recommended ? ' is-recommended' : ''}${isDingque ? ' is-dingque' : ''} ${className}`.trim()}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {recommended && (
        <span className="mahjong-tile__rec-badge" title="智能军师推荐优先打出">
          荐
        </span>
      )}
      {isDingque && !recommended && (
        <span className="mahjong-tile__dq-badge" title="定缺花色，须优先打出">
          缺
        </span>
      )}
      <div className="mahjong-tile__body">
        <img src={art} alt={tile} draggable={false} />
      </div>
    </div>
  );
}
