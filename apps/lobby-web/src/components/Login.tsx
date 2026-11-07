import { useState, type FormEvent } from 'react';

interface Props {
  onLogin: (nickname: string) => Promise<void>;
}

export function Login({ onLogin }: Props) {
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const value = nickname.trim();
    if (value.length < 2) {
      setError('昵称至少 2 个字符');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onLogin(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth">
      <form className="auth__card" onSubmit={submit}>
        <div className="brand">
          <span className="brand__mark">♠</span>
          <div>
            <h1>棋牌娱乐大厅</h1>
            <p>休闲竞技 · 虚拟积分 · 无现金往来</p>
          </div>
        </div>

        <label htmlFor="nickname">昵称</label>
        <input
          id="nickname"
          value={nickname}
          maxLength={16}
          autoComplete="off"
          placeholder="输入 2-16 个字符"
          onChange={(event) => setNickname(event.target.value)}
        />
        {error && <p className="form-error">{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? '登录中…' : '进入大厅'}
        </button>

        <p className="auth__hint">
          首次登录自动创建账号并赠送 1000 虚拟积分。积分仅用于记分，不可提现或转让。
        </p>
      </form>
    </div>
  );
}
