import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type Captcha, type User } from '../api';

type Tab = 'login' | 'register';

interface Props {
  onSuccess: (token: string, user: User) => void;
  onClose: () => void;
}

export function AuthModal({ onSuccess, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [code, setCode] = useState('');
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
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
          : await api.register(username.trim(), password, nickname.trim(), captcha.id, code);
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
        </div>

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
            <label htmlFor="auth-nickname">昵称（可选）</label>
            <input
              id="auth-nickname"
              value={nickname}
              maxLength={12}
              placeholder="大厅中显示的名字，默认同账号"
              onChange={(e) => setNickname(e.target.value)}
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

        <p className="auth__hint">
          注册即赠送 1000 虚拟筹码，仅用于记分，不可提现或转让。
        </p>
      </form>
    </div>
  );
}
