import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type Captcha, type User } from '../api';
import { audio } from '../audio';
import { IconBack, IconCrown, IconSparkle } from './Icons';

type Tab = 'login' | 'register';

interface Props {
  onSuccess: (token: string, user: User) => void;
  onBack: () => void;
}

export function AuthView({ onSuccess, onBack }: Props) {
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
    audio.play('click');
    setLoading(true);
    setError(null);
    try {
      const result =
        tab === 'login'
          ? await api.login(username.trim(), password, captcha.id, code)
          : await api.register(username.trim(), password, nickname.trim(), captcha.id, code);
      audio.play('coin');
      onSuccess(result.token, result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
      void refreshCaptcha();
    } finally {
      setLoading(false);
    }
  };

  const switchTab = (next: Tab): void => {
    audio.play('click');
    setTab(next);
    setError(null);
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
          </div>

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
          </form>
        </section>
      </main>
    </div>
  );
}
