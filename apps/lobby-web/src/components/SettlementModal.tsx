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
  onClose: () => void;
}

const GAME_NAME: Record<string, string> = {
  gomoku: '五子棋',
  doudizhu: '斗地主',
  paodekuai: '跑得快',
  tuizhuanzi: '推筒子',
  texas: '德州扑克',
  dice: '骰宝',
};

export function SettlementModal({ settlement, myId, balance, players, onClose }: Props) {
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
    <div className="modal-mask settle-mask" onClick={onClose}>
      <div
        className={`modal settle-modal ${delta > 0 ? 'is-win' : delta < 0 ? 'is-lose' : ''}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settle-modal__head">
          <span className="settle-modal__game">
            {GAME_NAME[settlement.gameId] ?? settlement.gameId} · 第 {settlement.round} 局
          </span>
          <h2>{result}</h2>
        </div>

        <div className="settle-modal__delta">
          <Chip size={30} />
          <strong>{delta > 0 ? `+${delta}` : delta}</strong>
        </div>

        <div className="settle-modal__stats">
          <div>
            <span>当前筹码</span>
            <strong>{balance.toLocaleString()}</strong>
          </div>
          <div>
            <span>本局名次</span>
            <strong>
              {rank} / {total}
            </strong>
          </div>
        </div>

        <ul className="settle-modal__list">
          {ranked.map((entry, index) => (
            <li key={entry.playerId} className={entry.playerId === myId ? 'is-me' : ''}>
              <span className="settle-modal__no">{index + 1}</span>
              <span className="settle-modal__name">
                {nameOf(entry.playerId)}
                {isBot(entry.playerId) && <em className="bot-tag">AI</em>}
              </span>
              <span className={entry.delta > 0 ? 'up' : entry.delta < 0 ? 'down' : 'muted'}>
                {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
              </span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="primary settle-modal__btn"
          onClick={() => {
            audio.play('click');
            onClose();
          }}
        >
          继续
        </button>
      </div>
    </div>
  );
}
