import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { GamePlugin } from '@cc/game-sdk';
import { BOT_HOSTED_POKER_GAMES, PLATFORM_ROOMS_INITIAL, type RoomManager } from './registry';
import { createLogger } from './logger';

type PluginConstructor = new () => GamePlugin;

interface DiscoveryEntry {
  /** import() 用的 specifier（包名或 file URL） */
  specifier: string;
  pkgName: string;
}

interface LoadedPackage {
  pkgName: string;
  /** 不含 cache-bust 的稳定 specifier */
  baseSpecifier: string;
  gameIds: string[];
}

const log = createLogger('plugins');

/** 已加载插件包索引：按包名 / gameId 可查，供热更使用 */
const packagesByName = new Map<string, LoadedPackage>();
const packageByGameId = new Map<string, LoadedPackage>();

function isPluginConstructor(value: unknown): value is PluginConstructor {
  return (
    typeof value === 'function' &&
    typeof value.prototype === 'object' &&
    value.prototype !== null &&
    typeof (value.prototype as { getSnapshot?: unknown }).getSnapshot === 'function'
  );
}

function resolvePluginConstructors(mod: Record<string, unknown>, pkgName: string): PluginConstructor[] {
  const found = new Set<PluginConstructor>();
  if (isPluginConstructor(mod.default)) found.add(mod.default);

  for (const [key, value] of Object.entries(mod)) {
    if (key.endsWith('Plugin') && isPluginConstructor(value)) found.add(value);
  }
  if (found.size === 0) {
    for (const value of Object.values(mod)) {
      if (isPluginConstructor(value)) found.add(value);
    }
  }
  if (found.size === 0) {
    throw new Error(`插件包 ${pkgName} 未导出合法的 GamePlugin 类`);
  }
  return [...found];
}

function discoverPluginPackages(): DiscoveryEntry[] {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    dependencies?: Record<string, string>;
  };

  const entries = new Map<string, DiscoveryEntry>();
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    if (dep.startsWith('@cc/game-') && dep !== '@cc/game-sdk') {
      entries.set(dep, { specifier: dep, pkgName: dep });
    }
  }

  // 兜底发现同仓 `services/games/*` 下未写入 package.json 的扩展插件
  const gamesRoot = join(dirname(pkgPath), '..', 'games');
  if (existsSync(gamesRoot)) {
    for (const dirent of readdirSync(gamesRoot, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const manifestPath = join(gamesRoot, dirent.name, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const gamePkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        name?: string;
        main?: string;
        exports?: string | Record<string, string>;
      };
      const name = gamePkg.name;
      if (!name || !name.startsWith('@cc/game-') || name === '@cc/game-sdk' || entries.has(name)) {
        continue;
      }
      const rawEntry =
        typeof gamePkg.exports === 'string'
          ? gamePkg.exports
          : typeof gamePkg.exports?.['.'] === 'string'
            ? gamePkg.exports['.']
            : (gamePkg.main ?? './src/index.ts');
      const fullEntry = join(gamesRoot, dirent.name, rawEntry);
      entries.set(name, { specifier: pathToFileURL(fullEntry).href, pkgName: name });
    }
  }

  return [...entries.values()].sort((a, b) => a.pkgName.localeCompare(b.pkgName));
}

/**
 * 解析热更目标：支持 gameId、短名（dice）或完整包名（@cc/game-dice）。
 * @param gameIdOrPkg 玩法 ID 或包名
 */
function resolveLoadedPackage(gameIdOrPkg: string): LoadedPackage {
  const raw = gameIdOrPkg.trim();
  if (!raw) throw new Error('gameId/包名不能为空');

  const byPkg = packagesByName.get(raw) ?? packagesByName.get(`@cc/game-${raw}`);
  if (byPkg) return byPkg;

  const byGame = packageByGameId.get(raw);
  if (byGame) return byGame;

  throw new Error(`未找到已加载的游戏包: ${raw}`);
}

/**
 * 将插件类注册进 RoomManager，并建立包索引。
 * @param manager 房间管理器
 * @param pluginClasses 构造函数列表
 * @param pkg 包元信息
 */
function registerClasses(
  manager: RoomManager,
  pluginClasses: PluginConstructor[],
  pkg: { pkgName: string; baseSpecifier: string },
): string[] {
  const gameIds: string[] = [];
  for (const PluginClass of pluginClasses) {
    const meta = manager.register(() => new PluginClass(), pkg.pkgName);
    gameIds.push(meta.gameId);

    if (meta.persistent) {
      manager.ensurePlatformRooms(meta.gameId, PLATFORM_ROOMS_INITIAL);
    } else if (BOT_HOSTED_POKER_GAMES.has(meta.gameId)) {
      manager.ensureBotHostedRooms(meta.gameId);
    }
  }

  const loaded: LoadedPackage = {
    pkgName: pkg.pkgName,
    baseSpecifier: pkg.baseSpecifier,
    gameIds,
  };
  packagesByName.set(pkg.pkgName, loaded);
  for (const id of gameIds) packageByGameId.set(id, loaded);
  return gameIds;
}

/**
 * 动态扫描并注册所有内置及扩展游戏插件。
 * 新增 `@cc/game-*` 工作区包无需改动本文件；是否初始化常驻平台房由插件 `meta.persistent` 声明。
 */
export async function registerBuiltinGames(manager: RoomManager): Promise<string[]> {
  const packages = discoverPluginPackages();
  const loaded: string[] = [];

  for (const { specifier, pkgName } of packages) {
    const mod = (await import(specifier)) as Record<string, unknown>;
    const pluginClasses = resolvePluginConstructors(mod, pkgName);
    const ids = registerClasses(manager, pluginClasses, { pkgName, baseSpecifier: specifier });
    loaded.push(...ids);
  }

  return loaded;
}

/**
 * 热卸载并重新加载一个插件包（同包多玩法连带更新，避免半新旧混跑）。
 * 调用方须先对该包内全部 gameId 完成排水，且 activeHumanGames === 0。
 *
 * @param manager 房间管理器
 * @param gameIdOrPkg 任一 gameId、短名或 @cc/game-* 包名
 * @returns 重载后的 gameId 列表
 */
export async function reloadGamePackage(
  manager: RoomManager,
  gameIdOrPkg: string,
): Promise<{ pkgName: string; gameIds: string[] }> {
  const loaded = resolveLoadedPackage(gameIdOrPkg);

  for (const gameId of loaded.gameIds) {
    const st = manager.getGameOpsStatus(gameId);
    if (st.activeHumanGames > 0) {
      throw new Error(
        `游戏 ${gameId} 仍有 ${st.activeHumanGames} 桌真人对局，请先排水后再热更`,
      );
    }
  }

  for (const gameId of loaded.gameIds) {
    manager.setGameOps(gameId, 'updating', '该游戏正在热更新中，请稍候片刻');
    manager.unregister(gameId);
  }

  // ESM 缓存打破：优先挂载卷上的源码 file URL + query；避免 Node 包名模块缓存无法刷新
  const short = loaded.pkgName.replace('@cc/game-', '');
  const entry = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'games',
    short,
    'src',
    'index.ts',
  );
  let importUrl: string;
  if (existsSync(entry)) {
    const u = pathToFileURL(entry);
    u.searchParams.set('t', String(Date.now()));
    importUrl = u.href;
  } else if (loaded.baseSpecifier.startsWith('file:')) {
    const u = new URL(loaded.baseSpecifier.split('?')[0]!);
    u.searchParams.set('t', String(Date.now()));
    importUrl = u.href;
  } else {
    throw new Error(
      `无法解析热更入口 ${loaded.pkgName}：请确认 services/games/${short}/src/index.ts 存在且已挂载到容器`,
    );
  }

  log.info('热加载游戏包', { pkgName: loaded.pkgName, importUrl });

  try {
    const mod = (await import(importUrl)) as Record<string, unknown>;
    const pluginClasses = resolvePluginConstructors(mod, loaded.pkgName);
    // 清掉旧索引再注册（gameIds 可能增减）
    packagesByName.delete(loaded.pkgName);
    for (const id of loaded.gameIds) packageByGameId.delete(id);

    const gameIds = registerClasses(manager, pluginClasses, {
      pkgName: loaded.pkgName,
      baseSpecifier: loaded.baseSpecifier.startsWith('file:')
        ? loaded.baseSpecifier.split('?')[0]!
        : loaded.baseSpecifier,
    });

    for (const gameId of gameIds) {
      manager.markGameReloaded(gameId);
      manager.setGameOps(gameId, 'enabled');
    }

    return { pkgName: loaded.pkgName, gameIds };
  } catch (error) {
    // 热更失败：保持 updating/disabled，避免半残状态对外开启
    for (const gameId of loaded.gameIds) {
      try {
        manager.setGameOps(
          gameId,
          'disabled',
          `热更新失败，已自动下架：${(error as Error).message}`,
        );
      } catch {
        /* 元数据可能已卸，忽略 */
      }
    }
    throw error;
  }
}

/** 查询已加载包（测试 / 诊断用） */
export function listLoadedPackages(): LoadedPackage[] {
  return [...packagesByName.values()];
}
