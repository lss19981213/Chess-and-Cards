import { useCallback, useEffect, useState } from 'react';
import { api, type PlayerProfile } from '../api';
import { audio } from '../audio';
import { PlayerAvatar } from './FriendsView';

interface Props {
  roomId: string;
  gameId: string;
  roomName: string;
  onClose: () => void;
  onOpenFriends?: () => void;
}

/** 牌桌内邀请：好友走站内邀请，非好友复制链接 */
export function InviteFriendsModal({ roomId, gameId, roomName, onClose, onOpenFriends }: Props) {
  const [friends, setFriends] = useState<PlayerProfile[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [hint, setHint] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const [sending, setSending] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const inviteLink =
    `${window.location.origin}${import.meta.env.BASE_URL}?join=${encodeURIComponent(roomId)}` +
    `&game=${encodeURIComponent(gameId)}`;

  const notify = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    setHint({ text, tone });
    window.setTimeout(() => setHint(null), 2400);
  }, []);

  useEffect(() => {
    api
      .friends()
      .then((data) => setFriends(data.friends))
      .catch(() => setFriends([]));
  }, []);

  const toggle = (userId: string): void => {
    audio.play('click');
    setSelected((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  };

  const copyLink = async (): Promise<void> => {
    audio.play('click');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteLink);
      } else {
        // 老浏览器降级
        const input = document.createElement('textarea');
        input.value = inviteLink;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      setLinkCopied(true);
      notify('邀请链接已复制，发给好友即可入座');
      window.setTimeout(() => setLinkCopied(false), 3000);
    } catch {
      notify('复制失败，请手动选择链接复制', 'err');
    }
  };

  const send = async (): Promise<void> => {
    if (selected.length === 0) {
      notify('请先选择要邀请的好友', 'err');
      return;
    }
    setSending(true);
    try {
      const res = await api.inviteToRoom({ roomId, gameId, roomName, friendIds: selected });
      audio.play('shunzi');
      notify(`已向 ${res.sent} 位好友发出邀请`);
      setSelected([]);
    } catch (error) {
      notify(error instanceof Error ? error.message : '邀请失败', 'err');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="invite-overlay" role="dialog" aria-modal="true" aria-label="邀请好友">
      <div className="invite-modal">
        <header className="invite-modal__head">
          <h3>邀请好友入座</h3>
          <button type="button" className="invite-modal__close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>

        {hint && <div className={`invite-modal__hint is-${hint.tone}`}>{hint.text}</div>}

        <div className="invite-link-box">
          <div className="invite-link-box__text">
            <span>邀请链接</span>
            <code>{inviteLink}</code>
          </div>
          <button type="button" className={`invite-link-box__copy ${linkCopied ? 'is-done' : ''}`} onClick={copyLink}>
            {linkCopied ? '已复制' : '复制链接'}
          </button>
        </div>
        <p className="invite-modal__note">非好友也能通过这条链接入座，链接长期有效。</p>

        <div className="invite-modal__list-head">
          <span>我的好友</span>
          <span>{friends.length} 位</span>
        </div>

        <div className="invite-friend-list">
          {friends.length === 0 && (
            <div className="invite-friend-list__empty">
              <p>还没有好友</p>
              {onOpenFriends && (
                <button type="button" onClick={onOpenFriends}>
                  去添加好友
                </button>
              )}
            </div>
          )}
          {friends.map((player) => {
            const active = selected.includes(player.userId);
            return (
              <button
                type="button"
                key={player.userId}
                className={`invite-friend ${active ? 'is-selected' : ''}`}
                onClick={() => toggle(player.userId)}
              >
                <PlayerAvatar player={player} size={38} />
                <span className="invite-friend__name">{player.nickname}</span>
                <span className="invite-friend__check">{active ? '✓' : ''}</span>
              </button>
            );
          })}
        </div>

        <footer className="invite-modal__foot">
          <button type="button" className="invite-modal__cancel" onClick={onClose}>
            关闭
          </button>
          <button
            type="button"
            className="invite-modal__send"
            disabled={sending || selected.length === 0}
            onClick={send}
          >
            {sending ? '发送中…' : `邀请${selected.length > 0 ? ` ${selected.length} 位` : ''}好友`}
          </button>
        </footer>
      </div>
    </div>
  );
}
