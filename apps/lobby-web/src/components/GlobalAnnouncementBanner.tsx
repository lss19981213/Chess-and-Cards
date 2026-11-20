import { useEffect, useRef, useState } from 'react';
import type { Announcement } from '@cc/protocol';
import { api } from '../api';
import { audio } from '../audio';
import { IconNotice } from './Icons';

interface AnnouncementItem {
  id: string;
  title?: string;
  content: string;
  kind?: string;
  expiresAt?: number | null;
}

interface Props {
  onOpenNotices?: () => void;
}

/**
 * 全局置顶悬浮巨大公告栏
 * 无论玩家在哪个页面（大厅、各游戏对战房间、个人中心、好友、排行榜等），
 * 一旦有公告或全服广播需要展示，页面顶部立即悬浮弹出金色奢华通告栏，
 * 播完后自动平滑隐藏，且玩家可随时点击「✕ 隐藏」按钮立即关闭当前公告。
 */
export function GlobalAnnouncementBanner({ onOpenNotices }: Props) {
  const [current, setCurrent] = useState<AnnouncementItem | null>(null);
  const [visible, setVisible] = useState(false);
  const queueRef = useRef<AnnouncementItem[]>([]);
  const isPlayingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const dismissedSetRef = useRef<Set<string>>(new Set());

  const playNext = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const next = queueRef.current.shift();
    if (!next) {
      isPlayingRef.current = false;
      setVisible(false);
      window.setTimeout(() => setCurrent(null), 400);
      return;
    }

    isPlayingRef.current = true;
    setCurrent(next);
    setVisible(true);

    // 播放全服通告/赌神入场音效
    if (
      next.content.includes('【全服广播】') ||
      next.content.includes('赌神') ||
      next.content.includes('大奖')
    ) {
      audio.play('god_login');
    }

    // 播完公告内容时自动平滑隐藏（按文本长度计算展示时长，14 ~ 28 秒）
    const durationMs = Math.max(14_000, Math.min(28_000, next.content.length * 380));
    timerRef.current = window.setTimeout(() => {
      setVisible(false);
      dismissedSetRef.current.add(next.id);
      window.setTimeout(() => {
        playNext();
      }, 500);
    }, durationMs);
  };

  const enqueue = (items: AnnouncementItem[]) => {
    let added = false;
    const now = Date.now();
    for (const item of items) {
      if (!item.content || dismissedSetRef.current.has(item.id)) continue;
      // 若已超过有效截止时间，则直接忽略丢弃，不再在页面顶部弹窗播报
      if (item.expiresAt != null && item.expiresAt <= now) continue;
      if (current?.id === item.id || queueRef.current.some((q) => q.id === item.id)) continue;
      queueRef.current.push(item);
      added = true;
    }
    if (added && !isPlayingRef.current) {
      playNext();
    }
  };

  // 1. 监听全局广播事件（来自 WebSocket 或其他业务模块派发）
  useEffect(() => {
    const handleBroadcast = (ev: Event) => {
      const detail = (ev as CustomEvent<AnnouncementItem>).detail;
      if (detail && detail.content) {
        enqueue([detail]);
      }
    };

    window.addEventListener('cc:announcement', handleBroadcast);
    return () => window.removeEventListener('cc:announcement', handleBroadcast);
  }, []);

  // 2. 轮询官方公告列表（初次进入与定期同步，仅拉取有效期内公告）
  useEffect(() => {
    const fetchAnnouncements = () => {
      api
        .announcements()
        .then((res) => {
          const list: Announcement[] = res.announcements ?? [];
          if (list.length > 0) {
            enqueue(
              list.map((a) => ({
                id: a.id,
                title: a.title,
                content: a.content,
                kind: a.kind,
                expiresAt: a.expiresAt,
              })),
            );
          }
        })
        .catch(() => undefined);
    };

    fetchAnnouncements();
    const interval = window.setInterval(fetchAnnouncements, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const handleDismiss = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (current) {
      dismissedSetRef.current.add(current.id);
    }
    setVisible(false);
    window.setTimeout(() => {
      playNext();
    }, 400);
  };

  if (!current && !visible) return null;

  const isVip =
    current?.content.includes('【全服广播】') ||
    current?.content.includes('赌神') ||
    current?.content.includes('豪赢');
  const fullText = current
    ? current.title
      ? `✦ ${current.title} ✦　${current.content}`
      : `✦ 全服广播 ✦　${current.content}`
    : '';

  return (
    <aside
      className={`global-floating-announcement-banner ${visible ? 'is-visible' : ''} ${isVip ? 'is-vip' : ''}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="gfa-banner__glow" aria-hidden="true" />
      <div className="gfa-banner__inner">
        {/* 左侧徽章 */}
        <div className="gfa-banner__badge">
          <span className="gfa-badge-icon" aria-hidden="true">
            {isVip ? '👑' : <IconNotice size={16} />}
          </span>
          <span className="gfa-badge-text">{isVip ? '全服通告' : '官方公告'}</span>
        </div>

        {/* 中间宽屏跑马灯滚动区 */}
        <div
          className="gfa-banner__viewport"
          onClick={onOpenNotices}
          title="点击查阅全部系统公告"
          role="button"
          tabIndex={0}
        >
          <div className="gfa-banner__track">
            <span className="gfa-banner__text">{fullText}</span>
            <span className="gfa-banner__text" aria-hidden="true">
              {fullText}
            </span>
          </div>
        </div>

        {/* 右侧操作区：详情与关闭/隐藏 */}
        <div className="gfa-banner__actions">
          {onOpenNotices && (
            <button
              type="button"
              className="gfa-btn gfa-btn--view"
              onClick={onOpenNotices}
              title="查看历史所有公告与活动"
            >
              详情
            </button>
          )}
          <button
            type="button"
            className="gfa-btn gfa-btn--close"
            onClick={handleDismiss}
            title="隐藏当前通告"
          >
            ✕ 隐藏
          </button>
        </div>
      </div>
    </aside>
  );
}
