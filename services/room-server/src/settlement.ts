import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Settlement } from '@cc/protocol';
import type { RoomServerConfig } from './config';
import { createLogger } from './logger';

const log = createLogger('settle');

const MAX_ATTEMPTS = 5;

export interface SettlementReporter {
  /** 落盘后异步投递；返回时不保证已送达 */
  report(settlement: Settlement): void;
  /** 投递 outbox 里所有待处理结算（启动补投 / 关闭前收尾） */
  flush(): Promise<void>;
}

function safeFileName(settlementId: string): string {
  return settlementId.replace(/[^A-Za-z0-9._-]/g, '_');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 结算上报器：本地 outbox + 幂等重投。
 *
 * 结算一旦产生就先落盘，再尝试上报；只有大厅确认入库才删除文件。
 * 这样进程重启、网络抖动、大厅短暂不可用都不会丢结算，也不会出现
 * 「本金已扣、界面显示赢分、账本却没入账」的悬空状态。
 * 大厅侧以 settlementId 做唯一键，重复投递不会重复记账。
 */
export function createSettlementReporter(config: RoomServerConfig): SettlementReporter {
  const dir = config.outboxDir;
  const inflight = new Set<string>();
  let flushChain: Promise<void> = Promise.resolve();

  const fileOf = (settlementId: string): string => join(dir, `${safeFileName(settlementId)}.json`);

  /**
   * 同步落盘。结算产生时先同步写盘再返回，才能保证「结算已发生」与
   * 「结算已持久化」之间没有可被崩溃打断的窗口。
   */
  function persistSync(settlement: Settlement): void {
    mkdirSync(dir, { recursive: true });
    const final = fileOf(settlement.settlementId);
    const tmp = `${final}.tmp`;
    writeFileSync(tmp, JSON.stringify(settlement), 'utf8');
    renameSync(tmp, final);
  }

  async function remove(settlementId: string): Promise<void> {
    await unlink(fileOf(settlementId)).catch(() => undefined);
  }

  async function deliver(settlement: Settlement): Promise<boolean> {
    if (inflight.has(settlement.settlementId)) return false;
    inflight.add(settlement.settlementId);
    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          const res = await fetch(`${config.apiBaseUrl}/internal/settle`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-internal-key': config.internalKey,
            },
            body: JSON.stringify(settlement),
            signal: AbortSignal.timeout(8_000),
          });
          if (res.ok) {
            await remove(settlement.settlementId);
            return true;
          }
          const text = await res.text().catch(() => '');
          log.error('结算上报被拒', {
            status: res.status,
            body: text.slice(0, 200),
            settlementId: settlement.settlementId,
          });
          // 4xx（除 429）说明数据本身有问题，重试无意义，保留文件待人工处理
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            log.error('结算被判定为不可重试，已保留 outbox 文件', {
              settlementId: settlement.settlementId,
            });
            return false;
          }
        } catch (error) {
          log.warn('结算上报异常，准备重试', {
            attempt,
            error: (error as Error).message,
            settlementId: settlement.settlementId,
          });
        }
        await sleep(300 * attempt);
      }
      log.error('结算本轮投递失败，保留在 outbox 等待下一轮', {
        settlementId: settlement.settlementId,
      });
      return false;
    } finally {
      inflight.delete(settlement.settlementId);
    }
  }

  async function flushOnce(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return; // 目录还不存在，说明从未产生结算
    }
    const files = names.filter((name) => name.endsWith('.json'));
    for (const name of files) {
      const path = join(dir, name);
      try {
        const raw = await readFile(path, 'utf8');
        const settlement = JSON.parse(raw) as Settlement;
        if (!settlement?.settlementId) {
          await unlink(path).catch(() => undefined);
          continue;
        }
        await deliver(settlement);
      } catch (error) {
        log.error('读取 outbox 文件失败', { file: name, error: (error as Error).message });
      }
    }
  }

  return {
    report(settlement: Settlement): void {
      // 纯氛围局（没有任何真人流水）不值得落盘，丢了只影响走势展示
      const durable = settlement.entries.length > 0;
      try {
        if (durable) persistSync(settlement);
      } catch (error) {
        // 落盘失败也要尽力投递，至少这一轮有机会送达
        log.error('结算落盘失败，直接尝试上报', {
          settlementId: settlement.settlementId,
          error: (error as Error).message,
        });
      }
      flushChain = flushChain
        .then(async () => {
          await deliver(settlement);
        })
        // 单条失败不能把后续队列一起卡死
        .catch((error: unknown) => {
          log.error('结算队列异常', { error: (error as Error).message });
        });
    },

    flush(): Promise<void> {
      flushChain = flushChain
        .then(() => flushOnce())
        .catch((error: unknown) => {
          log.error('outbox 投递异常', { error: (error as Error).message });
        });
      return flushChain;
    },
  };
}
