import type { RoomServerConfig } from './config';

export interface WalletAdjustInput {
  playerId: string;
  amount: number;
  action: 'debit' | 'refund';
  /** 幂等凭证 `${roomId}:${round}:${playerId}:${seq}` */
  bizId: string;
}

export type WalletClient = (input: WalletAdjustInput) => Promise<number>;

/**
 * 下注即时扣款客户端。
 * 余额校验与记账由大厅服务原子完成，这里只做转发并把最新余额回传给容器。
 */
export function createWalletClient(config: RoomServerConfig): WalletClient {
  return async (input) => {
    const res = await fetch(`${config.apiBaseUrl}/internal/wallet`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-key': config.internalKey,
      },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let message = `筹码操作失败 (${res.status})`;
      try {
        message = (JSON.parse(text) as { error?: string }).error ?? message;
      } catch {
        /* 非 JSON 响应时保留默认文案 */
      }
      throw new Error(message);
    }
    const data = (await res.json()) as { balance?: number };
    if (!Number.isFinite(data.balance)) throw new Error('筹码操作响应缺少余额');
    return data.balance as number;
  };
}
