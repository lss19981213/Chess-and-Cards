import { useState } from 'react';
import { IconBack, IconRules, IconSparkle } from './Icons';

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
      {
        title: '怎么玩',
        lines: [
          '选择「天 / 地 / 人」任意一门下注，猜这一门的点数是否比庄家大。',
          '押中比庄家大的门：1 : 1 赔付，净赢等额筹码。',
          '比庄家点数小：输掉该门注额；与庄家点数相同视为和局，不输不赢。',
          '可以同时押多门，各门独立结算。',
        ],
      },
      { title: '注额与时间', lines: [BET_LIMIT, CHIPS_NOTE] },
      { title: '走势', lines: ['右侧走势面板记录最近 30 局的庄家与三门点数，以及获胜门，方便参考历史开奖。'] },
    ],
  },
  dice: {
    name: '骰宝',
    intro: '三颗骰子同时开盅，和值为 3 – 18。玩法围绕点数大小、单双、豹子与具体和值下注。',
    sections: [
      {
        title: '下注区域与赔率',
        lines: [
          '大（和值 11 – 17）、小（4 – 10）、单、双：1 : 1。',
          '豹子（三颗骰子点数相同）：1 : 24。',
          '具体和值：4 / 17 为 1 : 50，5 / 16 为 1 : 18，6 / 15 为 1 : 14，7 / 14 为 1 : 12，8 / 13 为 1 : 8，9 / 10 / 11 / 12 为 1 : 6。',
          '开出豹子时，大小、单双与所有和值注全部通杀，只赔豹子。',
        ],
      },
      { title: '注额与时间', lines: [BET_LIMIT, CHIPS_NOTE, '可同时押多个区域，各区域独立结算；未开盅前可撤注。'] },
    ],
  },
  baccarat: {
    name: '百家乐',
    intro: '8 副牌的标准 Punto Banco 玩法，闲家与庄家各取 2 – 3 张牌比点数，玩家押哪一方更接近 9 点。',
    sections: [
      {
        title: '点数计算',
        lines: [
          'A 计 1 点，10 / J / Q / K 计 0 点，其余按面值计点。',
          '总点取个位数，最高 9 点、最低 0 点。',
          '任一方起手拿到 8 或 9 点（天生牌）时双方直接停牌比大小；否则按标准补牌规则决定是否发第三张牌。',
        ],
      },
      {
        title: '下注区域与赔率',
        lines: [
          '押闲赢：1 : 1。',
          '押庄赢：1 : 0.95，平台抽水 5%，赢额向下取整。',
          '押和赢：1 : 8。开和时押闲 / 押庄的注全部输掉。',
        ],
      },
      { title: '注额与时间', lines: [BET_LIMIT, CHIPS_NOTE] },
    ],
  },
  doudizhu: {
    name: '斗地主',
    intro: '三人一副牌（54张），地主一人对抗两名农民。谁先出完手牌即宣告阵营获胜。',
    sections: [
      {
        title: '基本规则',
        lines: [
          '发牌后随机指定地主并获得 3 张底牌，农民两两协作。',
          '单张、对子、三带一、顺子、连对、飞机、炸弹、王炸（火箭）。',
          '火箭与炸弹可压制任意常规牌型，且翻倍本局底分。',
        ],
      },
    ],
  },
  gomoku: {
    name: '五子棋',
    intro: '标准 15×15 棋盘，黑白两色棋子，双人回合制对弈。',
    sections: [
      {
        title: '胜负判定',
        lines: [
          '黑先白后，依次在棋盘无子交叉点落子。',
          '任何一方横、竖、斜任意方向率先形成连续五子即获胜。',
        ],
      },
    ],
  },
  texas: {
    name: '德州扑克',
    intro: '无上限德州扑克单局玩法。2 张底牌搭配 5 张公共牌组合出最优 5 张牌力。',
    sections: [
      {
        title: '牌局流程',
        lines: [
          '盲注阶段 → 翻牌圈 (3张) → 转牌圈 (1张) → 河牌圈 (1张) → 摊牌比牌。',
          '皇家同花顺 > 同花顺 > 四条 > 葫芦 > 同花 > 顺子 > 三条 > 两对 > 一对 > 高牌。',
        ],
      },
    ],
  },
};

interface Props {
  initialGameId?: string;
  onBack: () => void;
}

export function RulesView({ initialGameId = 'doudizhu', onBack }: Props) {
  const [selectedGame, setSelectedGame] = useState(RULES[initialGameId] ? initialGameId : 'tuizhuanzi');
  const current = RULES[selectedGame] ?? RULES.tuizhuanzi!;

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
          <span className="view-sub">官方权威规则解析 · 算力透明公平竞技</span>
        </div>
        <div className="view-topbar__placeholder" />
      </header>

      <main className="view-main rules-layout">
        {/* 左侧游戏选择导航 */}
        <aside className="rules-nav-panel">
          <div className="rules-nav-title">游戏列表</div>
          <div className="rules-nav-list">
            {Object.entries(RULES).map(([key, item]) => (
              <button
                key={key}
                type="button"
                className={`rules-nav-item ${selectedGame === key ? 'is-active' : ''}`}
                onClick={() => setSelectedGame(key)}
              >
                <span>{item.name}</span>
                {selectedGame === key && <IconSparkle size={12} />}
              </button>
            ))}
          </div>
        </aside>

        {/* 右侧规则正文卷轴 */}
        <section className="rules-doc-panel">
          <div className="doc-header">
            <h3>{current.name}</h3>
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
