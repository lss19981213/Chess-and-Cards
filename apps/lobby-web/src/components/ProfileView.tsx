import { useCallback, useEffect, useRef, useState } from 'react';
import { api, resolveAvatarUrl, type User } from '../api';
import { audio } from '../audio';
import { Chip } from './Chip';
import { IconBack, IconCrown, IconGift, IconSparkle, IconUser } from './Icons';

interface Props {
  user: User;
  onLogout: () => void;
  onGoTasks: () => void;
  onBack: () => void;
  onGoFriends?: () => void;
  /** 资料更新后同步到应用壳，顶栏昵称/头像即时刷新 */
  onProfileChange?: (patch: { nickname?: string; avatar?: string | null }) => void;
}

/** 把用户选择的图片裁成方形并压缩，避免几十 MB 原图进数据库 */
async function fileToAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  if (file.size > 8 * 1024 * 1024) throw new Error('图片过大，请选择 8MB 以内的图片');

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片格式不支持'));
    img.src = dataUrl;
  });

  const size = 192;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持图片处理');
  const side = Math.min(image.width, image.height);
  ctx.drawImage(
    image,
    (image.width - side) / 2,
    (image.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  return canvas.toDataURL('image/jpeg', 0.86);
}

export function ProfileView({ user, onLogout, onGoTasks, onBack, onGoFriends, onProfileChange }: Props) {
  const [nickname, setNickname] = useState(user.nickname);
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [balance, setBalance] = useState(user.balance);
  const [rank, setRank] = useState<number | null>(null);
  const [friendsCount, setFriendsCount] = useState(0);
  const [achievements, setAchievements] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const notify = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    setHint({ text, tone });
    window.setTimeout(() => setHint(null), 2600);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.profile();
      setNickname(data.profile.nickname);
      setBio(data.profile.bio);
      setAvatar(data.profile.avatar);
      setBalance(data.balance);
      setRank(data.rank);
      setFriendsCount(data.friendsCount);
      setAchievements(data.achievements);
    } catch {
      /* 未登录或接口异常时保留壳层传入的基础信息 */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pickAvatar = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      audio.play('click');
      const compressed = await fileToAvatar(file);
      setAvatar(compressed);
      setEditing(true);
      notify('头像已就绪，记得点保存');
    } catch (error) {
      notify(error instanceof Error ? error.message : '图片处理失败', 'err');
    }
  };

  const save = async (): Promise<void> => {
    audio.play('click');
    setSaving(true);
    try {
      const res = await api.updateProfile({ nickname: nickname.trim(), bio, avatar });
      audio.play('coin');
      setNickname(res.profile.nickname);
      setBio(res.profile.bio);
      setAvatar(res.profile.avatar);
      setEditing(false);
      onProfileChange?.({ nickname: res.profile.nickname, avatar: res.profile.avatar });
      notify('资料已保存');
    } catch (error) {
      notify(error instanceof Error ? error.message : '保存失败', 'err');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="full-screen-view profile-view">
      <header className="view-topbar">
        <button type="button" className="view-back-btn" onClick={onBack}>
          <IconBack size={18} />
          <span>返回大厅</span>
        </button>
        <div className="view-title">
          <IconUser size={22} />
          <h2>个人中心</h2>
          <span className="view-sub">头像、昵称与签名随时可改 · 战绩与称号自动统计</span>
        </div>
        <div className="view-topbar__placeholder" />
      </header>

      {hint && <div className={`friends-hint is-${hint.tone}`}>{hint.text}</div>}

      <main className="view-main profile-layout">
        {/* 左侧身份卡 */}
        <aside className="profile-badge-card">
          <div className="vip-crown-badge">
            <IconCrown size={32} />
          </div>

          <button
            type="button"
            className="profile-large-avatar is-editable"
            onClick={() => fileRef.current?.click()}
            title="点击更换头像"
            aria-label="更换头像"
          >
            {(() => {
              const avatarSrc = resolveAvatarUrl(avatar);
              return avatarSrc ? (
                <img src={avatarSrc} alt="我的头像" draggable={false} />
              ) : (
                <span>{nickname.slice(0, 1)}</span>
              );
            })()}
            <em className="avatar-edit-badge">更换</em>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(event) => {
              void pickAvatar(event.target.files?.[0]);
              event.target.value = '';
            }}
          />

          <h3>{nickname}</h3>
          <span className="profile-uid-pill">UID: {user.id.slice(0, 8)}</span>

          <div className="profile-status-tags">
            <span className="tag-gold-vip">{rank && rank <= 10 ? `财富榜第 ${rank} 名` : 'VIP 殿堂会员'}</span>
            <span className="tag-certified">{achievements} 项成就</span>
          </div>

          <div className="profile-stats-row">
            <div>
              <strong>{friendsCount}</strong>
              <small>好友</small>
            </div>
            <div>
              <strong>{rank ?? '—'}</strong>
              <small>排名</small>
            </div>
            <div>
              <strong>{achievements}</strong>
              <small>成就</small>
            </div>
          </div>
        </aside>

        {/* 右侧资料编辑与操作 */}
        <section className="profile-detail-panel">
          <div className="asset-hero-box">
            <div className="asset-hero-label">
              <span>当前持有娱乐筹码</span>
              <IconSparkle size={14} />
            </div>
            <div className="asset-hero-val">
              <Chip size={32} />
              <strong>{balance.toLocaleString()}</strong>
            </div>
            <p className="asset-footnote">虚拟筹码不可提现、不可转让，仅用于记分娱乐与排行榜积分</p>
          </div>

          <div className="profile-edit-card">
            <div className="profile-edit-card__head">
              <h4>个人资料</h4>
              {!editing ? (
                <button type="button" className="profile-edit-toggle" onClick={() => setEditing(true)}>
                  编辑资料
                </button>
              ) : (
                <div className="profile-edit-actions">
                  <button
                    type="button"
                    className="profile-edit-cancel"
                    onClick={() => {
                      setEditing(false);
                      void load();
                    }}
                  >
                    取消
                  </button>
                  <button type="button" className="profile-edit-save" disabled={saving} onClick={save}>
                    {saving ? '保存中…' : '保存'}
                  </button>
                </div>
              )}
            </div>

            <label className="profile-field">
              <span>昵称</span>
              <input
                type="text"
                value={nickname}
                maxLength={16}
                disabled={!editing}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="2-16 个字符"
                spellCheck={false}
              />
            </label>

            <label className="profile-field">
              <span>个性签名</span>
              <input
                type="text"
                value={bio}
                maxLength={60}
                disabled={!editing}
                onChange={(event) => setBio(event.target.value)}
                placeholder="一句话介绍自己，最多 60 字"
                spellCheck={false}
              />
            </label>

            <p className="profile-edit-tip">头像支持 JPG / PNG，上传后会自动裁切为方形并压缩。</p>
          </div>

          <div className="profile-action-grid">
            <div className="action-card" onClick={onGoTasks} role="button" tabIndex={0}>
              <div className="action-card__icon">
                <IconGift size={26} />
              </div>
              <div className="action-card__text">
                <strong>领取每日福利与救济金</strong>
                <p>筹码不足 100 时可领取 500 救济金，每日签到领奖励</p>
              </div>
              <span className="action-arrow">›</span>
            </div>

            {onGoFriends && (
              <div className="action-card" onClick={onGoFriends} role="button" tabIndex={0}>
                <div className="action-card__icon">
                  <IconUser size={26} />
                </div>
                <div className="action-card__text">
                  <strong>好友与邀请</strong>
                  <p>搜索玩家加好友，牌桌内可邀请好友入座</p>
                </div>
                <span className="action-arrow">›</span>
              </div>
            )}

            <div className="profile-logout-box">
              <button type="button" className="btn-logout-luxury" onClick={onLogout}>
                退出当前账号
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
