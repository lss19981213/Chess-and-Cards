import { audio } from '../audio';
import { Chip } from './Chip';

export interface ResultRow {
  playerId: string;
  nickname: string;
  delta: number;
  isBot?: boolean;
}

interface Props {
  gameId: string;
  round: number;
  rows: ResultRow[];
  myId: string;
  balance: number;
  /** 平台坐庄的常驻玩法不显示「继续」，由平台自动接下一局 */
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
  gameId,
  round,
  rows,
  myId,
  balance,
  persistent,
  onContinue,
  onClose,
}: Props) {
  const mine = rows.find((row) => row.playerId === myId);
  const delta = mine?.delta ?? 0;
  const ranked = [...rows].sort((a, b) => b.delta - a.delta);
  const rank = ranked.findIndex((row) => row.playerId === myId) + 1;
  const total = ranked.length;

  const result =
    delta > 0 ? '本局胜出' : delta < 0 ? '本局失利' : total > 1 && rank === 1 ? '平局' : '本局结束';

  return (
    <aside className={`settle-panel ${delta > 0 ? 'is-win' : delta < 0 ? 'is-lose' : ''}`}>
      <div className="settle-panel__head">
        <span>
          {GAME_NAME[gameId] ?? gameId} · 第 {round} 局
        </span>
        {persistent && (
          <button type="button" className="settle-panel__close" onClick={onClose} title="收起">
            ×
          </button>
        )}
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
        {ranked.map((row, index) => (
          <li key={row.playerId} className={row.playerId === myId ? 'is-me' : ''}>
            <span className="settle-panel__no">{index + 1}</span>
            <span className="settle-panel__name">
              {row.nickname}
              {row.isBot && <em className="bot-tag">AI</em>}
            </span>
            <span className={row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : 'muted'}>
              {row.delta > 0 ? `+${row.delta}` : row.delta}
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
