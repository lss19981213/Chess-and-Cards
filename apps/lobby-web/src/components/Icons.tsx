/**
 * 殿堂级精细矢量图标库 (Grand Luxury Vector Iconography)
 * 纯手绘矢量 SVG，支持金属流光与香槟金渐变，杜绝 emoji 粗糙感
 */

export function IconCrown({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`ico-svg ${className}`}>
      <defs>
        <linearGradient id="goldCrown" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fff4ce" />
          <stop offset="50%" stopColor="#f3cf7a" />
          <stop offset="100%" stopColor="#b38222" />
        </linearGradient>
      </defs>
      <path
        d="M2 19h20v2H2v-2zm1.5-3.5L2 6l5.5 4L12 4l4.5 6L22 6l-1.5 9.5H3.5z"
        fill="url(#goldCrown)"
        stroke="#ffd57a"
        strokeWidth="0.8"
      />
      <circle cx="2" cy="6" r="1.5" fill="#fff" />
      <circle cx="12" cy="4" r="1.5" fill="#fff" />
      <circle cx="22" cy="6" r="1.5" fill="#fff" />
    </svg>
  );
}

export function IconTrophy({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`ico-svg ${className}`}>
      <defs>
        <linearGradient id="goldTrophy" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fff9e0" />
          <stop offset="50%" stopColor="#f7d483" />
          <stop offset="100%" stopColor="#b5821c" />
        </linearGradient>
      </defs>
      <path
        d="M6 3h12v3c0 3.31-2.69 6-6 6s-6-2.69-6-6V3zm0 2H4c-1.1 0-2 .9-2 2 0 2.21 1.79 4 4 4h.24A7.95 7.95 0 016 7V5zm12 0h2c1.1 0 2 .9 2 2 0 2.21-1.79 4-4 4h-.24c.15-1.24.24-2.58.24-4V5zm-7 9.93A8.006 8.006 0 0110 18v2H7v2h10v-2h-3v-2c0-1.07-.36-2.06-.97-2.87L11 14.93z"
        fill="url(#goldTrophy)"
        stroke="#ffdf8a"
        strokeWidth="0.5"
      />
    </svg>
  );
}

export function IconGift({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`ico-svg ${className}`}>
      <defs>
        <linearGradient id="giftRed" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff5e62" />
          <stop offset="100%" stopColor="#c81d25" />
        </linearGradient>
        <linearGradient id="giftRibbon" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fff6d1" />
          <stop offset="100%" stopColor="#e5b842" />
        </linearGradient>
      </defs>
      <rect x="3" y="10" width="18" height="11" rx="2" fill="url(#giftRed)" />
      <rect x="2" y="6" width="20" height="4" rx="1.5" fill="url(#giftRed)" />
      <path d="M11 6h2v15h-2z" fill="url(#giftRibbon)" />
      <path
        d="M12 6c-1.5-2.5-4-3-5-2-1.2 1.2-.5 3.5 5 2zm0 0c1.5-2.5 4-3 5-2 1.2 1.2.5 3.5-5 2z"
        fill="url(#giftRibbon)"
      />
    </svg>
  );
}

export function IconUser({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`ico-svg ${className}`}>
      <circle cx="12" cy="7" r="4.5" stroke="#f7d483" strokeWidth="1.8" fill="rgba(247,212,131,0.2)" />
      <path
        d="M4 19.5c0-3.6 3.6-6.5 8-6.5s8 2.9 8 6.5"
        stroke="#f7d483"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconBack({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`ico-svg ${className}`}>
      <path
        d="M15 19l-7-7 7-7"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconNotice({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`ico-svg ${className}`}>
      <path
        d="M18 8a3 3 0 000 6v3h2V5h-2v3zM4 9v6h4l5 5V4L8 9H4z"
        fill="#f7d483"
        stroke="#ffd57a"
        strokeWidth="0.8"
      />
      <path d="M19 11a2 2 0 010 2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconFlame({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`ico-svg ${className}`}>
      <path
        d="M12 2C8.5 7 6 9.5 6 14a6 6 0 0012 0c0-3.5-1.5-6.5-6-12zm0 16a3 3 0 01-3-3c0-2 1.5-3.5 3-5 1.5 1.5 3 3 3 5a3 3 0 01-3 3z"
        fill="url(#flameGrad)"
      />
      <defs>
        <linearGradient id="flameGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff9a3c" />
          <stop offset="100%" stopColor="#e52d27" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function IconSpade({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`ico-svg ${className}`}>
      <path
        d="M12 2C9 7 5 9.5 5 13.5a5 5 0 007 4.58A5 5 0 0019 13.5C19 9.5 15 7 12 2zm-1 16.5l-2 3.5h6l-2-3.5h-2z"
        fill="#93b4ff"
      />
    </svg>
  );
}

export function IconChess({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`ico-svg ${className}`}>
      <path
        d="M5 20h14v2H5v-2zm3-2h8l-1.5-7h-5L8 18zm4-14a3 3 0 00-3 3c0 1.25.75 2.3 1.8 2.76L11 10h2l.2-1.24A3.003 3.003 0 0012 4z"
        fill="#55e6a5"
      />
    </svg>
  );
}

export function IconDice({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`ico-svg ${className}`}>
      <rect x="3" y="3" width="18" height="18" rx="4" stroke="#ffb259" strokeWidth="1.8" fill="rgba(255,178,89,0.15)" />
      <circle cx="8" cy="8" r="1.5" fill="#ffb259" />
      <circle cx="16" cy="8" r="1.5" fill="#ffb259" />
      <circle cx="12" cy="12" r="1.8" fill="#e52d27" />
      <circle cx="8" cy="16" r="1.5" fill="#ffb259" />
      <circle cx="16" cy="16" r="1.5" fill="#ffb259" />
    </svg>
  );
}

export function IconMusic({ on = true, size = 18 }: { on?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="ico-svg">
      <path
        d="M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z"
        stroke={on ? '#f7d483' : '#737f96'}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {!on && <line x1="3" y1="3" x2="21" y2="21" stroke="#e5484d" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

export function IconSound({ on = true, size = 18 }: { on?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="ico-svg">
      <path
        d="M11 5L6 9H2v6h4l5 4V5z"
        fill={on ? '#f7d483' : '#737f96'}
        stroke={on ? '#ffd57a' : '#737f96'}
        strokeWidth="0.8"
      />
      {on ? (
        <path
          d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14"
          stroke="#f7d483"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      ) : (
        <line x1="3" y1="3" x2="21" y2="21" stroke="#e5484d" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

export function IconNext({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="ico-svg">
      <path d="M5 4l10 8-10 8V4zm12 0h2v16h-2V4z" fill="#f7d483" />
    </svg>
  );
}

export function IconSparkle({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`ico-svg ${className}`}>
      <path
        d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2z"
        fill="#f7d483"
      />
    </svg>
  );
}

export function IconRefresh({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="ico-svg">
      <path
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        stroke="#f7d483"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconRules({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="ico-svg">
      <path
        d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-2h2v2zm1.07-7.75l-.9.92C12.45 10.9 12 11.5 12 13h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H7c0-2.76 2.24-5 5-5s5 2.24 5 5c0 .88-.36 1.68-.93 2.25z"
        fill="#f7d483"
      />
    </svg>
  );
}

export function IconMail({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={`ico-svg ${className}`}>
      <path
        d="M3 5h18a1 1 0 011 1v12a1 1 0 01-1 1H3a1 1 0 01-1-1V6a1 1 0 011-1z"
        stroke="#f7d483"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 6.5l9 6.5 9-6.5"
        stroke="#f7d483"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
