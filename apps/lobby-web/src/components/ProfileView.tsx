import type { User } from '../api';
import { Chip } from './Chip';
import { IconBack, IconCrown, IconGift, IconSparkle, IconUser } from './Icons';

interface Props {
  user: User;
  onLogout: () => void;
  onGoTasks: () => void;
  onBack: () => void;
}

export function ProfileView({ user, onLogout, onGoTasks, onBack }: Props) {
  return (
    <div className="full-screen-view profile-view">
      <header className="view-topbar">
        <button type="button" className="view-back-btn" onClick={onBack}>
          <IconBack size={18} />
          <span>返回大厅</span>
        </button>
        <div className="view-title">
          <IconUser size={22} />
          <h2>贵宾资产档案</h2>
          <span className="view-sub">账户流水透明 · 身份勋章唯一绑定</span>
        </div>
        <div className="view-topbar__placeholder" />
      </header>

      <main className="view-main profile-layout">
        {/* 左侧尊贵卡片 */}
        <aside className="profile-badge-card">
          <div className="vip-crown-badge">
            <IconCrown size={32} />
          </div>
          <div className="profile-large-avatar">
            <span>{user.nickname.slice(0, 1)}</span>
          </div>
          <h3>{user.nickname}</h3>
          <span className="profile-uid-pill">UID: {user.id}</span>

          <div className="profile-status-tags">
            <span className="tag-gold-vip">VIP 殿堂会员</span>
            <span className="tag-certified">权威实名认证</span>
          </div>
        </aside>

        {/* 右侧资产详情与操作 */}
        <section className="profile-detail-panel">
          <div className="asset-hero-box">
            <div className="asset-hero-label">
              <span>当前持有娱乐筹码</span>
              <IconSparkle size={14} />
            </div>
            <div className="asset-hero-val">
              <Chip size={32} />
              <strong>{user.balance.toLocaleString()}</strong>
            </div>
            <p className="asset-footnote">虚拟筹码不可提现、不可转让，仅用于记分娱乐与排行榜积分</p>
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
