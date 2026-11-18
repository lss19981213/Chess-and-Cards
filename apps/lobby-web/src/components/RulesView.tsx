import { useMemo, useState } from 'react';
import { GAME_RULES_LIST, GAME_RULES_MAP } from '../game-rules';
import { IconBack, IconRules, IconSparkle } from './Icons';

interface Props {
  initialGameId?: string;
  onBack: () => void;
}

export function RulesView({ initialGameId = 'tuizhuanzi', onBack }: Props) {
  const [selectedGame, setSelectedGame] = useState(
    GAME_RULES_MAP[initialGameId] ? initialGameId : 'tuizhuanzi',
  );
  const current = GAME_RULES_MAP[selectedGame] ?? GAME_RULES_LIST[0]!;

  const groupedRules = useMemo(() => {
    const groups: Array<{ category: string; items: typeof GAME_RULES_LIST[number][] }> = [];
    for (const item of GAME_RULES_LIST) {
      let group = groups.find((g) => g.category === item.categoryLabel);
      if (!group) {
        group = { category: item.categoryLabel, items: [] };
        groups.push(group);
      }
      group.items.push(item);
    }
    return groups;
  }, []);

  return (
    <div className="full-screen-view rules-view">
      <header className="view-topbar">
        <button type="button" className="view-back-btn" onClick={onBack}>
          <IconBack size={18} />
          <span>返回大厅</span>
        </button>
        <div className="view-title">
          <IconRules size={22} />
          <h2>棋牌玩法大全</h2>
          <span className="view-sub">全平台 18 款游戏官方权威规则解析 · 公平透明竞技</span>
        </div>
        <div className="view-topbar__placeholder" />
      </header>

      <main className="view-main rules-layout">
        {/* 左侧按分类分组的完整游戏导航（支持滚动） */}
        <aside className="rules-nav-panel">
          <div className="rules-nav-title">全部玩法 ({GAME_RULES_LIST.length})</div>
          <div className="rules-nav-list">
            {groupedRules.map((group) => (
              <div key={group.category} className="rules-nav-group">
                <div className="rules-nav-group-label">{group.category}</div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`rules-nav-item ${selectedGame === item.id ? 'is-active' : ''}`}
                    onClick={() => setSelectedGame(item.id)}
                  >
                    <span className="rules-nav-item-name">
                      <em className="rules-nav-item-icon">{item.icon}</em>
                      {item.name}
                    </span>
                    {selectedGame === item.id && <IconSparkle size={12} />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </aside>

        {/* 右侧规则正文卷轴 */}
        <section className="rules-doc-panel">
          <div className="doc-header">
            <div className="doc-header-title-row">
              <span className="doc-category-pill">{current.categoryLabel}</span>
              <h3>
                {current.icon} {current.name}
              </h3>
            </div>
            <p className="doc-intro">{current.intro}</p>
          </div>

          <div className="doc-sections">
            {current.sections.map((sec, idx) => (
              <div key={idx} className="doc-section-card">
                <h4>{sec.title}</h4>
                <ul>
                  {sec.lines.map((line, lIdx) => (
                    <li key={lIdx}>{line}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
