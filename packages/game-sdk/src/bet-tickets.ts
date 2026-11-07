/**
 * 真人下注的即时扣款凭证。
 *
 * 下注时容器已把本金从钱包扣走，这里记下每笔的退款凭证；
 * 撤注时按凭证逐笔退款，局末结算由容器统一返还本金。
 * 机器人不参与账本，不应写入。
 */
export interface BetTicket {
  /** ctx.charge 返回的幂等凭证 */
  ref: string;
  /** 下注区域，用于按区撤注 */
  area: string;
  amount: number;
}

export class TicketBook {
  private readonly rows = new Map<string, BetTicket[]>();

  add(playerId: string, ticket: BetTicket): void {
    const list = this.rows.get(playerId) ?? [];
    list.push(ticket);
    this.rows.set(playerId, list);
  }

  /** 只查看不移除，便于「退款全部成功后再改注单」 */
  peek(playerId: string, area?: string): BetTicket[] {
    const list = this.rows.get(playerId) ?? [];
    return area ? list.filter((t) => t.area === area) : [...list];
  }

  /** 取出待撤的凭证并从账本移除；不传 area 表示全部撤掉 */
  take(playerId: string, area?: string): BetTicket[] {
    const list = this.rows.get(playerId) ?? [];
    if (!area) {
      this.rows.delete(playerId);
      return [...list];
    }
    this.rows.set(playerId, list.filter((t) => t.area !== area));
    return list.filter((t) => t.area === area);
  }
}
