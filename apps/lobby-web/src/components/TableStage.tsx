import type { ReactNode } from 'react';

/**
 * 牌桌舞台：以「自己坐在桌边」的视角还原真实牌桌。
 * 对手环绕椭圆桌分布，桌心是底池/出牌区，手牌立在桌沿。
 */

interface Slot {
  x: number;
  y: number;
}

/** 按对手数量预设座位方位（百分比，桌子坐标系） */
const SLOTS: Record<number, Slot[]> = {
  1: [{ x: 50, y: 6 }],
  2: [
    { x: 17, y: 14 },
    { x: 83, y: 14 },
  ],
  3: [
    { x: 8, y: 40 },
    { x: 50, y: 5 },
    { x: 92, y: 40 },
  ],
  4: [
    { x: 50, y: 5 },
    { x: 8, y: 32 },
    { x: 92, y: 32 },
    { x: 50, y: 66 },
  ],
  5: [
    { x: 50, y: 4 },
    { x: 8, y: 22 },
    { x: 92, y: 22 },
    { x: 12, y: 62 },
    { x: 88, y: 62 },
  ],
};

export interface StageSeat {
  key: string;
  node: ReactNode;
  active?: boolean;
  /** 已出完牌/已弃牌，弱化显示 */
  dim?: boolean;
}

interface Props {
  seats: StageSeat[];
  /** 桌心内容：底池、上一手牌 */
  center?: ReactNode;
  /** 桌沿底部：手牌与操作 */
  bottom?: ReactNode;
  /** 桌面中央水印文字 */
  watermark?: string;
  className?: string;
}

export function TableStage({ seats, center, bottom, watermark, className = '' }: Props) {
  const count = Math.min(Math.max(seats.length, 1), 5);
  const slots = SLOTS[count] ?? SLOTS[5]!;

  return (
    <div className={`stage ${className}`}>
      <div className="stage__felt">
        <div className="stage__felt-ring" />
        {watermark && <span className="stage__watermark">{watermark}</span>}
        <div className="stage__center">{center}</div>
      </div>

      {seats.map((seat, index) => {
        const slot = slots[index] ?? slots[slots.length - 1]!;
        return (
          <div
            key={seat.key}
            className={`stage__seat ${seat.active ? 'is-active' : ''} ${seat.dim ? 'is-dim' : ''}`}
            style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
          >
            {seat.node}
          </div>
        );
      })}

      {bottom && <div className="stage__bottom">{bottom}</div>}
    </div>
  );
}

/** 对手座位卡：头像、昵称、状态、剩余牌 */
export function SeatPanel({
  nickname,
  initial,
  badge,
  meta,
  active,
  cards,
  isBot,
}: {
  nickname: string;
  initial: string;
  badge?: ReactNode;
  meta: ReactNode;
  active?: boolean;
  cards?: ReactNode;
  isBot?: boolean;
}) {
  return (
    <div className={`seat ${active ? 'is-turn' : ''}`}>
      <div className={`seat__avatar ${isBot ? 'is-bot' : ''}`}>{initial}</div>
      <div className="seat__body">
        <div className="seat__name">
          <span>{nickname}</span>
          {badge}
        </div>
        <div className="seat__meta">{meta}</div>
      </div>
      {cards && <div className="seat__cards">{cards}</div>}
    </div>
  );
}
