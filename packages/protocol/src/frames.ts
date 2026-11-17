export type FrameRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';

export interface AvatarFrameMeta {
  id: string;
  name: string;
  description: string;
  price: number;
  rarity: FrameRarity;
  badge: string;
  cssClass: string;
}

export const AVATAR_FRAMES: readonly AvatarFrameMeta[] = [
  {
    id: 'frame_default',
    name: '经典极简',
    description: '平台初始头像框，简约大方',
    price: 0,
    rarity: 'common',
    badge: '👤',
    cssClass: 'frame-default',
  },
  {
    id: 'frame_lucky_clover',
    name: '幸运四叶草',
    description: '幸运女神眷顾，逢赌必赢，散发翠绿光晕',
    price: 3888,
    rarity: 'rare',
    badge: '🍀',
    cssClass: 'frame-lucky-clover',
  },
  {
    id: 'frame_sakura_rain',
    name: '樱花落雨',
    description: '唯美绯红落樱，点缀浪漫与诗意',
    price: 6888,
    rarity: 'rare',
    badge: '🌸',
    cssClass: 'frame-sakura-rain',
  },
  {
    id: 'frame_cyber_neon',
    name: '赛博霓虹',
    description: '电音朋克流光，未来科技脉冲呼吸',
    price: 8888,
    rarity: 'epic',
    badge: '⚡',
    cssClass: 'frame-cyber-neon',
  },
  {
    id: 'frame_steampunk',
    name: '机械之心',
    description: '复古蒸汽黄铜齿轮，精密传动机巧',
    price: 9888,
    rarity: 'epic',
    badge: '⚙️',
    cssClass: 'frame-steampunk',
  },
  {
    id: 'frame_abyssal_deep',
    name: '深海幽蓝',
    description: '万米深海璀璨珍珠，幽蓝水波流转',
    price: 11888,
    rarity: 'epic',
    badge: '🌊',
    cssClass: 'frame-abyssal-deep',
  },
  {
    id: 'frame_flame_demon',
    name: '烈焰恶魔',
    description: '地狱烈焰升腾，赤红恶魔之瞳灼烧全场',
    price: 12888,
    rarity: 'epic',
    badge: '🔥',
    cssClass: 'frame-flame-demon',
  },
  {
    id: 'frame_emerald_phoenix',
    name: '翡翠青鸾',
    description: '碧波琉璃青鸾展翼，祥瑞万千生机盎然',
    price: 15888,
    rarity: 'epic',
    badge: '🦚',
    cssClass: 'frame-emerald-phoenix',
  },
  {
    id: 'frame_amethyst',
    name: '紫晶幻境',
    description: '魅惑紫水晶折射，幽幻神秘极光迷离',
    price: 16888,
    rarity: 'epic',
    badge: '🔮',
    cssClass: 'frame-amethyst',
  },
  {
    id: 'frame_gold_dragon',
    name: '纯金龙魂',
    description: '金龙盘旋吐珠，至尊龙鳞盘踞闪耀金芒',
    price: 18888,
    rarity: 'legendary',
    badge: '🐉',
    cssClass: 'frame-gold-dragon',
  },
  {
    id: 'frame_ice_crown',
    name: '冰晶王冠',
    description: '极北极寒冰晶凝华，晶莹剔透的高傲桂冠',
    price: 22888,
    rarity: 'legendary',
    badge: '👑',
    cssClass: 'frame-ice-crown',
  },
  {
    id: 'frame_galaxy_astral',
    name: '星河流光',
    description: '璀璨银河旋臂流光，浩瀚群星拱卫左右',
    price: 28888,
    rarity: 'legendary',
    badge: '🌌',
    cssClass: 'frame-galaxy-astral',
  },
  {
    id: 'frame_angelic_halo',
    name: '天使圣环',
    description: '神圣天使纯白羽翼，金色神环庇佑牌运',
    price: 32888,
    rarity: 'legendary',
    badge: '🪽',
    cssClass: 'frame-angelic-halo',
  },
  {
    id: 'frame_aurora',
    name: '极光幻彩',
    description: '北极天际绚烂霓裳，七彩幻影变幻莫测',
    price: 38888,
    rarity: 'legendary',
    badge: '🌈',
    cssClass: 'frame-aurora',
  },
  {
    id: 'frame_royal_flush',
    name: '同花顺尊享',
    description: '黑桃皇室大同花顺，无敌牌皇尊贵徽章',
    price: 50000,
    rarity: 'legendary',
    badge: '♠️',
    cssClass: 'frame-royal-flush',
  },
  {
    id: 'frame_royal_diamond',
    name: '皇家黑钻',
    description: '绝世罕见黑曜石钻戒，璀璨切割闪耀王室之光',
    price: 58888,
    rarity: 'legendary',
    badge: '💎',
    cssClass: 'frame-royal-diamond',
  },
  {
    id: 'frame_solar_wings',
    name: '太阳神翼',
    description: '金乌太阳神炽烈耀斑，万丈豪芒照耀四方',
    price: 66888,
    rarity: 'legendary',
    badge: '☀️',
    cssClass: 'frame-solar-wings',
  },
  {
    id: 'frame_ares_champion',
    name: '荣耀战神',
    description: '铁血赤金百战铠甲，战无不胜百战成神',
    price: 77777,
    rarity: 'legendary',
    badge: '⚔️',
    cssClass: 'frame-ares-champion',
  },
  {
    id: 'frame_supreme_obsidian',
    name: '至尊暗金',
    description: '帝皇黑金双色浮雕，皇者威严震慑全场',
    price: 88888,
    rarity: 'mythic',
    badge: '🔱',
    cssClass: 'frame-supreme-obsidian',
  },
  {
    id: 'frame_god_gambler',
    name: '赌神之冠',
    description: '全服敬仰神话至尊，黄金龙冕加身霸气无双',
    price: 188888,
    rarity: 'mythic',
    badge: '🏆',
    cssClass: 'frame-god-gambler',
  },
  {
    id: 'frame_genesis',
    name: '创世星辉',
    description: '宇宙初开奇点爆发，万物主宰恒星光芒',
    price: 288888,
    rarity: 'mythic',
    badge: '✨',
    cssClass: 'frame-genesis',
  },
];

export interface DealerSkinMeta {
  id: string;
  name: string;
  description: string;
  requiredAffection: number;
  previewClass: string;
  assetFile: string;
}

export const DEALER_SKINS: readonly DealerSkinMeta[] = [
  {
    id: 'classic',
    name: '经典黑金礼服',
    description: '初识荷官的经典燕尾礼服，端庄而优雅',
    requiredAffection: 0,
    previewClass: 'skin-classic',
    assetFile: 'dealer-main.jpg',
  },
  {
    id: 'cheongsam',
    name: '国风锦绣旗袍',
    description: '好感度达 500 解锁，雍容华贵、金线刺绣的国风丝绸旗袍',
    requiredAffection: 500,
    previewClass: 'skin-cheongsam',
    assetFile: 'dealer-cheongsam.jpg',
  },
  {
    id: 'bunny',
    name: '兔女郎狂欢',
    description: '好感度达 2000 解锁，俏皮火辣的拉斯维加斯派对兔女郎特装',
    requiredAffection: 2000,
    previewClass: 'skin-bunny',
    assetFile: 'dealer-bunny.jpg',
  },
  {
    id: 'royal',
    name: '皇家荷官礼服',
    description: '好感度达 5000 解锁，尊贵华丽的纯白与红丝绒王室礼服',
    requiredAffection: 5000,
    previewClass: 'skin-royal',
    assetFile: 'dealer-royal.jpg',
  },
  {
    id: 'cyber',
    name: '赛博霓虹姬',
    description: '好感度达 10000 誓约解锁，科技感爆棚的机械发光战姬特装',
    requiredAffection: 10000,
    previewClass: 'skin-cyber',
    assetFile: 'dealer-cyber.jpg',
  },
];

export interface DealerVoiceMeta {
  id: string;
  name: string;
  tagline: string;
  requiredAffection: number;
  quotes: {
    idle: string[];
    touch: string[];
    cheer: string[];
    win: string[];
  };
}

export const DEALER_VOICES: readonly DealerVoiceMeta[] = [
  {
    id: 'classic',
    name: '优雅知性',
    tagline: '“老板手气真好，欢迎常来哦~”',
    requiredAffection: 0,
    quotes: {
      idle: [
        '老板手气真好，欢迎常来哦~',
        '下注请买定离手，祝您本轮手气亨通！',
        '爱丽丝今天一直在等您呢~',
      ],
      touch: [
        '呀，老板请自重，牌局还在继续呢~ 嘻嘻',
        '再戳爱丽丝就要分心算错牌啦！',
        '老板今天心情很不错嘛~',
      ],
      cheer: [
        '加油哦老板，下一把肯定大丰收！',
        '好运总是眷顾从容不迫的人~',
        '爱丽丝在背后一直为您默默祈祷呢！',
      ],
      win: [
        '恭喜老板大获全胜，爱丽丝为您感到骄傲！',
        '哇！大赢一把，今晚一定要开香槟庆祝哦！',
        '太精彩了，简直是牌桌上的艺术家！',
      ],
    },
  },
  {
    id: 'tsundere',
    name: '傲娇大小姐',
    tagline: '“哼，才不是为了你才在这里发牌的呢！”',
    requiredAffection: 500,
    quotes: {
      idle: [
        '哼，别以为送我点筹码我就会对你笑！',
        '看什么看！本小姐发牌的技术可是世界一流的！',
        '呆子，下注慢吞吞的，在想什么呢？',
      ],
      touch: [
        '喂！你在往哪摸啊？！笨蛋笨蛋笨蛋！',
        '变态！再乱动本小姐就直接把牌甩你脸上！',
        '别碰本小姐啦……笨蛋，脸都红了……',
      ],
      cheer: [
        '这把要是输光了可别找我哭鼻子，本小姐概不负责！',
        '笨蛋，好好看清楚走势再押，真不让人省心！',
        '别看了，专心打牌！赢了我才勉强夸你一句！',
      ],
      win: [
        '居、居然赢了……才没有为你高兴呢，只是筹码变多了而已！',
        '哼，算你走运！下次可没这么容易了！',
        '勉为其难承认你有点本事吧……就一点点哦！',
      ],
    },
  },
  {
    id: 'sweet',
    name: '甜美偶像',
    tagline: '“呐呐~ 哥哥今天一定会大赢特赢的喵！”',
    requiredAffection: 2000,
    quotes: {
      idle: [
        '呐呐~ 哥哥今天一定会大赢特赢的喵！',
        '爱丽丝的爱心光波，哔哔哔~ 接收到好运了吗？',
        '只要哥哥开心，爱丽丝天天给你发牌牌~ (≧∇≦)ﾉ',
      ],
      touch: [
        '嘻嘻~ 痒痒的啦！爱丽丝给哥哥比个大大的心心~ 💖',
        '哥哥最好了！爱丽丝心跳加速啦~',
        '啾~ 爱丽丝的专属幸运吻，哥哥收好哦！',
      ],
      cheer: [
        '发射爱心光波，给哥哥注入满满的好运能量！',
        '哥哥超级帅气，一定能把庄家打得落花流水！',
        '别担心，爱丽丝的好运小精灵一直守护在哥哥身边呢！',
      ],
      win: [
        '哇！！哥哥太棒太厉害啦！爱死你了喵~ (≧∇≦)ﾉ',
        '暴富啦暴富啦！哥哥快抱抱爱丽丝举高高~',
        '全场焦点就是哥哥！哥哥真是世界第一厉害！',
      ],
    },
  },
  {
    id: 'queen',
    name: '赌场女王',
    tagline: '“今夜，全场筹码与命运，都在我的掌控之中。”',
    requiredAffection: 5000,
    quotes: {
      idle: [
        '今夜，筹码与命运都在我的掌控之中。',
        '输赢不过指尖风月，你敢跟上我的节奏么？',
        '在我的台面上，胆小鬼可没有立足之地。',
      ],
      touch: [
        '胆子不小嘛。想要引起我的注意，光凭这点可不够。',
        '呵，小家伙，手伸得太长可是会被吃掉的哦。',
        '眼神很炽热嘛。我很欣赏你的野心。',
      ],
      cheer: [
        '敢孤注一掷的人才有资格赢，让我看看你的魄力。',
        '既然上了我的赌桌，就做好主宰全场的准备。',
        '自信点，王者从不怀疑自己的抉择。',
      ],
      win: [
        '干得漂亮。这是属于强者的战利品，尽情享用吧。',
        '不愧是我看中的男人，果然没有让我失望。',
        '全场筹码皆俯首称臣，今夜你与我共享王座。',
      ],
    },
  },
  {
    id: 'cyber',
    name: '赛博机械姬',
    tagline: '“正在测算胜率矩阵……当前胜率 98.7%。”',
    requiredAffection: 10000,
    quotes: {
      idle: [
        '正在测算环境胜率矩阵……当前胜率预估：98.7%。',
        '量子发牌算法已加载完毕，随机数种子完美熵增。',
        '指挥官，爱丽丝已与您的脑波神经元完成共振同步。',
      ],
      touch: [
        '警报：检测到体表微电荷接触，核心温度上升 0.8℃。',
        '感知回路过载……警告，情感模块发生异常心跳频率。',
        '指令已确认，执行亲密度上升程序：好感度 +999。',
      ],
      cheer: [
        '量子纠缠协议就绪，爱丽丝将为您全程护航分析。',
        '最优下注向量已推演完成，建议遵循直觉指令。',
        '防火墙状态极佳，任何不利概率皆已被驱逐拦截。',
      ],
      win: [
        '高能反应！检测到巨额资产流入，恭喜指挥官斩获胜利！',
        '胜率模型完美收敛！财富曲线呈指数级爆发！',
        '任务圆满达成，指挥官的战术智慧已被写入最高荣誉数据库！',
      ],
    },
  },
];
