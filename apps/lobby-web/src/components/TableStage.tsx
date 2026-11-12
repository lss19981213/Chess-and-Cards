import type { ReactNode } from 'react';

/**
 * 顶级横屏移动端牌桌舞台：
 * 采用 16:9 ~ 21:9 横屏人机工程学比例，真实还原贵宾厅环桌视角。
 */

interface Slot {
  x: number;
  y: number;
}

/** 适应横屏更宽视野的对手座位方位预设（百分比） */
const SLOTS: Record<number, Slot[]> = {
  1: [{ x: 50, y: 8 }],
  2: [
    { x: 18, y: 16 },
    { x: 82, y: 16 },
  ],
  3: [
    { x: 10, y: 38 },
    { x: 50, y: 7 },
    { x: 90, y: 38 },
  ],
  4: [
    { x: 12, y: 32 },
    { x: 38, y: 7 },
    { x: 62, y: 7 },
    { x: 88, y: 32 },
  ],
  5: [
    { x: 8, y: 44 },
    { x: 26, y: 10 },
    { x: 74, y: 10 },
    { x: 92, y: 44 },
    { x: 50, y: 6 },
  ],
};

export interface StageSeat {
  key: string;
  node: ReactNode;
  active?: boolean;
  dim?: boolean;
}

interface Props {
  seats: StageSeat[];
  center?: ReactNode;
  bottom?: ReactNode;
  watermark?: string;
  className?: string;
}

export function TableStage({ seats, center, bottom, watermark, className = '' }: Props) {
  const count = Math.min(Math.max(seats.length, 1), 5);
  const slots = SLOTS[count] ?? SLOTS[count] ?? SLOTS[3]!;

  return (
    <div className={`stage stage--landscape ${className}`}>
      {/* 真实木纹与跑道金边外沿 */}
      <div className="stage__rail">
        {/* 深海天鹅绒翡翠呢面 */}
        <div className="stage__felt">
          {/* 金色内嵌跑道纹线 */}
          <div className="stage__felt-ring" />
          <div className="stage__spotlight" />
          {watermark && <span className="stage__watermark">{watermark}</span>}
          <div className="stage__center">{center}</div>
        </div>
      </div>

      {/* 环桌对手座位 */}
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

      {/* 玩家手牌与右下拇指操作区 */}
      {bottom && <div className="stage__bottom">{bottom}</div>}
    </div>
  );
}

/** 奢华对手座位卡：带金属流光环、状态徽章、倒计时呼吸圈 */
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
    <div className={`seat seat--luxury ${active ? 'is-turn' : ''}`}>
      <div className="seat__avatar-box">
        {active && <div className="seat__turn-glow" />}
        <div className={`seat__avatar ${isBot ? 'is-bot' : ''}`}>
          <span>{initial}</span>
          {isBot && <span className="seat__bot-tag">人机</span>}
        </div>
      </div>
      <div className="seat__body">
        <div className="seat__name">
          <span className="seat__nickname">{nickname}</span>
          {badge}
        </div>
        <div className="seat__meta">{meta}</div>
      </div>
      {cards && <div className="seat__cards">{cards}</div>}
    </div>
  );
}
