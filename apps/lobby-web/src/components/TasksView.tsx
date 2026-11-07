import { useCallback, useEffect, useState } from 'react';
import { api, type TaskView } from '../api';
import { audio } from '../audio';
import { Chip } from './Chip';
import { IconBack, IconGift, IconSparkle } from './Icons';

interface Props {
  onBalanceChange: (balance: number) => void;
  onBack: () => void;
}

export function TasksView({ onBalanceChange, onBack }: Props) {
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.tasks();
      setTasks(data.tasks);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载任务失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const claim = async (key: string): Promise<void> => {
    audio.play('click');
    setClaiming(key);
    try {
      const data = await api.claimTask(key);
      setTasks(data.tasks);
      audio.play('coin');
      onBalanceChange(data.balance);
    } catch (err) {
      setError(err instanceof Error ? err.message : '领取失败');
    } finally {
      setClaiming(null);
    }
  };

  return (
    <div className="full-screen-view tasks-view">
      {/* 顶部统一返回条 */}
      <header className="view-topbar">
        <button type="button" className="view-back-btn" onClick={onBack}>
          <IconBack size={18} />
          <span>返回大厅</span>
        </button>
        <div className="view-title">
          <IconGift size={22} />
          <h2>悬赏福利中心</h2>
          <span className="view-sub">每日 0 点重置任务 · 筹码自动幂等入账</span>
        </div>
        <div className="view-topbar__placeholder" />
      </header>

      {/* 主体横向分栏 */}
      <main className="view-main tasks-layout">
        <aside className="tasks-hero-card">
          <div className="hero-gift-icon">
            <IconGift size={48} />
          </div>
          <h3>每日专属福利</h3>
          <p>完成对局或签到，即可解锁丰厚娱乐筹码。筹码见底时更有每日救济金保驾护航！</p>
          <div className="tasks-hero-badge">
            <IconSparkle size={14} />
            <span>公平记分 · 畅玩无忧</span>
          </div>
        </aside>

        <section className="tasks-content-panel">
          {error && <div className="luxury-alert is-error">{error}</div>}
          {loading && <div className="view-loading">正在同步任务凭据…</div>}

          <div className="task-cards-grid">
            {tasks.map((task) => {
              const ready = task.claimable && !task.claimed;
              return (
                <div
                  key={task.key}
                  className={`task-row-card ${task.claimed ? 'is-claimed' : ready ? 'is-ready' : 'is-ongoing'}`}
                >
                  <div className="task-row__left">
                    <div className="task-row__icon-box">
                      <IconGift size={20} />
                    </div>
                    <div className="task-row__info">
                      <h4>{task.name}</h4>
                      <p>{task.description}</p>
                      <div className="task-row__progress">
                        <div className="progress-track">
                          <div
                            className="progress-fill"
                            style={{
                              width: `${Math.min(100, (task.progress / Math.max(1, task.target)) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="progress-num">
                          {task.progress}/{task.target}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="task-row__right">
                    <div className="task-reward-pill">
                      <Chip size={18} />
                      <strong>+{task.reward.toLocaleString()}</strong>
                    </div>

                    <button
                      type="button"
                      className={`btn-claim ${task.claimed ? 'is-done' : ready ? 'is-active' : 'is-locked'}`}
                      disabled={!ready || claiming === task.key}
                      onClick={() => claim(task.key)}
                    >
                      {task.claimed ? '已领取' : ready ? (claiming === task.key ? '领取中…' : '立即领取') : '进行中'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
