import { useEffect, useState } from 'react';
import { api, type LeaderboardEntry } from '../api';
import { Chip } from './Chip';

interface Props {
  myUserId: string | null;
  onClose: () => void;
}

interface DailyRow {
  userId: string;
  nickname: string;
  net: number;
  rounds: number;
}

type Tab = 'total' | 'daily';

export function LeaderboardModal({ myUserId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('total');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const task =
      tab === 'total'
        ? api.leaderboard(50).then((data) => {
            if (!cancelled) setEntries(data.entries);
          })
        : api.dailyWinners(20).then((data) => {
            if (!cancelled) setDaily(data.entries);
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

  return (
    <div className="modal-mask" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>排行榜</h2>
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
            className={tab === 'daily' ? 'is-active' : ''}
            onClick={() => setTab('daily')}
          >
            今日红榜
          </button>
        </div>

        {error && <p className="form-error">{error}</p>}
        {loading && <p className="hint">加载中…</p>}

        {tab === 'total' && (
          <ul className="rank-list">
            {entries.map((entry) => (
              <li
                key={entry.userId}
                className={`${entry.rank <= 3 ? `rank-list--top${entry.rank}` : ''} ${
                  entry.userId === myUserId ? 'is-me' : ''
                }`}
              >
                <span className="rank-list__no">{entry.rank}</span>
                <span className="rank-list__name">{entry.nickname}</span>
                {entry.title && <span className="rank-list__title">{entry.title}</span>}
                <span className="rank-list__bal">
                  <Chip size={14} /> {entry.balance.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}

        {tab === 'daily' && (
          <ul className="rank-list">
            {daily.map((row, index) => (
              <li
                key={row.userId}
                className={`${index < 3 ? `rank-list--top${index + 1}` : ''} ${
                  row.userId === myUserId ? 'is-me' : ''
                }`}
              >
                <span className="rank-list__no">{index + 1}</span>
                <span className="rank-list__name">{row.nickname}</span>
                <span className="rank-list__sub">{row.rounds} 局</span>
                <span className="rank-list__bal up">
                  +{row.net.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}

        {tab === 'total' && entries.length === 0 && !loading && <p className="empty">暂无数据</p>}
        {tab === 'daily' && daily.length === 0 && !loading && (
          <p className="empty">今天还没有人盈利，来当第一个</p>
        )}

        <p className="auth__hint">
          {tab === 'total'
            ? '前 10 名依次获得赌神、赌圣、赌侠等称号。'
            : '按今日结算净收益排序，每日 0 点重置（北京时间）。'}
        </p>
      </div>
    </div>
  );
}
