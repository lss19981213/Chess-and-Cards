import type { GameMeta } from '@cc/protocol';

/**
 * 游戏服不可达时的兜底目录。
 * 正常运行时应以游戏服上报的元数据为准，这里只保证大厅不会因为
 * 一次网络抖动就变成空列表。
 */
export const FALLBACK_GAMES: GameMeta[] = [
  {
    gameId: 'gomoku',
    name: '五子棋',
    description: '15 路经典五子棋，先连成五子者胜',
    icon: '⚫',
    minPlayers: 2,
    maxPlayers: 2,
    version: '1.0.0',
    clientBundle: 'builtin:gomoku',
    tags: ['棋类', '双人', '休闲'],
  },
  {
    gameId: 'doudizhu',
    name: '斗地主',
    description: '经典三人斗地主，抢地主抢先出完手牌',
    icon: '🃏',
    minPlayers: 3,
    maxPlayers: 3,
    version: '1.0.0',
    clientBundle: 'builtin:doudizhu',
    tags: ['牌类', '三人', '热门'],
  },
  {
    gameId: 'paodekuai',
    name: '跑得快',
    description: '16 张牌快节奏对局，先跑完者胜',
    icon: '💨',
    minPlayers: 3,
    maxPlayers: 3,
    version: '1.0.0',
    clientBundle: 'builtin:paodekuai',
    tags: ['牌类', '三人', '快节奏'],
  },
  {
    gameId: 'tuizhuanzi',
    name: '推筒子',
    description: '两张牌比点数，庄闲对决一局定胜负',
    icon: '🎴',
    minPlayers: 2,
    maxPlayers: 5,
    version: '1.0.0',
    clientBundle: 'builtin:tuizhuanzi',
    tags: ['牌类', '多人', '刺激'],
  },
  {
    gameId: 'texas',
    name: '德州扑克',
    description: '两张底牌加五张公共牌，比牌型大小',
    icon: '♠️',
    minPlayers: 2,
    maxPlayers: 6,
    version: '1.0.0',
    clientBundle: 'builtin:texas',
    tags: ['牌类', '多人', '竞技'],
  },
];
