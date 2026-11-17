import { useMemo } from 'react';
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
  const initial = nickname.slice(0, 1) || '友';
  const frameClass = frameId ? `frame-${frameId.replace(/^frame_/, '')}` : 'frame-default';

  return (
    <div
      className={`avatar-with-frame-container ${frameClass} ${className}`}
      style={{ width: size, height: size }}
    >
      {showCrown && <span className="frame-crown-top">👑</span>}
      <div className="avatar-frame-border" />
      <div className="avatar-frame-inner">
        {avatarUrl ? (
          <img src={avatarUrl} alt={nickname} className="avatar-frame-img" />
        ) : (
          <span className="avatar-frame-initial">{initial}</span>
        )}
      </div>
    </div>
  );
}
