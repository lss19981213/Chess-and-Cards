import type { GameIntent } from '@cc/game-sdk';
import { config } from './config';
import type { GameRoom } from './room';
import { createLogger } from './logger';

const log = createLogger('bot');

/**
 * 机器人决策器：
 * 优先请求大模型（智谱 GLM），失败或超时自动回退到插件的规则 AI。
 * 模型只输出建议动作，真正的合法性由房间统一校验，非法动作会被丢弃。
 */

export const BOT_NAMES: readonly string[] = [
  '智多星',
  '小机灵',
  '算无遗策',
  '牌桌猎手',
  '冷静先生',
  '快刀手',
  '老练玩家',
  '深蓝之手',
];

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export function llmReady(): boolean {
  return config.bot.enabled && config.bot.apiKey.length > 0;
}

async function askModel(system: string, user: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.bot.timeoutMs);
  try {
    const res = await fetch(`${config.bot.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.bot.apiKey}`,
      },
      body: JSON.stringify({
        model: config.bot.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.5,
        max_tokens: 180,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      log.warn('模型调用失败，回退规则 AI', { status: res.status });
      return null;
    }
    const body = (await res.json()) as ChatResponse;
    return body.choices?.[0]?.message?.content ?? null;
  } catch (error) {
    log.warn('模型调用异常，回退规则 AI', { error: (error as Error).message });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT =
  '你是一名棋牌游戏 AI 玩家，风格稳健、善于计算。只输出一个 JSON 对象，不要解释、不要多余文字。';

function rankText(rank: number): string {
  if (rank === 17) return '大王';
  if (rank === 16) return '小王';
  if (rank === 15) return '2';
  if (rank === 14) return 'A';
  if (rank === 13) return 'K';
  if (rank === 12) return 'Q';
  if (rank === 11) return 'J';
  return String(rank);
}

function gomokuPrompt(snapshot: Record<string, unknown>): string {
  const size = Number(snapshot.size ?? 15);
  const cells = (snapshot.cells as number[]) ?? [];
  const mySide = Number(snapshot.mySide ?? 0);
  const moveCount = Number(snapshot.moveCount ?? 0);

  if (mySide === 0) return '';
  if (moveCount === 0) return '{"x":7,"y":7}';

  const rows: string[] = [];
  for (let y = 0; y < size; y += 1) {
    let row = '';
    for (let x = 0; x < size; x += 1) {
      const value = cells[y * size + x] ?? 0;
      row += value === 0 ? '.' : value === mySide ? 'X' : 'O';
    }
    rows.push(`${String(y).padStart(2, ' ')} ${row}`);
  }

  return (
    `你在下 ${size}x${size} 五子棋，执${mySide === 1 ? '黑(X)' : '白(O)'}，现在轮到你落子。\n` +
    `棋盘（. 空、X 是你的、O 是对手），每行前的数字是 y 坐标，每列从左到右是 x 坐标 0-${size - 1}：\n` +
    `${rows.join('\n')}\n` +
    `请给出最佳落点，只返回 JSON：{"x":整数,"y":整数}`
  );
}

function cardPrompt(gameId: string, snapshot: Record<string, unknown>): string {
  const hand = (snapshot.myHand as Array<{ id: string; rank: number }>) ?? [];
  const last = snapshot.lastCombo as { kind: string; cards: Array<{ id: string; rank: number }> } | null;
  const gameName = gameId === 'doudizhu' ? '斗地主' : '跑得快';

  const handText = hand.map((c) => `${c.id}(${rankText(c.rank)})`).join(' ');
  const lastText = last
    ? `上家出了 ${last.kind}：${last.cards.map((c) => `${c.id}(${rankText(c.rank)})`).join(' ')}`
    : '你是本轮首家，可以出任意合法牌型';

  return (
    `你在玩${gameName}。\n你的手牌：${handText}\n${lastText}\n` +
    `请决定这一手。若要出牌，返回 {"cards":["牌id",...]}，牌 id 必须来自你的手牌且牌型合法（需压过上家）；` +
    `若要放弃，返回 {"pass":true}。只返回 JSON。`
  );
}

function texasPrompt(snapshot: Record<string, unknown>): string {
  const hand = (snapshot.myHand as Array<{ rank: number; suit?: string }>) ?? [];
  const community = (snapshot.community as Array<{ rank: number }>) ?? [];
  const pot = Number(snapshot.pot ?? 0);
  const toCall = Number(snapshot.toCall ?? 0);
  const phase = String(snapshot.phaseLabel ?? '');

  const name = (c: { rank: number }): string => rankText(c.rank);

  return (
    `你在玩德州扑克，当前阶段：${phase}。\n` +
    `你的底牌：${hand.map(name).join(' ')}\n` +
    `公共牌：${community.length > 0 ? community.map(name).join(' ') : '暂无'}\n` +
    `底池 ${pot}，你需要跟注 ${toCall}。\n` +
    `可选动作：fold（弃牌）、check（过牌，仅在无需跟注时）、call（跟注）、raise（加注 100）。\n` +
    `只返回 JSON：{"action":"${toCall > 0 ? 'call' : 'check'}"}`
  );
}

/** 询问大模型；不可用或解析失败返回 null */
export async function askBotLlm(room: GameRoom, botId: string): Promise<GameIntent | null> {
  if (!llmReady()) return null;

  const snapshot = room.snapshotFor(botId);
  if (!snapshot) return null;

  let prompt = '';
  if (room.gameId === 'gomoku') {
    prompt = gomokuPrompt(snapshot);
    if (!prompt) return null;
    if (prompt.startsWith('{')) {
      const parsed = extractJson(prompt);
      if (parsed) return { cmd: 'place', payload: { x: Number(parsed.x), y: Number(parsed.y) } };
    }
  } else if (room.gameId === 'doudizhu' || room.gameId === 'paodekuai') {
    prompt = cardPrompt(room.gameId, snapshot);
  } else if (room.gameId === 'texas') {
    prompt = texasPrompt(snapshot);
  } else {
    return null;
  }

  const answer = await askModel(SYSTEM_PROMPT, prompt);
  if (!answer) return null;

  const parsed = extractJson(answer);
  if (!parsed) return null;

  if (room.gameId === 'gomoku') {
    const x = Number(parsed.x);
    const y = Number(parsed.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
    return { cmd: 'place', payload: { x, y } };
  }

  if (room.gameId === 'doudizhu' || room.gameId === 'paodekuai') {
    if (parsed.pass === true) return { cmd: 'pass', payload: {} };
    const cards = Array.isArray(parsed.cards) ? parsed.cards.filter((id): id is string => typeof id === 'string') : [];
    if (cards.length === 0) return null;
    return { cmd: 'play', payload: { cards } };
  }

  if (room.gameId === 'texas') {
    const action = String(parsed.action ?? '');
    if (['fold', 'check', 'call', 'raise'].includes(action)) {
      // 无需跟注时不能 call（会让机器人卡死在当前轮），纠正为过牌
      const toCall = Number(snapshot.toCall ?? 0);
      const cmd = action === 'call' && toCall <= 0 ? 'check' : action;
      return { cmd, payload: {} };
    }
    return null;
  }

  return null;
}

/**
 * 驱动机器人行动：先尝试大模型，失败后回退规则 AI。
 * 返回 true 表示已成功提交动作。
 */
export async function driveBot(room: GameRoom, botId: string): Promise<boolean> {
  const think = config.bot.thinkMs + Math.floor(Math.random() * 500);
  await new Promise((resolve) => setTimeout(resolve, think));

  // 思考期间局面可能已经变化
  if (room.currentActor() !== botId) return false;

  const llmIntent = await askBotLlm(room, botId);
  if (llmIntent) {
    try {
      room.applyBotIntent(botId, llmIntent);
      return true;
    } catch (error) {
      log.warn('模型输出动作非法，回退规则 AI', { error: (error as Error).message });
    }
  }

  return room.actAsBot(botId);
}
