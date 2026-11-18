import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, fantasyClawOAuthStartUrl, type Captcha, type User } from '../api';
import { audio } from '../audio';
import { IconBack, IconCrown, IconSparkle } from './Icons';

type Tab = 'login' | 'register' | 'forgot';

interface Props {
  initialTab?: Tab;
  onSuccess: (token: string, user: User) => void;
  onBack: () => void;
}

export function AuthView({ initialTab = 'login', onSuccess, onBack }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [code, setCode] = useState('');
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  // 找回密码表单状态
  const [resetAccount, setResetAccount] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [sendCodeLoading, setSendCodeLoading] = useState(false);

  const refreshCaptcha = useCallback(async () => {
    try {
      const next = await api.captcha();
      setCaptcha(next);
      setCode('');
    } catch {
      setError('验证码加载失败，请重试');
    }
  }, []);

  useEffect(() => {
    void refreshCaptcha();
  }, [refreshCaptcha]);

  const handleSendResetCode = async () => {
    if (!resetAccount.trim()) {
      setError('请输入绑定的账号或邮箱');
      return;
    }
    if (!captcha || !code) {
      setError('请输入图形验证码');
      return;
    }
    setSendCodeLoading(true);
    setError(null);
    try {
      audio.play('click');
      const res = await api.sendResetCode(resetAccount.trim(), captcha.id, code);
      audio.play('shunzi');
      setCodeSent(true);
      setSuccessMsg(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送验证码失败');
      void refreshCaptcha();
    } finally {
      setSendCodeLoading(false);
    }
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (tab === 'forgot') {
      await handleResetPassword(event);
      return;
    }
    if (!captcha) {
      setError('验证码未加载');
      return;
    }
    audio.play('click');
    setLoading(true);
    setError(null);
    try {
      const result =
        tab === 'login'
          ? await api.login(username.trim(), password, captcha.id, code)
          : await api.register(
              username.trim(),
              password,
              nickname.trim(),
              captcha.id,
              code,
              email.trim(),
              inviteCode.trim() || undefined,
            );
      audio.play('coin');
      onSuccess(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
      void refreshCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!emailCode.trim() || !newPassword) {
      setError('请完整输入邮箱验证码和新密码');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      audio.play('click');
      const res = await api.resetPassword(resetAccount.trim(), emailCode.trim(), newPassword);
      audio.play('coin');
      setSuccessMsg(res.message);
      window.setTimeout(() => {
        switchTab('login');
        setUsername(resetAccount);
        setPassword('');
        setSuccessMsg('密码已成功重置，请使用新密码登入');
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置密码失败');
    } finally {
      setLoading(false);
    }
  };

  const switchTab = (next: Tab): void => {
    audio.play('click');
    setTab(next);
    setError(null);
    setSuccessMsg(null);
  };

  return (
    <div className="full-screen-view auth-view">
      <header className="view-topbar">
        <button type="button" className="view-back-btn" onClick={onBack}>
          <IconBack size={18} />
          <span>返回大厅</span>
        </button>
        <div className="view-title">
          <IconCrown size={22} />
          <h2>贵宾通行证</h2>
          <span className="view-sub">注册立享 10,000 体验筹码 · 账务安全权威加密</span>
        </div>
        <div className="view-topbar__placeholder" />
      </header>

      <main className="view-main auth-layout">
        {/* 左侧尊贵介绍 */}
        <aside className="auth-hero-card">
          <div className="auth-hero-logo">
            <IconCrown size={56} />
          </div>
          <h3>尊贵娱乐殿堂</h3>
          <p>
            一站式畅玩五子棋、斗地主、德州扑克、跑得快、推筒子等 13 款经典游戏。
            高防防爆破、可信幂等账本，保证每位玩家纯粹绿色的竞技体验。
          </p>
          <div className="auth-feature-list">
            <div className="feature-item">
              <IconSparkle size={14} /> 注册即送初始筹码
            </div>
            <div className="feature-item">
              <IconSparkle size={14} /> 每日签到与救济金保底
            </div>
            <div className="feature-item">
              <IconSparkle size={14} /> 全服排行榜角逐称号
            </div>
          </div>
        </aside>

        {/* 右侧表单区 */}
        <section className="auth-form-card">
          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab-btn ${tab === 'login' ? 'is-active' : ''}`}
              onClick={() => switchTab('login')}
            >
              贵宾登入
            </button>
            <button
              type="button"
              className={`auth-tab-btn ${tab === 'register' ? 'is-active' : ''}`}
              onClick={() => switchTab('register')}
            >
              新客入驻
            </button>
            <button
              type="button"
              className={`auth-tab-btn ${tab === 'forgot' ? 'is-active' : ''}`}
              onClick={() => switchTab('forgot')}
            >
              找回密码
            </button>
          </div>

          {successMsg && <div className="luxury-alert is-success">{successMsg}</div>}

          {tab === 'forgot' ? (
            <form onSubmit={submit} className="auth-form">
              <div className="form-group">
                <label>绑定邮箱或账号</label>
                <input
                  type="text"
                  value={resetAccount}
                  placeholder="请输入您的账号或绑定的邮箱地址"
                  required
                  onChange={(e) => setResetAccount(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>图形验证码</label>
                <div className="captcha-row">
                  <input
                    type="text"
                    value={code}
                    placeholder="输入图中文案"
                    required
                    onChange={(e) => setCode(e.target.value)}
                  />
                  <div
                    className="captcha-box"
                    onClick={() => void refreshCaptcha()}
                    role="button"
                    tabIndex={0}
                    title="点击更换验证码"
                    dangerouslySetInnerHTML={captcha ? { __html: captcha.svg } : undefined}
                  />
                </div>
              </div>

              <div className="form-group">
                <button
                  type="button"
                  className="luxury-btn btn-send-code"
                  disabled={sendCodeLoading || !resetAccount.trim()}
                  onClick={handleSendResetCode}
                >
                  {sendCodeLoading ? '正在发送…' : codeSent ? '重新发送邮箱验证码' : '📧 发送邮箱验证码'}
                </button>
              </div>

              <div className="form-group">
                <label>邮箱 6 位验证码</label>
                <input
                  type="text"
                  value={emailCode}
                  maxLength={6}
                  placeholder="请输入收到的 6 位数字验证码"
                  required
                  onChange={(e) => setEmailCode(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>重置新密码</label>
                <input
                  type="password"
                  value={newPassword}
                  placeholder="6-32位强密码"
                  required
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>

              {error && <div className="luxury-alert is-error">{error}</div>}

              <button type="submit" className="luxury-btn luxury-btn--gold btn-auth-submit" disabled={loading}>
                {loading ? '正在验证重置…' : '✦ 确认重置密码并登入 ✦'}
              </button>

              <div className="auth-sub-actions">
                <button type="button" className="link-sub" onClick={() => switchTab('login')}>
                  想起密码？返回登入
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={submit} className="auth-form">
              <div className="form-group">
                <label>通行证账号</label>
                <input
                  type="text"
                  value={username}
                  placeholder="4-20位字母或数字"
                  autoComplete="username"
                  required
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>

              {tab === 'register' && (
                <>
                  <div className="form-group">
                    <label>安全邮箱 (必填 · 一邮一号)</label>
                    <input
                      type="email"
                      value={email}
                      placeholder="name@example.com（每个邮箱仅限创建一个账号，用于找回密码）"
                      autoComplete="email"
                      required
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>牌桌尊称 (昵称)</label>
                    <input
                      type="text"
                      value={nickname}
                      placeholder="2-12位汉字或字母"
                      required
                      onChange={(e) => setNickname(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>专属邀请码 (选填)</label>
                    <input
                      type="text"
                      value={inviteCode}
                      placeholder="好友的账号或UID，双方各得 1000 筹码"
                      onChange={(e) => setInviteCode(e.target.value)}
                    />
                  </div>
                </>
              )}

              <div className="form-group">
                <label>登入密码</label>
                <input
                  type="password"
                  value={password}
                  placeholder="6-32位强密码"
                  autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
                  required
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>图形验证码</label>
                <div className="captcha-row">
                  <input
                    type="text"
                    value={code}
                    placeholder="输入图中文案"
                    required
                    onChange={(e) => setCode(e.target.value)}
                  />
                  <div
                    className="captcha-box"
                    onClick={() => void refreshCaptcha()}
                    role="button"
                    tabIndex={0}
                    title="点击更换验证码"
                    dangerouslySetInnerHTML={captcha ? { __html: captcha.svg } : undefined}
                  />
                </div>
              </div>

              {error && <div className="luxury-alert is-error">{error}</div>}

              <button type="submit" className="luxury-btn luxury-btn--gold btn-auth-submit" disabled={loading}>
                {loading ? '正在验证入驻…' : tab === 'login' ? '✦ 立即登入殿堂 ✦' : '✦ 完成入驻并领筹码 ✦'}
              </button>

              <div className="auth-oauth-divider">
                <span>或使用奇幻维度主站账号登录</span>
              </div>

              <button
                type="button"
                className="btn-oauth-fantasyclaw"
                onClick={() => {
                  audio.play('click');
                  window.location.href = fantasyClawOAuthStartUrl();
                }}
              >
                <span className="oauth-fc-icon">🌌</span>
                <span>奇幻维度 (fantasyclaw.top) 一键授权登录</span>
              </button>

              {tab === 'login' && (
                <div className="auth-sub-actions">
                  <button type="button" className="link-sub" onClick={() => switchTab('forgot')}>
                    忘记密码？通过邮箱找回
                  </button>
                  <button type="button" className="link-sub" onClick={() => switchTab('register')}>
                    还没有账号？立即注册
                  </button>
                </div>
              )}
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
