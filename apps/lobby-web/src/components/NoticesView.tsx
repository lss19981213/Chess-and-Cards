import { useEffect, useState } from 'react';
import type { Announcement } from '@cc/protocol';
import { api } from '../api';
import { IconBack, IconNotice } from './Icons';

interface Props {
  onBack: () => void;
}

const KIND_LABEL: Record<Announcement['kind'], string> = {
  notice: '公告',
  event: '活动',
  maintenance: '维护',
};

export function NoticesView({ onBack }: Props) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api
      .announcements()
      .then((data) => setAnnouncements(data.announcements ?? []))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="full-screen-view notices-view">
      <header className="view-topbar">
        <button type="button" className="view-back-btn" onClick={onBack}>
          <IconBack size={18} />
          <span>返回大厅</span>
        </button>
        <div className="view-title">
          <IconNotice size={22} />
          <h2>官方告示长卷</h2>
          <span className="view-sub">平台动态 · 赛事活动 · 维护更新通知</span>
        </div>
        <div className="view-topbar__placeholder" />
      </header>

      <main className="view-main notices-layout">
        <div className="notices-scroll-panel">
          {loading && <div className="view-loading">正在调取官方告示…</div>}
          {announcements.map((item) => (
            <article key={item.id} className={`notice-card-view is-${item.kind}`}>
              <div className="notice-card__head">
                <span className={`kind-badge badge--${item.kind}`}>{KIND_LABEL[item.kind]}</span>
                <h3>{item.title}</h3>
                <time>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</time>
              </div>
              <p className="notice-card__content">{item.content}</p>
            </article>
          ))}
          {announcements.length === 0 && !loading && (
            <div className="view-empty">
              <IconNotice size={36} />
              <p>暂无新发布的官方告示</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
