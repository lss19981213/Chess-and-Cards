import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { GamePlugin } from '@cc/game-sdk';
import { PLATFORM_ROOMS_INITIAL, type RoomManager } from './registry';

type PluginConstructor = new () => GamePlugin;

interface DiscoveryEntry {
  specifier: string;
  pkgName: string;
}

function isPluginConstructor(value: unknown): value is PluginConstructor {
  return (
    typeof value === 'function' &&
    typeof value.prototype === 'object' &&
    value.prototype !== null &&
    typeof (value.prototype as { getSnapshot?: unknown }).getSnapshot === 'function'
  );
}

function resolvePluginConstructor(mod: Record<string, unknown>, pkgName: string): PluginConstructor {
  if (isPluginConstructor(mod.default)) return mod.default;

  for (const [key, value] of Object.entries(mod)) {
    if (key.endsWith('Plugin') && isPluginConstructor(value)) return value;
  }
  for (const value of Object.values(mod)) {
    if (isPluginConstructor(value)) return value;
  }
  throw new Error(`插件包 ${pkgName} 未导出合法的 GamePlugin 类`);
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
 * 动态扫描并注册所有内置及扩展游戏插件。
 * 新增 `@cc/game-*` 工作区包无需改动本文件；是否初始化常驻平台房由插件 `meta.persistent` 声明。
 */
export async function registerBuiltinGames(manager: RoomManager): Promise<string[]> {
  const packages = discoverPluginPackages();
  const loaded: string[] = [];

  for (const { specifier, pkgName } of packages) {
    const mod = (await import(specifier)) as Record<string, unknown>;
    const PluginClass = resolvePluginConstructor(mod, pkgName);
    const meta = manager.register(() => new PluginClass());
    loaded.push(meta.gameId);

    if (meta.persistent) {
      manager.ensurePlatformRooms(meta.gameId, PLATFORM_ROOMS_INITIAL);
    }
  }

  return loaded;
}
