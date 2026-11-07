import { useEffect, useState } from 'react';
import { api, type LeaderboardEntry, type LeaderboardRewardRow } from '../api';
import { Chip } from './Chip';

interface Props {
  myUserId: string | null;
  onClose: () => void;
}

type Tab = 'total' | 'reward';

/** 前十名的称号，与大厅侧口径一致 */
const RANK_TITLES = ['赌神', '赌圣', '赌侠', '赌王', '赌将', '豪侠', '名手', '高手', '老手', '新星'];

function titleOf(rank: number): string {
  return RANK_TITLES[rank - 1] ?? '座上客';
}

function Avatar({ nickname }: { nickname: string }) {
  return <span className="rank-board__avatar">{nickname.slice(0, 1) || '客'}</span>;
}

export function LeaderboardModal({ myUserId, onClose }: Props) {
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

  const rows =
    tab === 'total'
      ? entries.map((row) => ({
          key: row.userId,
          rank: row.rank,
          userId: row.userId,
          nickname: row.nickname,
          balance: row.balance,
          title: row.title || titleOf(row.rank),
          reward: row.reward,
        }))
      : rewards.map((row) => ({
          key: row.userId,
          rank: row.rank,
          userId: row.userId,
          nickname: row.nickname,
          balance: row.balance,
          title: titleOf(row.rank),
          reward: row.reward,
        }));

  return (
    <div className="modal-mask" onClick={onClose} role="presentation">
      <div className="modal rank-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head rank-modal__head">
          <div>
            <h2 className="rank-modal__heading">财 富 榜</h2>
            <p className="rank-modal__sub">每日 0 点结算 · 前 10 名按名次发放筹码奖励</p>
          </div>
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="rank-tabs">
          <button
            type="button"
            className={tab === 'total' ? 'is-active' : ''}
            onClick={() => setTab('total')}
          >
            筹码总榜
          </button>
          <button
            type="button"
            className={tab === 'reward' ? 'is-active' : ''}
            onClick={() => setTab('reward')}
          >
            上期奖励
          </button>
        </div>

        {tab === 'total' && myRank !== null && (
          <div className="rank-modal__mine">
            我的名次 <b>第 {myRank} 名</b>
            {myRank > 10 && <span>（进入前 10 可获每日奖励）</span>}
          </div>
        )}
        {tab === 'reward' && rewardDay && (
          <div className="rank-modal__mine">
            {rewardDay} 结算 · 奖励已发放
          </div>
        )}

        {error && <p className="form-error">{error}</p>}
        {loading && <p className="hint">加载中…</p>}

        {!loading && rows.length === 0 && (
          <p className="empty">{tab === 'total' ? '暂无数据' : '还没有结算记录，等待今日 0 点'}</p>
        )}

        <ol className="rank-board">
          {rows.map((row) => (
            <li
              key={row.key}
              className={`rank-board__row${row.rank <= 3 ? ` is-top${row.rank}` : ''}${
                row.userId === myUserId ? ' is-me' : ''
              }`}
            >
              <span className="rank-board__medal">{row.rank}</span>
              <Avatar nickname={row.nickname} />
              <span className="rank-board__name">
                <b>{row.nickname}</b>
                <em>{row.title}</em>
              </span>
              <span className="rank-board__bal">
                <Chip size={15} />
                {row.balance.toLocaleString()}
              </span>
              {row.reward > 0 && <span className="rank-board__reward">+{row.reward}</span>}
            </li>
          ))}
        </ol>

        <p className="rank-modal__foot">
          {tab === 'total'
            ? '榜单每 30 秒刷新一次，0 点结算后按名次发放奖励。'
            : '上期奖励为每日 0 点结算时的榜单快照，奖励已直接发放到对应账户。'}
        </p>
      </div>
    </div>
  );
}
