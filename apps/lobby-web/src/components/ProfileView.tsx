import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computeLevelInfo,
  formatBigXp,
  levelTitleFor,
  levelUpRewardFor,
  MAX_PLAYER_LEVEL,
  xpRequiredForLevel,
} from '@cc/protocol';
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
  /** 余额或等级更新后同步到应用壳 */
  onUserUpdate?: (patch: Partial<User>) => void;
}

/** 把用户选择的图片裁成方形并自适应压缩，保证清晰且永不超体积上限 */
async function fileToAvatar(file: File): Promise<string> {
  if (file.type && !file.type.startsWith('image/')) throw new Error('请选择图片文件');
  if (file.size > 12 * 1024 * 1024) throw new Error('图片过大，请选择 12MB 以内的图片');

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片格式不支持，请换一张 JPG / PNG / WebP'));
    img.src = dataUrl;
  });

  const drawAt = (size: number, quality: number): string => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器不支持图片处理');
    // 填充深色底色，防止透明 PNG 转 JPEG 后出现纯黑锯齿
    ctx.fillStyle = '#182032';
    ctx.fillRect(0, 0, size, size);
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
    return canvas.toDataURL('image/jpeg', quality);
  };

  // 自适应质量压缩，确保 base64 体积稳定控制在 180KB 内
  const maxBase64Chars = 240_000;
  for (const [size, quality] of [
    [192, 0.85],
    [192, 0.72],
    [192, 0.58],
    [160, 0.65],
    [128, 0.55],
  ] as const) {
    const out = drawAt(size, quality);
    if (out.length <= maxBase64Chars) return out;
  }
  return drawAt(128, 0.45);
}

export function ProfileView({
  user,
  onLogout,
  onGoTasks,
  onBack,
  onGoFriends,
  onProfileChange,
  onUserUpdate,
}: Props) {
  const [nickname, setNickname] = useState(user.nickname);
  const [bio, setBio] = useState('');
  const [email, setEmail] = useState(user.email ?? '');
  const [avatar, setAvatar] = useState<string | null>(user.avatar ?? null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [balance, setBalance] = useState(user.balance);
  const [level, setLevel] = useState(user.level ?? 1);
  const [xp, setXp] = useState(user.xp ?? '0');
  const [rewardedLevel, setRewardedLevel] = useState(user.rewardedLevel ?? 1);
  const [totalTurnover, setTotalTurnover] = useState(user.totalTurnover ?? '0');
  const [claimingLevel, setClaimingLevel] = useState(false);
  const [rank, setRank] = useState<number | null>(null);
  const [friendsCount, setFriendsCount] = useState(0);
  const [achievements, setAchievements] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 密码修改模块状态
  const [showPwdForm, setShowPwdForm] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);

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
      setAvatarBroken(false);
      setBalance(data.balance);
      setLevel(data.profile.level ?? 1);
      setXp(data.profile.xp ?? '0');
      setRewardedLevel(data.profile.rewardedLevel ?? 1);
      setTotalTurnover(data.profile.totalTurnover ?? '0');
      setRank(data.rank);
      setFriendsCount(data.friendsCount);
      setAchievements(data.achievements);
    } catch {
      /* 未登录或接口异常时保留壳层传入的基础信息 */
    }
  }, []);

  const levelInfo = useMemo(
    () => computeLevelInfo(level, xp, rewardedLevel),
    [level, xp, rewardedLevel],
  );

  const upcomingMilestones = useMemo(() => {
    const start = Math.max(2, Math.min(MAX_PLAYER_LEVEL - 3, rewardedLevel + 1));
    const list: Array<{ lv: number; reward: number; reqXp: string; status: 'claimed' | 'claimable' | 'locked' }> = [];
    for (let lv = start; lv <= Math.min(MAX_PLAYER_LEVEL, start + 3); lv += 1) {
      const status = lv <= rewardedLevel ? 'claimed' : lv <= level ? 'claimable' : 'locked';
      list.push({
        lv,
        reward: levelUpRewardFor(lv),
        reqXp: formatBigXp(xpRequiredForLevel(lv - 1)),
        status,
      });
    }
    return list;
  }, [level, rewardedLevel]);

  const handleClaimLevelReward = async () => {
    if (claimingLevel || levelInfo.claimableReward <= 0) return;
    setClaimingLevel(true);
    try {
      audio.play('click');
      const res = await api.claimLevelReward();
      audio.play('jackpot');
      audio.play('coin_stream');
      setBalance(res.balance);
      setLevel(res.level);
      setRewardedLevel(res.rewardedLevel);
      onUserUpdate?.({
        balance: res.balance,
        level: res.level,
        rewardedLevel: res.rewardedLevel,
      });
      notify(`🎉 成功领取 ${res.claimedLevels} 级升级奖励 +${res.reward.toLocaleString()} 筹码！`);
    } catch (err) {
      audio.play('alert');
      notify(err instanceof Error ? err.message : '领取升级奖励失败', 'err');
    } finally {
      setClaimingLevel(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  const pickAvatar = async (file: File | undefined): Promise<void> => {
    if (!file || avatarUploading) return;
    const prevAvatar = avatar;
    setAvatarUploading(true);
    try {
      audio.play('click');
      const compressed = await fileToAvatar(file);
      // 先本地预览，同时直接调用专用上传接口即时落库，无需再点保存
      setAvatar(compressed);
      setAvatarBroken(false);
      const res = await api.uploadAvatar(compressed);
      const savedUrl = res.profile.avatar ?? compressed;
      setAvatar(savedUrl);
      setAvatarBroken(false);
      onProfileChange?.({ avatar: savedUrl });
      onUserUpdate?.({ avatar: savedUrl });
      audio.play('coin');
      notify('✅ 头像已成功更换并保存！');
    } catch (error) {
      setAvatar(prevAvatar);
      audio.play('alert');
      notify(error instanceof Error ? error.message : '头像上传失败，请重试', 'err');
    } finally {
      setAvatarUploading(false);
    }
  };

  const save = async (): Promise<void> => {
    audio.play('click');
    setSaving(true);
    try {
      const res = await api.updateProfile({ nickname: nickname.trim(), bio });
      if (email.trim() && email.trim() !== (user.email ?? '')) {
        await api.updateEmail(email.trim());
        onUserUpdate?.({ email: email.trim() });
      }
      audio.play('coin');
      setNickname(res.profile.nickname);
      setBio(res.profile.bio);
      if (res.profile.avatar !== undefined) setAvatar(res.profile.avatar);
      setEditing(false);
      onProfileChange?.({ nickname: res.profile.nickname, avatar: res.profile.avatar });
      notify('个人资料与绑定邮箱已保存');
    } catch (error) {
      notify(error instanceof Error ? error.message : '保存失败', 'err');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      setPwdError('新密码不能少于 6 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdError('两次输入的新密码不一致');
      return;
    }
    setPwdLoading(true);
    setPwdError(null);
    try {
      audio.play('click');
      await api.changePassword(oldPassword, newPassword);
      audio.play('shunzi');
      notify('登录密码已成功修改！请妥善保管新密码');
      setShowPwdForm(false);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      audio.play('alert');
      setPwdError(err instanceof Error ? err.message : '修改密码失败');
    } finally {
      setPwdLoading(false);
    }
  };

  const handleCopyInvite = () => {
    const inviteCode = user.username || user.id;
    const shareText = `快来和我一起玩！注册填写我的专属邀请码【${inviteCode}】，各得 1000 豪华筹码！游戏直达：${window.location.origin}`;
    navigator.clipboard?.writeText(shareText);
    audio.play('coin');
    notify(`邀请码【${inviteCode}】已复制！每邀请1位好友注册入场可领 1,000 筹码（上不封顶）`);
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
            onClick={() => !avatarUploading && fileRef.current?.click()}
            disabled={avatarUploading}
            title="点击立即更换头像"
            aria-label="更换头像"
          >
            {(() => {
              const avatarSrc = resolveAvatarUrl(avatar);
              return avatarSrc && !avatarBroken ? (
                <img
                  src={avatarSrc}
                  alt="我的头像"
                  draggable={false}
                  onError={() => setAvatarBroken(true)}
                />
              ) : (
                <span>{nickname.slice(0, 1)}</span>
              );
            })()}
            <em className="avatar-edit-badge">{avatarUploading ? '上传中' : '更换'}</em>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="profile-file-input-hidden"
            onChange={(event) => {
              void pickAvatar(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className="btn-change-avatar-pill"
            disabled={avatarUploading}
            onClick={() => fileRef.current?.click()}
          >
            {avatarUploading ? '⏳ 正在上传头像…' : '📷 更换头像'}
          </button>

          <h3>{nickname}</h3>
          <span className="profile-uid-pill">UID: {user.id.slice(0, 8)}</span>

          <div className="profile-status-tags">
            <span className="tag-level-gold">Lv.{levelInfo.level} {levelTitleFor(levelInfo.level)}</span>
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

          {/* 账号等级与流水经验进度卡 */}
          <div className="profile-level-card">
            <div className="profile-level-card__top">
              <div className="level-identity">
                <span className="level-badge-big">Lv.{levelInfo.level}</span>
                <div className="level-identity__meta">
                  <strong>{levelTitleFor(levelInfo.level)}</strong>
                  <span>上限 Lv.{MAX_PLAYER_LEVEL} · 累计有效流水 {formatBigXp(totalTurnover)}</span>
                </div>
              </div>
              {levelInfo.claimableReward > 0 ? (
                <button
                  type="button"
                  className="btn-claim-level-reward"
                  disabled={claimingLevel}
                  onClick={() => void handleClaimLevelReward()}
                >
                  {claimingLevel
                    ? '领取中…'
                    : `🎁 领取升级奖励 +${levelInfo.claimableReward.toLocaleString()} 筹码`}
                </button>
              ) : (
                <span className="level-claimed-status">
                  {levelInfo.isMax
                    ? '🏆 已达百级满级'
                    : `下级奖励 +${levelInfo.nextReward.toLocaleString()} 筹码`}
                </span>
              )}
            </div>

            <div className="level-xp-bar-wrap">
              <div className="level-xp-bar-labels">
                <span>
                  当前经验：<b>{levelInfo.xpFormatted}</b> / {levelInfo.requiredXpFormatted}
                </span>
                <span>{levelInfo.isMax ? '100% MAX' : `${levelInfo.percent}%`}</span>
              </div>
              <div className="level-xp-track">
                <div className="level-xp-fill" style={{ width: `${levelInfo.percent}%` }} />
              </div>
              <p className="level-xp-rule-hint">
                💡 对局有效流水 1:1 转化为经验；初始 100 经验升级，每级经验翻 2 倍（100 → 200 → 400 → 800…），升级可领 1,000 / 2,000 / 3,000… 递增筹码！
              </p>
            </div>

            <div className="level-milestones-row">
              {upcomingMilestones.map((m) => (
                <div key={m.lv} className={`level-milestone-chip is-${m.status}`}>
                  <span className="milestone-lv">Lv.{m.lv}</span>
                  <strong className="milestone-reward">+{m.reward.toLocaleString()} 豆</strong>
                  <small className="milestone-xp">需 {m.reqXp} 经验</small>
                </div>
              ))}
            </div>
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

            <label className="profile-field">
              <span>密保邮箱</span>
              <input
                type="email"
                value={email}
                disabled={!editing}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="填写邮箱用于密码找回与安全验证"
                spellCheck={false}
              />
            </label>

            <p className="profile-edit-tip">头像支持 JPG / PNG，上传后会自动裁切为方形并压缩；绑定密保邮箱后支持密码找回。</p>
          </div>

          {/* 账号安全与密码修改 */}
          <div className="profile-edit-card profile-security-card">
            <div className="profile-edit-card__head">
              <h4>账号安全</h4>
              <button
                type="button"
                className="profile-edit-toggle"
                onClick={() => {
                  setShowPwdForm(!showPwdForm);
                  setPwdError(null);
                }}
              >
                {showPwdForm ? '收起密码修改' : '修改登录密码'}
              </button>
            </div>

            {showPwdForm ? (
              <form className="profile-pwd-form" onSubmit={handleChangePassword}>
                <label className="profile-field">
                  <span>原密码</span>
                  <input
                    type="password"
                    value={oldPassword}
                    placeholder="请输入当前登录密码"
                    onChange={(e) => setOldPassword(e.target.value)}
                    required
                  />
                </label>
                <label className="profile-field">
                  <span>新密码</span>
                  <input
                    type="password"
                    value={newPassword}
                    placeholder="6-32 位新密码"
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                </label>
                <label className="profile-field">
                  <span>确认新密码</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    placeholder="请再次输入新密码"
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </label>

                {pwdError && <p className="form-error">{pwdError}</p>}

                <div className="profile-pwd-actions">
                  <button type="button" className="profile-edit-cancel" onClick={() => setShowPwdForm(false)}>
                    取消
                  </button>
                  <button type="submit" className="profile-edit-save" disabled={pwdLoading}>
                    {pwdLoading ? '修改中…' : '确认修改密码'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="profile-security-row">
                <span>绑定邮箱：<b>{user.email || '未绑定（请在上方编辑资料绑定邮箱以便找回密码）'}</b></span>
                <span className="profile-pwd-hint">定期更换密码有助于保护虚拟筹码安全</span>
              </div>
            )}
          </div>

          {/* 专属邀请好友奖励（无上限） */}
          <div className="profile-edit-card profile-invite-card">
            <div className="profile-invite-card__head">
              <div className="invite-title-col">
                <h4>🎁 专属邀请新玩家（每位奖励 1,000 筹码 · 上不封顶）</h4>
                <p>好友在注册时填写您的专属邀请码，即可各获 1,000 筹码！在每日任务中随时无上限领取！</p>
              </div>
              <button type="button" className="btn-copy-invite-code" onClick={handleCopyInvite}>
                一键复制邀请码
              </button>
            </div>
            <div className="invite-code-display-box">
              <span>您的专属邀请码:</span>
              <strong className="invite-code-pill">{user.username || user.id}</strong>
            </div>
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
