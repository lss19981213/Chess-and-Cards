import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, fantasyClawOAuthStartUrl, type Captcha, type User } from '../api';

type Tab = 'login' | 'register' | 'forgot';

interface Props {
  onSuccess: (token: string, user: User) => void;
  onClose: () => void;
}

export function AuthModal({ onSuccess, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('login');
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

  // 找回密码
  const [resetAccount, setResetAccount] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [sendCodeLoading, setSendCodeLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);

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
      setError('请输入账号或邮箱');
      return;
    }
    if (!captcha || !code) {
      setError('请输入图形验证码');
      return;
    }
    setSendCodeLoading(true);
    setError(null);
    try {
      const res = await api.sendResetCode(resetAccount.trim(), captcha.id, code);
      setCodeSent(true);
      setSuccessMsg(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
      void refreshCaptcha();
    } finally {
      setSendCodeLoading(false);
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!emailCode.trim() || !newPassword) {
      setError('请输入邮箱验证码和新密码');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.resetPassword(resetAccount.trim(), emailCode.trim(), newPassword);
      setSuccessMsg(res.message);
      setTimeout(() => {
        switchTab('login');
        setUsername(resetAccount);
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置失败');
    } finally {
      setLoading(false);
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
      onSuccess(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
      void refreshCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const switchTab = (next: Tab): void => {
    setTab(next);
    setError(null);
    setSuccessMsg(null);
  };

  return (
    <div className="modal-mask" onClick={onClose} role="presentation">
      <form className="modal auth-modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="auth-tabs">
          <button
            type="button"
            className={tab === 'login' ? 'is-active' : ''}
            onClick={() => switchTab('login')}
          >
            登录
          </button>
          <button
            type="button"
            className={tab === 'register' ? 'is-active' : ''}
            onClick={() => switchTab('register')}
          >
            注册
          </button>
          <button
            type="button"
            className={tab === 'forgot' ? 'is-active' : ''}
            onClick={() => switchTab('forgot')}
          >
            找回密码
          </button>
        </div>

        {successMsg && <p className="form-success" style={{ color: '#10b981', textAlign: 'center' }}>{successMsg}</p>}

        {tab === 'forgot' ? (
          <>
            <label htmlFor="auth-reset-account">账号或绑定邮箱</label>
            <input
              id="auth-reset-account"
              value={resetAccount}
              placeholder="请输入账号或绑定的邮箱"
              onChange={(e) => setResetAccount(e.target.value)}
            />

            <label htmlFor="auth-captcha">图形验证码</label>
            <div className="captcha-row">
              <input
                id="auth-captcha"
                value={code}
                maxLength={4}
                autoComplete="off"
                placeholder="输入图中字符"
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                type="button"
                className="captcha-img"
                title="点击刷新"
                onClick={() => void refreshCaptcha()}
                dangerouslySetInnerHTML={{ __html: captcha?.svg ?? '' }}
              />
            </div>

            <button
              type="button"
              className="secondary"
              style={{ margin: '8px 0' }}
              disabled={sendCodeLoading || !resetAccount.trim()}
              onClick={handleSendResetCode}
            >
              {sendCodeLoading ? '发送中…' : codeSent ? '重新发送邮箱验证码' : '📧 发送邮箱验证码'}
            </button>

            <label htmlFor="auth-email-code">邮箱 6 位验证码</label>
            <input
              id="auth-email-code"
              value={emailCode}
              maxLength={6}
              placeholder="请输入邮箱收到的验证码"
              onChange={(e) => setEmailCode(e.target.value)}
            />

            <label htmlFor="auth-new-password">重置新密码</label>
            <input
              id="auth-new-password"
              type="password"
              value={newPassword}
              placeholder="6-32 位新密码"
              onChange={(e) => setNewPassword(e.target.value)}
            />

            {error && <p className="form-error">{error}</p>}

            <button type="submit" className="primary" disabled={loading}>
              {loading ? '重置中…' : '确认重置密码并登录'}
            </button>
          </>
        ) : (
          <>
            <label htmlFor="auth-username">账号</label>
            <input
              id="auth-username"
              value={username}
              autoComplete="username"
              placeholder="4-20 位字母、数字或下划线"
              onChange={(e) => setUsername(e.target.value)}
            />

            <label htmlFor="auth-password">密码</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              placeholder="6-32 位"
              onChange={(e) => setPassword(e.target.value)}
            />

            {tab === 'register' && (
              <>
                <label htmlFor="auth-email">安全邮箱（必填 · 一邮一号）</label>
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  autoComplete="email"
                  required
                  placeholder="name@example.com（每个邮箱仅限注册一个账号）"
                  onChange={(e) => setEmail(e.target.value)}
                />

                <label htmlFor="auth-nickname">昵称（可选）</label>
                <input
                  id="auth-nickname"
                  value={nickname}
                  maxLength={12}
                  placeholder="大厅中显示的名字，默认同账号"
                  onChange={(e) => setNickname(e.target.value)}
                />

                <label htmlFor="auth-invite">专属邀请码（选填）</label>
                <input
                  id="auth-invite"
                  value={inviteCode}
                  placeholder="好友的账号或UID，双方各得 1000 筹码"
                  onChange={(e) => setInviteCode(e.target.value)}
                />
              </>
            )}

            <label htmlFor="auth-captcha">验证码</label>
            <div className="captcha-row">
              <input
                id="auth-captcha"
                value={code}
                maxLength={4}
                autoComplete="off"
                placeholder="输入图中字符"
                onChange={(e) => setCode(e.target.value)}
              />
              <button
                type="button"
                className="captcha-img"
                title="点击刷新"
                onClick={() => void refreshCaptcha()}
                dangerouslySetInnerHTML={{ __html: captcha?.svg ?? '' }}
              />
            </div>

            {error && <p className="form-error">{error}</p>}

            <button type="submit" className="primary" disabled={loading}>
              {loading ? '处理中…' : tab === 'login' ? '登录' : '注册并进入'}
            </button>

            <button
              type="button"
              className="btn-oauth-fantasyclaw"
              style={{ marginTop: 10 }}
              onClick={() => {
                window.location.href = fantasyClawOAuthStartUrl();
              }}
            >
              <span className="oauth-fc-icon">🌌</span>
              <span>使用奇幻维度账号一键登录</span>
            </button>

            {tab === 'login' && (
              <div style={{ textAlign: 'right', marginTop: 8 }}>
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={() => switchTab('forgot')}
                >
                  忘记密码？通过邮箱找回
                </button>
              </div>
            )}
          </>
        )}

        <p className="auth__hint">
          注册即赠送 1000 虚拟筹码，仅用于记分，不可提现或转让。
        </p>
      </form>
    </div>
  );
}
