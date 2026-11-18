import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AVATAR_FRAMES } from '@cc/protocol';
import { resolveAvatarUrl } from '../api';

interface Props {
  nickname: string;
  avatar?: string | null;
  frameId?: string;
  size?: number;
  className?: string;
  showCrown?: boolean;
}

export function AvatarWithFrame({
  nickname,
  avatar,
  frameId = 'frame_default',
  size = 40,
  className = '',
  showCrown = false,
}: Props) {
  const avatarUrl = useMemo(() => resolveAvatarUrl(avatar), [avatar]);
  const [imgBroken, setImgBroken] = useState(false);

  useEffect(() => {
    setImgBroken(false);
  }, [avatarUrl]);

  const meta = useMemo(
    () => AVATAR_FRAMES.find((f) => f.id === frameId) ?? AVATAR_FRAMES[0]!,
    [frameId],
  );

  // 严格使用协议中带连字符的标准 cssClass（彻底修复此前下划线不匹配导致 26 款高价框无特效的 BUG）
  const frameClass =
    meta?.id === frameId
      ? meta.cssClass
      : frameId
        ? `frame-${frameId.replace(/^frame_/, '').replace(/_/g, '-')}`
        : 'frame-default';

  const rarity = meta?.rarity ?? 'common';
  const price = meta?.price ?? 0;
  const isEpicPlus = rarity === 'epic' || rarity === 'legendary' || rarity === 'mythic';
  const isLegendaryPlus = rarity === 'legendary' || rarity === 'mythic';
  const isMythic = rarity === 'mythic';
  const isSupremeMythic = isMythic && price >= 288888;
  const displayCrest =
    showCrown || isMythic || (rarity === 'legendary' && price >= 50000);
  const crestIcon = showCrown ? '👑' : isMythic ? meta.badge || '👑' : meta.badge || '✦';

  const initial = nickname.replace(/^🤖\s*/, '').slice(0, 1) || '友';
  const styleVars = {
    width: size,
    height: size,
    '--af-size': `${size}px`,
  } as CSSProperties;

  return (
    <div
      className={`avatar-with-frame-container ${frameClass} rarity-${rarity}${isSupremeMythic ? ' is-supreme-mythic' : ''} ${className}`.trim()}
      style={styleVars}
      title={meta && meta.id !== 'frame_default' ? `${meta.badge} ${meta.name}` : undefined}
    >
      {/* 外层环境光晕（史诗/传说/神话） */}
      {isEpicPlus && <div className="avatar-frame-aura" aria-hidden="true" />}

      {/* 超神级脉冲扩张神纹波（28万+ 至尊神话专属） */}
      {isSupremeMythic && <div className="avatar-frame-divine-wave" aria-hidden="true" />}

      {/* 流光旋转能量环（史诗/传说/神话） */}
      {isEpicPlus && <div className="avatar-frame-conic" aria-hidden="true" />}

      {/* 外环星轨 + 环绕能量粒子（传说 2 颗星芒，神话 4 颗星芒 + 逆向法阵环） */}
      {isLegendaryPlus && (
        <div className="avatar-frame-orbit" aria-hidden="true">
          <span className="avatar-frame-orb avatar-frame-orb--1" />
          <span className="avatar-frame-orb avatar-frame-orb--2" />
          {isMythic && <span className="avatar-frame-orb avatar-frame-orb--3" />}
          {isMythic && <span className="avatar-frame-orb avatar-frame-orb--4" />}
        </div>
      )}

      {/* 神话专属逆向星环 + 闪烁四角神芒 */}
      {isMythic && (
        <div className="avatar-frame-orbit-reverse" aria-hidden="true">
          <span className="avatar-frame-spark avatar-frame-spark--1">✦</span>
          <span className="avatar-frame-spark avatar-frame-spark--2">✦</span>
        </div>
      )}

      {/* 顶部浮空王冠 / 主题神徽 */}
      {displayCrest && size >= 34 && (
        <span
          className={`frame-crown-top${isMythic ? ' is-mythic-crest' : ''}`}
          style={{
            fontSize: `${Math.max(11, Math.min(24, Math.round(size * 0.27)))}px`,
            top: `${-Math.max(7, Math.round(size * 0.17))}px`,
          }}
          aria-hidden="true"
        >
          {crestIcon}
        </span>
      )}

      {/* 主边框 + 金属扫光 */}
      <div className="avatar-frame-border" aria-hidden="true" />

      {/* 头像内核 */}
      <div className="avatar-frame-inner">
        {avatarUrl && !imgBroken ? (
          <img
            src={avatarUrl}
            alt={nickname}
            className="avatar-frame-img"
            onError={() => setImgBroken(true)}
          />
        ) : (
          <span className="avatar-frame-initial" style={{ fontSize: Math.max(12, Math.round(size * 0.36)) }}>
            {initial}
          </span>
        )}
      </div>
    </div>
  );
}
