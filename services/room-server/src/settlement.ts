import type { Settlement } from '@cc/protocol';
import type { RoomServerConfig } from './config';

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
          console.error(`[settle] 上报失败 ${res.status}: ${text}`, settlement.settlementId);
        } catch (error) {
          console.error(`[settle] 上报异常（第 ${attempt} 次）`, error);
        }
        await new Promise((r) => setTimeout(r, 300 * attempt));
      }
      console.error('[settle] 结算最终上报失败，需人工补偿', settlement.settlementId);
    })();
  };
}
