import { audio } from '../audio';
import { DEALER_CELEBRATE } from '../assets';
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
  niuniu: '斗牛',
  blackjack: '21点',
  stud: '梭哈',
  goldenflower: '翻金花',
  chess: '国际象棋',
  xiangqi: '中国象棋',
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
  const safeRows = Array.isArray(rows) ? rows : [];
  const mine = safeRows.find((row) => row?.playerId === myId);
  const delta = mine?.delta ?? 0;
  const isWin = delta > 0;
  const isLose = delta < 0;

  const ranked = [...safeRows].sort((a, b) => (b?.delta ?? 0) - (a?.delta ?? 0));
  const titleText = isWin ? '旗开得胜 · 大吉大利' : isLose ? '局结失利 · 虽败犹荣' : '本局平局 · 势均力敌';

  return (
    <div className="settle-mask">
      <div className={`settle-dialog settle-dialog--deluxe ${isWin ? 'is-win' : isLose ? 'is-lose' : 'is-draw'}`}>
        {isWin && (
          <div className="settle-sunburst">
            <div className="sunburst-rays" />
          </div>
        )}

        {/* 动漫美女荷官胜利祝贺插画 */}
        {isWin && (
          <div className="settle-dealer-celebrate">
            <img src={DEALER_CELEBRATE} alt="美女荷官祝贺" />
            <span className="celebrate-speech-bubble">“哇！恭喜主人大获全胜～太厉害啦！”</span>
          </div>
        )}

        <div className="settle-main-content">
          <div className="settle-dialog__head">
            <div className="settle-crown-icon">{isWin ? '👑' : isLose ? '🛡️' : '⚖️'}</div>
            <h2 className="settle-title">{titleText}</h2>
            <span className="settle-sub">
              {GAME_NAME[gameId] ?? gameId} · 第 {round} 局结算
            </span>
          </div>

          <div className="settle-my-delta">
            <span className="delta-label">本局收益</span>
            <strong className={`delta-amount ${delta > 0 ? 'is-pos' : delta < 0 ? 'is-neg' : ''}`}>
              {delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString()}
            </strong>
            <div className="settle-balance-row">
              <span>当前筹码余额：</span>
              <Chip size={16} />
              <em>{balance.toLocaleString()}</em>
            </div>
          </div>

          <div className="settle-scoreboard">
            <div className="scoreboard-title">全桌对局积分一览</div>
            <div className="scoreboard-list">
              {ranked.map((row, idx) => {
                const rowIsMe = row.playerId === myId;
                return (
                  <div key={row.playerId} className={`scoreboard-row ${rowIsMe ? 'is-me' : ''}`}>
                    <span className={`rank-tag rank-${idx + 1}`}>
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`}
                    </span>
                    <span className="player-col">
                      <strong>{row.nickname}</strong>
                      {row.isBot && <em className="tag-ai">人机</em>}
                      {rowIsMe && <em className="tag-self">我</em>}
                    </span>
                    <span className={`score-col ${row.delta > 0 ? 'is-pos' : row.delta < 0 ? 'is-neg' : ''}`}>
                      {row.delta > 0 ? `+${row.delta.toLocaleString()}` : row.delta.toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="settle-actions">
            {!persistent && (
              <button
                type="button"
                className="luxury-btn luxury-btn--gold"
                onClick={() => {
                  audio.play('click');
                  onContinue();
                }}
              >
                ✦ 再来一局 (准备) ✦
              </button>
            )}
            <button
              type="button"
              className="luxury-btn luxury-btn--outline"
              onClick={() => {
                audio.play('click');
                onClose();
              }}
            >
              {persistent ? '查看牌面' : '关闭面板'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
