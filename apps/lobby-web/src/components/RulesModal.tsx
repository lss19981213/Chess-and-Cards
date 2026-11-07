interface RuleSection {
  title: string;
  lines: string[];
}

interface GameRules {
  name: string;
  intro: string;
  sections: RuleSection[];
}

const BET_LIMIT = '单注 10 – 2,000 筹码，每局累计不超过 6,000 筹码。每局 30 秒下注、5 秒开牌，随后自动进入下一局。';
const CHIPS_NOTE = '下注时筹码会立即扣除；开牌前可撤注，筹码全额退回。结算只按净盈亏入账，本金会自动返还。';

const RULES: Record<string, GameRules> = {
  tuizhuanzi: {
    name: '推筒子',
    intro: '平台坐庄的比大小玩法。每局给「天、地、人」三门与庄家各发两张筒子牌，取两牌点数之和的个位（0 – 9）比大小。',
    sections: [
      { title: '怎么玩', lines: [
        '选择「天 / 地 / 人」任意一门下注，猜这一门的点数是否比庄家大。',
        '押中比庄家大的门：1 : 1 赔付，净赢等额筹码。',
        '比庄家点数小：输掉该门注额；与庄家点数相同视为和局，不输不赢。',
        '可以同时押多门，各门独立结算。',
      ] },
      { title: '注额与时间', lines: [BET_LIMIT, CHIPS_NOTE] },
      { title: '走势', lines: ['右侧走势面板记录最近 30 局的庄家与三门点数，以及获胜门，方便参考历史开奖。'] },
    ],
  },
  dice: {
    name: '骰宝',
    intro: '三颗骰子同时开盅，和值为 3 – 18。玩法围绕点数大小、单双、豹子与具体和值下注。',
    sections: [
      { title: '下注区域与赔率', lines: [
        '大（和值 11 – 17）、小（4 – 10）、单、双：1 : 1。',
        '豹子（三颗骰子点数相同）：1 : 24。',
        '具体和值：4 / 17 为 1 : 50，5 / 16 为 1 : 18，6 / 15 为 1 : 14，7 / 14 为 1 : 12，8 / 13 为 1 : 8，9 / 10 / 11 / 12 为 1 : 6。',
        '开出豹子时，大小、单双与所有和值注全部通杀，只赔豹子。',
      ] },
      { title: '注额与时间', lines: [BET_LIMIT, CHIPS_NOTE, '可同时押多个区域，各区域独立结算；未开盅前可按区域撤注或一键清空。'] },
      { title: '走势', lines: ['右侧走势面板记录最近 30 局的骰面、和值与大 / 小 / 豹子结果。'] },
    ],
  },
  baccarat: {
    name: '百家乐',
    intro: '8 副牌的标准 Punto Banco 玩法，闲家与庄家各取 2 – 3 张牌比点数，玩家押哪一方更接近 9 点。',
    sections: [
      { title: '点数计算', lines: [
        'A 计 1 点，10 / J / Q / K 计 0 点，其余按面值计点。',
        '总点取个位数，最高 9 点、最低 0 点。',
        '任一方起手拿到 8 或 9 点（天生牌）时双方直接停牌比大小；否则按标准补牌规则决定是否发第三张牌。',
      ] },
      { title: '下注区域与赔率', lines: [
        '押闲赢：1 : 1。',
        '押庄赢：1 : 0.95，平台抽水 5%，赢额向下取整。',
        '押和赢：1 : 8。开和时押闲 / 押庄的注全部输掉。',
      ] },
      { title: '注额与时间', lines: [BET_LIMIT, CHIPS_NOTE] },
      { title: '走势', lines: ['右侧走势面板记录最近 30 局的闲 / 庄点数与胜方。'] },
    ],
  },
  niuniu: {
    name: '斗牛',
    intro: '庄家每局开三张牌算牛点，押中对应的牛数就赢。',
    sections: [
      { title: '怎么玩', lines: [
        '庄家开三张牌，点数规则：A 计 1 点，J / Q / K 各计 10 点，其余按面值。',
        '三张牌总和不足 10 为「无牛」；总和达到 10 以上取个位，个位为 0 记「牛牛」，为 1-9 即牛一至牛九。',
        '押中庄家开出的点数即赢，赔率 1:1；可以同时押多个区域，各区域独立结算。',
      ] },
      { title: '注额与时间', lines: [BET_LIMIT, CHIPS_NOTE] },
    ],
  },
  blackjack: {
    name: '21点',
    intro: '每位玩家独立与庄家对局，凑到 21 点为胜，超过 21 点爆牌判负。',
    sections: [
      { title: '下注区域与赔率', lines: [
        '赢（你的点数高于庄家）：1 : 1。',
        '输（你的点数低于庄家）：1 : 1。',
        '和（双方点数相同）：1 : 8。',
        '21 点（你的牌正好凑成 21 点）：1 : 2。',
        '四个区域可以同时下注，各自独立结算。',
      ] },
      { title: '牌局流程', lines: [
        '下注后开始发牌：庄家一张明牌、一张暗牌，你拿两张底牌。',
        '点数规则：A 可当 1 点或 11 点，J / Q / K 均计 10 点。',
        '可点「要牌」继续补牌（最多 5 张），或点「停牌」锁定当前点数。',
        '庄家点数不足 17 会自动补牌，达到 17 点及以上停牌，随后与你的点数比较。',
        '双方都是 21 点算和局，押「和」赢；仅你 21 点则「21 点」区也赢。',
      ] },
      { title: '注额与时间', lines: ['单注 10 – 2,000 筹码，每局累计不超过 6,000 筹码。每局 25 秒下注、20 秒要牌、5 秒结算。', CHIPS_NOTE] },
    ],
  },
  texas: {
    name: '德州扑克',
    intro: '2 – 6 人同桌竞技，每人 2 张底牌，与 5 张公共牌组合成最大的 5 张牌型，牌型最大者赢下底池。',
    sections: [
      { title: '盲注与流程', lines: [
        '开局由庄家位左侧两人自动下小盲 50、大盲 100，庄家位每局轮转。',
        '依次经过翻前、翻牌（3 张公共牌）、转牌（1 张）、河牌（1 张）四轮下注，最后摊牌比大小。',
        '盲注由系统在开局自动投入，在本局结算时与其他投入一并结清。',
      ] },
      { title: '四种行动', lines: [
        '弃牌：放弃本局，不再参与底池分配。',
        '过牌：当前无需跟注时可不投筹码，保留继续游戏的资格。',
        '跟注：补齐到当前轮的最高注额。',
        '加注：在跟注基础上额外加 100 – 5,000 筹码，每位玩家每局最多加注 5 次；加注后其他人需重新行动。',
        '跟注与加注会立即从筹码扣除，筹码不足时无法下注，只能选择弃牌或过牌。',
      ] },
      { title: '牌型大小（由高到低）', lines: [
        '皇家同花顺 › 同花顺 › 四条 › 葫芦 › 同花 › 顺子 › 三条 › 两对 › 一对 › 高牌。',
        '牌型相同则比较关键牌点数，仍相同为并列赢家，平分底池（向下取整）。',
      ] },
    ],
  },
  doudizhu: {
    name: '斗地主',
    intro: '经典三人对局，1 名地主对阵 2 名农民，先出完手牌的一方获胜。',
    sections: [
      { title: '怎么玩', lines: [
        '三人各拿一手牌，通过叫抢确定地主，地主先出牌。',
        '按轮次出牌，后手必须用相同牌型且更大的牌压制，或选择不出。',
        '常见牌型有单张、对子、三张、三带一、顺子、连对、飞机、四带二、炸弹、王炸。',
      ] },
      { title: '结算', lines: ['地主获胜：地主 +200，两名农民各 -100。', '农民获胜：地主 -200，两名农民各 +100。'] },
    ],
  },
  paodekuai: {
    name: '跑得快',
    intro: '三人快节奏出牌玩法，目标是比对手更快出完手牌。',
    sections: [
      { title: '怎么玩', lines: [
        '三人各持一手牌，按牌型轮流出牌，后手需以同牌型更大的牌压制或选择不出。',
        '最先出完所有手牌的玩家获胜，其余玩家按未出完的牌结算。',
      ] },
      { title: '结算', lines: ['赢家 +200 筹码，另外两名玩家各 -100 筹码。'] },
    ],
  },
  gomoku: {
    name: '五子棋',
    intro: '15 路棋盘上的双人对弈，黑白双方轮流落子。',
    sections: [
      { title: '怎么玩', lines: [
        '黑棋先行，双方交替在棋盘交叉点落子。',
        '先在横、竖、斜任意方向连成 5 颗同色棋子的一方获胜。',
      ] },
      { title: '结算', lines: ['胜者 +100 筹码，负者 -100 筹码；和棋不计分。'] },
    ],
  },
};

interface Props {
  gameId: string;
  onClose: () => void;
}

export function RulesModal({ gameId, onClose }: Props) {
  const rules = RULES[gameId];
  return (
    <div className="modal-mask" onClick={onClose} role="presentation">
      <div className="modal app-modal rules-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal__head">
          <h2>{rules ? `${rules.name} · 玩法规则` : '玩法规则'}</h2>
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
