import { GAME_RULES_MAP } from '../game-rules';

interface Props {
  gameId: string;
  onClose: () => void;
}

export function RulesModal({ gameId, onClose }: Props) {
  const rules = GAME_RULES_MAP[gameId];
  return (
    <div className="modal-mask" onClick={onClose} role="presentation">
      <div className="modal app-modal rules-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal__head">
          <h2>{rules ? `${rules.icon} ${rules.name} · 玩法规则` : '玩法规则'}</h2>
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
        </div>
        {rules ? (
          <div className="rules-modal__body">
            <p className="rules-modal__intro">{rules.intro}</p>
            {rules.sections.map((section) => (
              <section key={section.title} className="rules-section">
                <h3>{section.title}</h3>
                <ul>
                  {section.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </section>
            ))}
            <p className="hint">筹码在结算后不会低于 0；余额不足时无法继续下注。</p>
          </div>
        ) : (
          <div className="rules-modal__body">
            <p className="hint">该玩法暂无详细规则说明。</p>
          </div>
        )}
      </div>
    </div>
  );
}
