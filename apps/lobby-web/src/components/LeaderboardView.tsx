import { useEffect, useState } from 'react';
import { api, type LeaderboardEntry, type LeaderboardRewardRow } from '../api';
import { Chip } from './Chip';
import { IconBack, IconCrown, IconTrophy } from './Icons';

interface Props {
  myUserId: string | null;
  onBack: () => void;
}

type Tab = 'total' | 'reward';

const RANK_TITLES = ['赌神', '赌圣', '赌侠', '赌王', '赌将', '豪侠', '名手', '高手', '老手', '新星'];

function titleOf(rank: number): string {
  return RANK_TITLES[rank - 1] ?? '座上客';
}

export function LeaderboardView({ myUserId, onBack }: Props) {
  const [tab, setTab] = useState<Tab>('total');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [rewards, setRewards] = useState<LeaderboardRewardRow[]>([]);
  const [rewardDay, setRewardDay] = useState('');
  const [myRank, setMyRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const task =
      tab === 'total'
        ? api.leaderboard().then((data) => {
            if (cancelled) return;
            setEntries(data.entries);
            setMyRank(data.myRank);
          })
        : api.leaderboardRewards().then((data) => {
            if (cancelled) return;
            setRewards(data.entries);
            setRewardDay(data.dayKey);
          });

    task
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载排行榜失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tab]);

  const topThree = entries.slice(0, 3);

  return (
    <div className="full-screen-view leaderboard-view">
      {/* 顶部统一返回条 */}
      <header className="view-topbar">
        <button type="button" className="view-back-btn" onClick={onBack}>
          <IconBack size={18} />
          <span>返回大厅</span>
        </button>
        <div className="view-title">
          <IconTrophy size={22} />
          <h2>至尊名人堂</h2>
          <span className="view-sub">筹码财富巅峰排行 · 每日结算尊贵头衔</span>
        </div>
        <div className="view-tabs-group">
          <button
            type="button"
            className={`view-tab-btn ${tab === 'total' ? 'is-active' : ''}`}
            onClick={() => setTab('total')}
          >
            财富总榜
          </button>
          <button
            type="button"
            className={`view-tab-btn ${tab === 'reward' ? 'is-active' : ''}`}
            onClick={() => setTab('reward')}
          >
            昨日殊荣
          </button>
        </div>
      </header>

      {/* 主体横向分栏 */}
      <main className="view-main rank-layout">
        {tab === 'total' ? (
          <>
            {/* 左侧前三甲神坛展台 */}
            <aside className="rank-podium-card">
              <div className="podium-header">
                <IconCrown size={28} />
                <h3>至尊三甲</h3>
              </div>
              <div className="podium-slots">
                {topThree.map((item, idx) => (
                  <div key={item.userId} className={`podium-slot slot--${idx + 1}`}>
                    <div className="podium-crown">{idx === 0 ? '👑' : idx === 1 ? '🥈' : '🥉'}</div>
                    <div className="podium-avatar">{item.nickname.slice(0, 1)}</div>
                    <strong className="podium-name">{item.nickname}</strong>
                    <span className="podium-title-tag">{titleOf(idx + 1)}</span>
                    <div className="podium-chips">
                      <Chip size={14} />
                      <span>{item.balance.toLocaleString()}</span>
                    </div>
                  </div>
                ))}
                {topThree.length === 0 && <p className="hint">虚位以待，等你登顶</p>}
              </div>

              {myRank && (
                <div className="my-rank-status-bar">
                  <span>我的排名：第 <strong>{myRank}</strong> 名</span>
                </div>
              )}
            </aside>

            {/* 右侧完整榜单 */}
            <section className="rank-table-panel">
              {error && <div className="luxury-alert is-error">{error}</div>}
              {loading && <div className="view-loading">正在拉取名人堂战绩…</div>}

              <div className="rank-table-list">
                {entries.map((item) => {
                  const isMe = item.userId === myUserId;
                  return (
                    <div
                      key={item.userId}
                      className={`rank-item-card ${isMe ? 'is-me' : ''} ${item.rank <= 3 ? `is-top${item.rank}` : ''}`}
                    >
                      <div className="rank-index-col">
                        <span className="rank-badge-num">{item.rank}</span>
                      </div>
                      <div className="rank-user-col">
                        <span className="rank-avatar-mini">{item.nickname.slice(0, 1)}</span>
                        <div className="rank-user-text">
                          <strong>{item.nickname}</strong>
                          {isMe && <em className="tag-self">我</em>}
                        </div>
                      </div>
                      <div className="rank-title-col">
                        <span className="title-pill">{titleOf(item.rank)}</span>
                      </div>
                      <div className="rank-balance-col">
                        <Chip size={16} />
                        <strong>{item.balance.toLocaleString()}</strong>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        ) : (
          <section className="rank-reward-full">
            <div className="reward-day-pill">统计日期：{rewardDay || '今日'}</div>
            <div className="rank-table-list">
              {rewards.map((row) => (
                <div key={row.userId} className="rank-item-card">
                  <div className="rank-index-col">
                    <span className="rank-badge-num">{row.rank}</span>
                  </div>
                  <div className="rank-user-col">
                    <strong>{row.nickname}</strong>
                  </div>
                  <div className="rank-title-col">
                    <span className="title-pill">{titleOf(row.rank)}</span>
                  </div>
                  <div className="rank-balance-col">
                    <span className="reward-hint">获得称号：{titleOf(row.rank)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
