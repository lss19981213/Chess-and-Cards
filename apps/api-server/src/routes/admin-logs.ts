/**
 * GM 后台日志运维与诊断下载路由模块。
 * 
 * 路由列表：
 * 1. GET  /api/admin/logs/files    - 列出服务器全部归档日志文件（大小/服务归属/最后更新时间）
 * 2. GET  /api/admin/logs/download - 下载指定日志文件到客户端（带安全校验，防止路径穿越）
 * 3. GET  /api/admin/logs/tail     - 在线查询最近 N 行日志（支持服务/级别/关键字实时过滤或历史文件调阅）
 * 4. POST /api/admin/logs/clean    - 清理指定天数前的过期旧日志文件
 */

import { createReadStream, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { httpError, requireAdmin } from '../http-utils';
import {
  getLogDir,
  getSafeLogFilePath,
  listLogFiles,
  queryLogTail,
  type Logger,
} from '../logger';

export function registerAdminLogRoutes(
  app: FastifyInstance,
  apiLog: Logger,
): void {
  // 1. 获取服务器上已归档的日志文件列表
  app.get('/api/admin/logs/files', async (req: FastifyRequest) => {
    requireAdmin(req);
    const files = listLogFiles();
    return {
      success: true,
      total: files.length,
      files,
    };
  });

  // 2. 下载指定的日志文件
  app.get(
    '/api/admin/logs/download',
    async (
      req: FastifyRequest<{ Querystring: { file?: string } }>,
      reply: FastifyReply,
    ) => {
      requireAdmin(req);

      const fileName = req.query.file;
      if (!fileName || typeof fileName !== 'string') {
        throw httpError('缺少 file 参数', 400);
      }

      const filePath = getSafeLogFilePath(fileName);
      if (!filePath || !existsSync(filePath)) {
        throw httpError(`未找到日志文件或无权访问: ${fileName}`, 404);
      }

      apiLog.info('GM 下载系统日志文件', { file: fileName, ip: req.ip });

      // 设置下载响应头，告知客户端作为附件保存
      reply.header('content-type', 'text/plain; charset=utf-8');
      reply.header(
        'content-disposition',
        `attachment; filename="${encodeURIComponent(fileName)}"`,
      );

      const stream = createReadStream(filePath);
      return reply.send(stream);
    },
  );

  // 3. 在线调阅/检索最新日志流或历史日志文件
  app.get(
    '/api/admin/logs/tail',
    async (
      req: FastifyRequest<{
        Querystring: {
          service?: string;
          level?: string;
          lines?: string;
          keyword?: string;
          file?: string;
        };
      }>,
    ) => {
      requireAdmin(req);

      const lines = req.query.lines ? parseInt(req.query.lines, 10) : 200;
      const result = queryLogTail({
        service: req.query.service || 'all',
        level: req.query.level || 'all',
        lines: isNaN(lines) ? 200 : lines,
        keyword: req.query.keyword || '',
        file: req.query.file || '',
      });

      return {
        success: true,
        ...result,
      };
    },
  );

  // 4. 清理旧日志（默认保留 7 天，释放磁盘空间）
  app.post(
    '/api/admin/logs/clean',
    async (
      req: FastifyRequest<{ Body?: { retainDays?: number } }>,
    ) => {
      requireAdmin(req);

      const retainDays = Math.max(1, req.body?.retainDays ?? 7);
      const cutoffMs = Date.now() - retainDays * 24 * 60 * 60 * 1000;
      const dir = getLogDir();

      const deleted: string[] = [];
      let freedBytes = 0;

      if (existsSync(dir)) {
        for (const file of readdirSync(dir)) {
          if (!file.endsWith('.log')) continue;
          try {
            const p = join(dir, file);
            const st = statSync(p);
            if (st.mtimeMs < cutoffMs) {
              freedBytes += st.size;
              unlinkSync(p);
              deleted.push(file);
            }
          } catch {
            // 忽略被占用的文件
          }
        }
      }

      apiLog.info('GM 清理历史日志', { retainDays, deletedCount: deleted.length, freedBytes });

      return {
        success: true,
        retainDays,
        deletedCount: deleted.length,
        deletedFiles: deleted,
        freedBytes,
      };
    },
  );
}
