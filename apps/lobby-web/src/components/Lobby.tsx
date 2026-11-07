import type { GameMeta } from '@cc/protocol';
import type { User } from '../api';

interface Props {
  user: User | null;
  games: GameMeta[];
  onEnter: (game: GameMeta) => void;
  onLogin: () => void;
  onLogout: () => void;
  onTasks: () => void;
  onLeaderboard: () => void;
}

const PLAYER_LABEL: Record<string, string> = {
  '2': '双人',
  '3': '三人',
  '4': '四人',
  '5': '多人',
  '6': '多人',
};

export function Lobby({ user, games, onEnter, onLogin, onLogout, onTasks, onLeaderboard }: Props) {
  return (
    <div className="lobby">
      <header className="topbar">
        <div className="brand brand--sm">
          <span className="brand__mark">♠</span>
          <h1>棋牌娱乐大厅</h1>
        </div>

        <div className="topbar__right">
          <button type="button" className="ghost" onClick={onLeaderboard}>
            排行榜
          </button>
          {user ? (
            <>
              <button type="button" className="ghost" onClick={onTasks}>
                任务
              </button>
              <div className="wallet">
                <span>筹码</span>
                <strong>{user.balance.toLocaleString()}</strong>
              </div>
              <div className="user-chip">{user.nickname.slice(0, 1)}</div>
              <span className="user-name">{user.nickname}</span>
              <button type="button" className="ghost" onClick={onLogout}>
                退出
              </button>
            </>
          ) : (
            <button type="button" className="primary topbar__login" onClick={onLogin}>
              登录 / 注册
            </button>
          )}
        </div>
      </header>

      <main className="lobby__main">
        <section className="hero">
          <h2>随便逛逛，想玩再登录</h2>
          <p>五款棋牌游戏随时开局，虚拟筹码记分，不影响真实生活。</p>
        </section>

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
                <em>{PLAYER_LABEL[String(game.maxPlayers)] ?? `${game.minPlayers}-${game.maxPlayers} 人`}</em>
              </span>
              <span className="game-card__cta">{user ? '快速开始 →' : '登录后开始 →'}</span>
            </button>
          ))}
          {games.length === 0 && <p className="empty">暂无可用游戏，请确认游戏服已启动。</p>}
        </div>

        {!user && (
          <p className="lobby__footnote">
            浏览大厅无需登录，进入房间时才需要账号。虚拟筹码不可提现、不可转让，仅用于记分。
          </p>
        )}
      </main>
    </div>
  );
}
