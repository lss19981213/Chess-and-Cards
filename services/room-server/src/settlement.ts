import type { Settlement } from '@cc/protocol';
import type { RoomServerConfig } from './config';
import { createLogger } from './logger';

const log = createLogger('settle');

/**
 * 结算上报大厅服务。
 * 大厅侧以 settlementId 做唯一键，重复上报不会重复记账。
 * 生产环境建议替换为 MQ + 本地 outbox，避免网络抖动丢结算。
 */
export function createSettlementReporter(config: RoomServerConfig): (settlement: Settlement) => void {
  return (settlement) => {
    void (async () => {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const res = await fetch(`${config.apiBaseUrl}/internal/settle`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-internal-key': config.internalKey,
            },
            body: JSON.stringify(settlement),
          });
          if (res.ok) return;
          const text = await res.text();
          log.error('结算上报被拒', { status: res.status, body: text.slice(0, 200), settlementId: settlement.settlementId });
        } catch (error) {
          log.warn('结算上报异常，准备重试', { attempt, error: (error as Error).message, settlementId: settlement.settlementId });
        }
        await new Promise((r) => setTimeout(r, 300 * attempt));
      }
      log.error('结算最终上报失败，需人工补偿', {
      settlementId: settlement.settlementId,
      roomId: settlement.roomId,
      gameId: settlement.gameId,
    });
    })();
  };
}
