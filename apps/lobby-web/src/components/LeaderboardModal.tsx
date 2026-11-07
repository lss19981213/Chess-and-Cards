import { useEffect, useState } from 'react';
import { api, type LeaderboardEntry } from '../api';

interface Props {
  myUserId: string | null;
  onClose: () => void;
}

export function LeaderboardModal({ myUserId, onClose }: Props) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .leaderboard(50)
      .then((data) => {
        if (!cancelled) setEntries(data.entries);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载排行榜失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="modal-mask" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>筹码排行榜</h2>
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
        </div>

        {error && <p className="form-error">{error}</p>}
        {loading && <p className="hint">加载中…</p>}

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
              <span className="rank-list__bal">{entry.balance.toLocaleString()}</span>
            </li>
          ))}
        </ul>

        {entries.length === 0 && !loading && <p className="empty">暂无数据</p>}
        <p className="auth__hint">前 10 名依次获得赌神、赌圣、赌侠等称号。</p>
      </div>
    </div>
  );
}
