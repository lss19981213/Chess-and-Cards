import type { Settlement } from '@cc/protocol';
import { audio } from '../audio';
import { Chip } from './Chip';

interface PlayerInfo {
  playerId: string;
  nickname: string;
  isBot: boolean;
}

interface Props {
  settlement: Settlement;
  myId: string;
  balance: number;
  players: PlayerInfo[];
  /** 常驻玩法不显示「继续」，由平台自动接下一局 */
  persistent: boolean;
  onContinue: () => void;
  onClose: () => void;
}

const GAME_NAME: Record<string, string> = {
  gomoku: '五子棋',
  doudizhu: '斗地主',
  paodekuai: '跑得快',
  tuizhuanzi: '推筒子',
  texas: '德州扑克',
  dice: '骰宝',
  baccarat: '百家乐',
};

export function SettlePanel({
  settlement,
  myId,
  balance,
  players,
  persistent,
  onContinue,
  onClose,
}: Props) {
  const mine = settlement.entries.find((entry) => entry.playerId === myId);
  const delta = mine?.delta ?? 0;
  const ranked = [...settlement.entries].sort((a, b) => b.delta - a.delta);
  const rank = ranked.findIndex((entry) => entry.playerId === myId) + 1;
  const total = ranked.length;

  const nameOf = (playerId: string): string =>
    players.find((player) => player.playerId === playerId)?.nickname ?? '玩家';
  const isBot = (playerId: string): boolean =>
    players.find((player) => player.playerId === playerId)?.isBot === true;

  const result =
    delta > 0 ? '本局胜出' : delta < 0 ? '本局失利' : total > 1 && rank === 1 ? '平局' : '本局结束';

  return (
    <aside className={`settle-panel ${delta > 0 ? 'is-win' : delta < 0 ? 'is-lose' : ''}`}>
      <div className="settle-panel__head">
        <span>
          {GAME_NAME[settlement.gameId] ?? settlement.gameId} · 第 {settlement.round} 局
        </span>
        <button type="button" className="settle-panel__close" onClick={onClose} title="收起">
          ×
        </button>
      </div>

      <div className="settle-panel__result">{result}</div>

      <div className="settle-panel__delta">
        <Chip size={22} />
        <strong>{delta > 0 ? `+${delta}` : delta}</strong>
      </div>

      <div className="settle-panel__stats">
        <div>
          <span>当前筹码</span>
          <strong>{balance.toLocaleString()}</strong>
        </div>
        <div>
          <span>本局名次</span>
          <strong>
            {rank}/{total}
          </strong>
        </div>
      </div>

      <ul className="settle-panel__list">
        {ranked.map((entry, index) => (
          <li key={entry.playerId} className={entry.playerId === myId ? 'is-me' : ''}>
            <span className="settle-panel__no">{index + 1}</span>
            <span className="settle-panel__name">
              {nameOf(entry.playerId)}
              {isBot(entry.playerId) && <em className="bot-tag">AI</em>}
            </span>
            <span className={entry.delta > 0 ? 'up' : entry.delta < 0 ? 'down' : 'muted'}>
              {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
            </span>
          </li>
        ))}
      </ul>

      {!persistent && (
        <button
          type="button"
          className="primary settle-panel__btn"
          onClick={() => {
            audio.play('click');
            onContinue();
          }}
        >
          继续
        </button>
      )}
    </aside>
  );
}
