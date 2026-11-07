import type { GameMeta } from '@cc/protocol';
import type { User } from '../api';

interface Props {
  user: User;
  games: GameMeta[];
  onEnter: (game: GameMeta) => void;
  onLogout: () => void;
}

export function Lobby({ user, games, onEnter, onLogout }: Props) {
  return (
    <div className="lobby">
      <header className="topbar">
        <div className="brand brand--sm">
          <span className="brand__mark">♠</span>
          <h1>棋牌娱乐大厅</h1>
        </div>
        <div className="topbar__right">
          <div className="wallet">
            <span>积分</span>
            <strong>{user.balance.toLocaleString()}</strong>
          </div>
          <div className="user-chip">{user.nickname.slice(0, 1)}</div>
          <span className="user-name">{user.nickname}</span>
          <button type="button" className="ghost" onClick={onLogout}>
            退出
          </button>
        </div>
      </header>

      <main className="lobby__main">
        <div className="section-title">
          <h2>全部游戏</h2>
          <span>{games.length} 款可玩</span>
        </div>

        <div className="game-grid">
          {games.map((game) => (
            <button key={game.gameId} type="button" className="game-card" onClick={() => onEnter(game)}>
              <span className="game-card__icon">{game.icon}</span>
              <span className="game-card__name">{game.name}</span>
              <span className="game-card__desc">{game.description}</span>
              <span className="game-card__tags">
                {game.tags.map((tag) => (
                  <em key={tag}>{tag}</em>
                ))}
              </span>
              <span className="game-card__cta">快速开始 →</span>
            </button>
          ))}
          {games.length === 0 && <p className="empty">暂无可用游戏，请确认游戏服已启动。</p>}
        </div>
      </main>
    </div>
  );
}
