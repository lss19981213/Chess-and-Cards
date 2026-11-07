import { useState } from 'react';
import type { GameMeta } from '@cc/protocol';
import type { User } from '../api';
import { audio } from '../audio';
import { GAME_ART, HERO_BG } from '../assets';
import { Chip } from './Chip';

interface Props {
  user: User | null;
  games: GameMeta[];
  onEnter: (game: GameMeta) => void;
  onLogin: () => void;
  onLogout: () => void;
  onTasks: () => void;
  onLeaderboard: () => void;
}

const CATEGORIES = [
  { key: 'board', title: '棋类对弈', desc: '一对一，纯技术' },
  { key: 'table', title: '牌桌对战', desc: '多人竞技，凭牌技取胜' },
  { key: 'live', title: '极速下注', desc: '平台坐庄，每 12 秒一局' },
] as const;

export function Lobby({ user, games, onEnter, onLogin, onLogout, onTasks, onLeaderboard }: Props) {
  const [musicOn, setMusicOn] = useState(audio.musicOn);
  const [sfxOn, setSfxOn] = useState(audio.sfxOn);
  const [trackName, setTrackName] = useState(audio.trackName);

  return (
    <div className="lobby" style={{ ['--lobby-bg' as string]: `url(${HERO_BG})` }}>
      <header className="topbar">
        <div className="brand brand--sm">
          <span className="brand__mark">♠</span>
          <h1>棋牌娱乐大厅</h1>
        </div>

        <div className="topbar__right">
          <button
            type="button"
            className={`icon-btn ${musicOn ? '' : 'is-off'}`}
            title={musicOn ? '关闭背景音乐' : '开启背景音乐'}
            onClick={() => setMusicOn(audio.toggleMusic())}
          >
            {musicOn ? '🎵' : '🎼'}
          </button>
          <button
            type="button"
            className={`icon-btn ${sfxOn ? '' : 'is-off'}`}
            title={sfxOn ? '关闭音效' : '开启音效'}
            onClick={() => setSfxOn(audio.toggleSfx())}
          >
            {sfxOn ? '🔊' : '🔇'}
          </button>
          <button
            type="button"
            className="icon-btn"
            title={`切换音乐（当前：${trackName}）`}
            onClick={() => setTrackName(audio.nextTrack())}
          >
            ⏭
          </button>
          <button type="button" className="ghost" onClick={onLeaderboard}>
            排行榜
          </button>
          {user ? (
            <>
              <button type="button" className="ghost" onClick={onTasks}>
                任务
              </button>
              <div className="wallet">
                <Chip size={20} />
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
        <section className="hero" style={{ backgroundImage: `linear-gradient(100deg, rgba(6,9,18,0.94) 28%, rgba(6,9,18,0.55) 60%, rgba(6,9,18,0.18)), url(${HERO_BG})` }}>
          <div className="hero__body">
            <span className="hero__eyebrow">♠ CHESS &amp; CARDS CLUB</span>
            <h2>随手一局，牌桌见真章</h2>
            <p>五款棋牌随时开局，虚拟筹码记分排名，不伤真实生活。</p>
          </div>
        </section>

        {CATEGORIES.map((category) => {
          const list = games.filter((game) => (game.category ?? 'table') === category.key);
          if (list.length === 0) return null;
          return (
            <section key={category.key} className="game-section">
              <div className="section-title">
                <h2>{category.title}</h2>
                <span>
                  {category.desc} · {list.length} 款
                </span>
              </div>

              <div className="game-grid">
                {list.map((game) => (
                  <button
                    key={game.gameId}
                    type="button"
                    className={`game-card ${game.persistent ? 'is-live' : ''}`}
                    onClick={() => {
                      audio.play('click');
                      onEnter(game);
                    }}
                  >
                    <span className="game-card__media">
                      {GAME_ART[game.gameId] ? (
                        <img src={GAME_ART[game.gameId]} alt={game.name} loading="lazy" draggable={false} />
                      ) : (
                        <span className="game-card__icon">{game.icon}</span>
                      )}
                      {game.persistent && <em className="game-card__live">平台庄</em>}
                      <span className="game-card__cta">{user ? '选台 →' : '登录玩 →'}</span>
                    </span>
                    <span className="game-card__body">
                      <span className="game-card__name">{game.name}</span>
                      <span className="game-card__desc">{game.description}</span>
                      <span className="game-card__tags">
                        {game.tags.map((tag) => (
                          <em key={tag}>{tag}</em>
                        ))}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}

        {games.length === 0 && <p className="empty">暂无可用游戏，请确认游戏服已启动。</p>}

        {!user && (
          <p className="lobby__footnote">
            浏览大厅无需登录，进入房间时才需要账号。虚拟筹码不可提现、不可转让，仅用于记分。
          </p>
        )}
      </main>
    </div>
  );
}
