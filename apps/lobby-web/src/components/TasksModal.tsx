import { useCallback, useEffect, useState } from 'react';
import { api, type TaskView } from '../api';

interface Props {
  onBalanceChange: (balance: number) => void;
  onClose: () => void;
}

export function TasksModal({ onBalanceChange, onClose }: Props) {
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
    setClaiming(key);
    try {
      const data = await api.claimTask(key);
      setTasks(data.tasks);
      onBalanceChange(data.balance);
    } catch (err) {
      setError(err instanceof Error ? err.message : '领取失败');
    } finally {
      setClaiming(null);
    }
  };

  return (
    <div className="modal-mask" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>任务中心</h2>
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
        </div>

        {error && <p className="form-error">{error}</p>}
        {loading && <p className="hint">加载中…</p>}

        <ul className="task-list">
          {tasks.map((task) => {
            const percent = Math.min(100, Math.round((task.progress / task.target) * 100));
            return (
              <li key={task.key} className={task.claimable ? 'is-ready' : ''}>
                <div className="task-list__main">
                  <div className="task-list__title">
                    <strong>{task.name}</strong>
                    <span className="task-list__reward">+{task.reward}</span>
                  </div>
                  <p>{task.description}</p>
                  <div className="progress">
                    <div className="progress__bar" style={{ width: `${percent}%` }} />
                    <span>
                      {task.progress}/{task.target}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className={task.claimable ? 'primary task-list__btn' : 'secondary task-list__btn'}
                  disabled={!task.claimable || claiming === task.key}
                  onClick={() => void claim(task.key)}
                >
                  {task.claimed ? '已领取' : task.locked ? '筹码充足' : task.claimable ? '领取' : '未完成'}
                </button>
              </li>
            );
          })}
        </ul>

        <p className="auth__hint">每日任务在北京时间 0 点重置。筹码不足时记得领救济金。</p>
      </div>
    </div>
  );
}
