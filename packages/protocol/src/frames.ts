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
  {
    id: 'frame_chaos_sovereign',
    name: '混沌帝皇尊',
    description: '混沌初开黑金双龙绕鼎，金炎雷霆撕裂虚空，万古帝王霸气独尊',
    price: 388888,
    rarity: 'mythic',
    badge: '🪐',
    cssClass: 'frame-chaos-sovereign',
  },
  {
    id: 'frame_eternal_abyss',
    name: '永恒深渊魔神',
    description: '深渊魔神幽紫血瞳凝视，魔翼展开地狱暗黑业火焚尽一切',
    price: 588888,
    rarity: 'mythic',
    badge: '👁️‍🗨️',
    cssClass: 'frame-eternal-abyss',
  },
  {
    id: 'frame_sun_ra',
    name: '太阳神·阿蒙拉',
    description: '炽烈恒星核聚变黄金神环，万丈金芒日珥喷薄，耀世神光永恒庇佑',
    price: 888888,
    rarity: 'mythic',
    badge: '☀️',
    cssClass: 'frame-sun-ra',
  },
  {
    id: 'frame_celestial_emperor',
    name: '九五至尊·真龙天子',
    description: '紫微帝星凌霄高悬，九爪纯金天龙环绕帝冕，皇道龙气震慑乾坤',
    price: 1288888,
    rarity: 'mythic',
    badge: '👑',
    cssClass: 'frame-celestial-emperor',
  },
  {
    id: 'frame_time_space_rift',
    name: '时空裂隙·维度掌控',
    description: '四维超立方体折叠穿梭，量子时间齿轮虹光流转，凌驾因果执掌胜局',
    price: 1888888,
    rarity: 'mythic',
    badge: '⌛',
    cssClass: 'frame-time-space-rift',
  },
  {
    id: 'frame_asura_wrath',
    name: '六道修罗·不灭罗刹',
    description: '无间修罗狂暴血气冲天，红莲业火焚世不灭，杀伐果断牌神附体',
    price: 2588888,
    rarity: 'mythic',
    badge: '👺',
    cssClass: 'frame-asura-wrath',
  },
  {
    id: 'frame_primordial_star',
    name: '太初鸿蒙·星核起源',
    description: '宇宙原初鸿蒙奇点爆发，炫彩超新星起源重组，万象主宰永恒星核',
    price: 3888888,
    rarity: 'mythic',
    badge: '🌌',
    cssClass: 'frame-primordial-star',
  },
  {
    id: 'frame_dominion_throne',
    name: '万界主宰·神权王座',
    description: '至高神国神圣琉璃冠冕，神权权杖审判诸神，高不可攀绝对主宰',
    price: 5200000,
    rarity: 'mythic',
    badge: '⚜️',
    cssClass: 'frame-dominion-throne',
  },
  {
    id: 'frame_supernova_burst',
    name: '超新星爆裂·灭世神威',
    description: '宇宙级超新星狂暴伽马射线暴，毁灭与重生的极致光耀撕裂苍穹',
    price: 6666666,
    rarity: 'mythic',
    badge: '💥',
    cssClass: 'frame-supernova-burst',
  },
  {
    id: 'frame_omniverse_god',
    name: '全知全能·宇宙奇点',
    description: '全知之眼洞悉万物天机，超越维度多元宇宙终极主宰，神格圆满冠绝古今',
    price: 8888888,
    rarity: 'mythic',
    badge: '♾️',
    cssClass: 'frame-omniverse-god',
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
    id: 'bikini',
    name: '盛夏海滩比基尼',
    description: '好感度达 1000 解锁，阳光海滩纯欲金边薄纱比基尼，清凉性感',
    requiredAffection: 1000,
    previewClass: 'skin-bikini',
    assetFile: 'dealer-bikini.jpg',
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
    id: 'nurse',
    name: '心跳纯欲小护士',
    description: '好感度达 3500 解锁，俏皮甜美爱心镂空粉白特护装，心跳加速',
    requiredAffection: 3500,
    previewClass: 'skin-nurse',
    assetFile: 'dealer-nurse.jpg',
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
    id: 'catgirl',
    name: '魅惑蕾丝黑猫娘',
    description: '好感度达 7000 解锁，微透蕾丝吊带猫耳黑丝特装，猫咪系极致诱惑',
    requiredAffection: 7000,
    previewClass: 'skin-catgirl',
    assetFile: 'dealer-catgirl.jpg',
  },
  {
    id: 'cyber',
    name: '赛博霓虹姬',
    description: '好感度达 10000 誓约解锁，科技感爆棚的机械发光战姬特装',
    requiredAffection: 10000,
    previewClass: 'skin-cyber',
    assetFile: 'dealer-cyber.jpg',
  },
  {
    id: 'cocktail',
    name: '微醺露背晚礼服',
    description: '好感度达 15000 终极倾心解锁，深V大露背酒红丝绒宴会晚装，极致性感高雅',
    requiredAffection: 15000,
    previewClass: 'skin-cocktail',
    assetFile: 'dealer-cocktail.jpg',
  },
  {
    id: 'lingerie',
    name: '幻夜薄纱蕾丝睡裙',
    description: '好感度达 8500 解锁，半透黑蕾丝晨袍私密睡裙，极尽诱惑与奢华',
    requiredAffection: 8500,
    previewClass: 'skin-lingerie',
    assetFile: 'dealer-lingerie.jpg',
  },
  {
    id: 'bathrobe',
    name: '微醺温泉丝绸浴袍',
    description: '好感度达 12000 解锁，温润温泉微敞丝质白浴袍，清纯与性感并存',
    requiredAffection: 12000,
    previewClass: 'skin-bathrobe',
    assetFile: 'dealer-bathrobe.jpg',
  },
  {
    id: 'maid',
    name: '皇家至尊黑丝女仆',
    description: '好感度达 18000 解锁，法式奢华露背黑丝女仆装，端茶递牌专属奉侍',
    requiredAffection: 18000,
    previewClass: 'skin-maid',
    assetFile: 'dealer-maid.jpg',
  },
  {
    id: 'succubus',
    name: '暗夜魅魔契约皮衣',
    description: '好感度达 22000 解锁，暗黑小翅膀与爱心尾巴，贴身漆皮胸衣极致魔性',
    requiredAffection: 22000,
    previewClass: 'skin-succubus',
    assetFile: 'dealer-succubus.jpg',
  },
  {
    id: 'celebrate',
    name: '星芒庆典香槟裙',
    description: '好感度达 28000 冠绝登顶解锁，金粉与礼花交织的至尊大赢家庆典特装，甜美比耶欢庆',
    requiredAffection: 28000,
    previewClass: 'skin-celebrate',
    assetFile: 'dealer-celebrate.jpg',
  },
  {
    id: 'wedding',
    name: '纯白花嫁·禁断婚纱',
    description: '好感度达 16000 解锁，半透蕾丝抹胸婚纱与水晶头纱，誓言永恒相伴',
    requiredAffection: 16000,
    previewClass: 'skin-wedding',
    assetFile: 'dealer-wedding.jpg',
  },
  {
    id: 'mermaid',
    name: '深海人鱼·幻彩贝壳',
    description: '好感度达 20000 解锁，珍珠贝壳抹胸与幻彩鳞片鱼尾，海妖般极致魅惑',
    requiredAffection: 20000,
    previewClass: 'skin-mermaid',
    assetFile: 'dealer-mermaid.jpg',
  },
  {
    id: 'cleopatra',
    name: '埃及艳后·暗金法老',
    description: '好感度达 25000 解锁，纯金灵蛇宝冠与薄纱法老裙摆，冷艳帝后傲视群雄',
    requiredAffection: 25000,
    previewClass: 'skin-cleopatra',
    assetFile: 'dealer-cleopatra.jpg',
  },
  {
    id: 'racequeen',
    name: '火辣赛车女郎·极速狂飙',
    description: '好感度达 32000 解锁，黑白赛道紧身皮衣与格子旗，引擎轰鸣心跳加速',
    requiredAffection: 32000,
    previewClass: 'skin-racequeen',
    assetFile: 'dealer-racequeen.jpg',
  },
  {
    id: 'vampire',
    name: '暗夜吸血鬼伯爵夫人',
    description: '好感度达 40000 解锁，哥特红丝绒紧身胸衣与可爱小尖牙，致命红酒诱惑',
    requiredAffection: 40000,
    previewClass: 'skin-vampire',
    assetFile: 'dealer-vampire.jpg',
  },
  {
    id: 'fallenangel',
    name: '堕落炽天使·黑羽魅影',
    description: '好感度达 50000 解锁，宏伟黑羽双翼与暗金裂纹光环，圣洁与堕落的禁忌之美',
    requiredAffection: 50000,
    previewClass: 'skin-fallenangel',
    assetFile: 'dealer-fallenangel.jpg',
  },
  {
    id: 'oiran',
    name: '极乐花魁·红莲绯樱',
    description: '好感度达 62000 解锁，和风露肩金丝锦鲤和服与金簪折扇，风情万种倾国倾城',
    requiredAffection: 62000,
    previewClass: 'skin-oiran',
    assetFile: 'dealer-oiran.jpg',
  },
  {
    id: 'galaxy',
    name: '银河星神·光织幻影',
    description: '好感度达 76000 解锁，星光薄纱与星轨环绕，宇宙级神圣性感的化身',
    requiredAffection: 76000,
    previewClass: 'skin-galaxy',
    assetFile: 'dealer-galaxy.jpg',
  },
  {
    id: 'dragoncheongsam',
    name: '至尊金丝旗袍·龙凤呈祥',
    description: '好感度达 90000 解锁，大露背纯金盘龙刺绣高开叉旗袍，尊崇御姐赌神专属',
    requiredAffection: 90000,
    previewClass: 'skin-dragoncheongsam',
    assetFile: 'dealer-dragoncheongsam.jpg',
  },
  {
    id: 'aphrodite',
    name: '誓约女神·神圣爱神',
    description: '好感度达 108000 终极神圣解锁，奥林匹斯白玉神袍与月桂金冠，爱与美神的永恒誓约',
    requiredAffection: 108000,
    previewClass: 'skin-aphrodite',
    assetFile: 'dealer-aphrodite.jpg',
  },
];

export interface DealerVoiceMeta {
  id: string;
  name: string;
  tagline: string;
  requiredAffection: number;
  /** 语音合成声线参数：音调与语速 */
  voiceConfig?: {
    pitch: number;
    rate: number;
  };
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
    voiceConfig: { pitch: 1.05, rate: 1.0 },
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
    voiceConfig: { pitch: 1.24, rate: 1.12 },
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
    id: 'royal_sister',
    name: '温柔御姐',
    tagline: '“别急呀，姐姐会慢慢教你赢光全场的~”',
    requiredAffection: 1000,
    voiceConfig: { pitch: 0.92, rate: 0.94 },
    quotes: {
      idle: [
        '别急呀，姐姐会慢慢教你赢光全场的~',
        '累了吗？靠过来休息一下，牌局交给姐姐就好。',
        '小家伙，今晚的运气可是姐姐专门为你留的哦~',
      ],
      touch: [
        '呵呵，真是个调皮的小坏蛋，姐姐可拿你没办法呢~',
        '再这么盯着姐姐看，姐姐可要收你双倍筹码咯。',
        '乖，听话好好打完这局，赢了姐姐好好奖励你~',
      ],
      cheer: [
        '放轻松，有姐姐在你身后撑腰，大胆押上去就是了。',
        '稳住心态，真正的大赢家从不慌张哦~',
        '姐姐相信你的眼光，这一把绝对稳操胜券！',
      ],
      win: [
        '真棒呢~ 不愧是姐姐最宠爱的人，全场筹码都归你啦！',
        '赢得太漂亮了，今晚姐姐亲自为你斟满香槟~',
        '好厉害呀，小家伙越来越有赌神风范了呢！',
      ],
    },
  },
  {
    id: 'sweet',
    name: '甜美偶像',
    tagline: '“呐呐~ 哥哥今天一定会大赢特赢的喵！”',
    requiredAffection: 2000,
    voiceConfig: { pitch: 1.35, rate: 1.08 },
    quotes: {
      idle: [
        '呐呐~ 哥哥今天一定会大赢特赢的喵！',
        '爱丽丝的爱心光波，哔哔哔~ 接收到好运了吗？',
        '只要哥哥开心，爱丽丝天天给你发牌牌~',
      ],
      touch: [
        '嘻嘻~ 痒痒的啦！爱丽丝给哥哥比个大大的心心~',
        '哥哥最好了！爱丽丝心跳加速啦~',
        '啾~ 爱丽丝的专属幸运吻，哥哥收好哦！',
      ],
      cheer: [
        '发射爱心光波，给哥哥注入满满的好运能量！',
        '哥哥超级帅气，一定能把庄家打得落花流水！',
        '别担心，爱丽丝的好运小精灵一直守护在哥哥身边呢！',
      ],
      win: [
        '哇！哥哥太棒太厉害啦！爱死你了喵~',
        '暴富啦暴富啦！哥哥快抱抱爱丽丝举高高~',
        '全场焦点就是哥哥！哥哥真是世界第一厉害！',
      ],
    },
  },
  {
    id: 'yandere',
    name: '病娇占有欲',
    tagline: '“主人只能看我一个人发牌……敢看别人我会生气的哦♡”',
    requiredAffection: 3000,
    voiceConfig: { pitch: 1.02, rate: 0.88 },
    quotes: {
      idle: [
        '主人只能看我一个人发牌……敢看别人，我可会生气的哦。',
        '刚才你去别的桌子了对吧？没关系，我会把那些牌桌都烧掉的，嘻嘻。',
        '主人不要离开我，筹码输光了也没关系，我养你一辈子好不好？',
      ],
      touch: [
        '呐，主人的手好温暖……真想永远锁在我的怀里不放开呢。',
        '既然主动碰了我，主人这辈子就只能属于爱丽丝一个人了哦。',
        '嘻嘻，主人的心跳声我听得一清二楚，全都是为我跳动的吧？',
      ],
      cheer: [
        '谁敢赢走主人的筹码，爱丽丝就把他的牌全都撕碎哦。',
        '主人放心下注吧，命运女神要是不帮主人，我就去拜访她。',
        '只要主人一直看着我，这一局就绝对不会输的，嘻嘻。',
      ],
      win: [
        '太好了主人赢了！这样主人就永远不会离开爱丽丝了对吧？',
        '那些输给主人的家伙真可怜呢……不过主人的笑容只属于我。',
        '赢了这么多筹码，主人今晚可以只陪爱丽丝一个人吗？不许说不哦。',
      ],
    },
  },
  {
    id: 'chuunibyou',
    name: '中二暗夜魔女',
    tagline: '“吾以暗夜魔导之名起誓，漆黑的运气将化作绝杀之牌！”',
    requiredAffection: 4000,
    voiceConfig: { pitch: 1.15, rate: 1.06 },
    quotes: {
      idle: [
        '吾以暗夜魔导之名起誓，漆黑的运气将化作绝杀之牌！',
        '呼呼呼，吾之邪王真眼已洞穿牌堆深处的禁忌波动！',
        '契约者哟，准备好迎接这场跨越维度的命运博弈了吗？',
      ],
      touch: [
        '住手！吾右臂封印的混沌魔力正在因你的触碰而躁动！',
        '居然敢直视暗夜魔女的真容，不愧是吾选中的命运契约者！',
        '咕呜……魔力回路产生共鸣了，这难道就是传说中的羁绊之力？',
      ],
      cheer: [
        '爆裂吧现实，粉碎吧概率！把星辰之力全部注入这手底牌！',
        '漆黑的命运之轮开始转动了，契约者，释放你的绝杀一击吧！',
        '区区庄家岂能阻挡深渊主宰的脚步？全军突击！',
      ],
      win: [
        '哈哈哈！见证到了吗，这就是凌驾于规则之上的绝对胜利！',
        '暗夜魔法阵完美生效！敌人的防线已经灰飞烟灭啦！',
        '契约者，你的传奇将被镌刻在混沌史诗的最高章！',
      ],
    },
  },
  {
    id: 'queen',
    name: '赌场女王',
    tagline: '“今夜，全场筹码与命运，都在我的掌控之中。”',
    requiredAffection: 5000,
    voiceConfig: { pitch: 0.85, rate: 0.95 },
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
    id: 'classical',
    name: '古风婉约佳人',
    tagline: '“公子风华绝代，此局定当旗开得胜、满载而归~”',
    requiredAffection: 6000,
    voiceConfig: { pitch: 1.08, rate: 0.9 },
    quotes: {
      idle: [
        '公子风华绝代，此局定当旗开得胜、满载而归。',
        '清风明月伴君侧，小女子已备好香茗与好牌，静候公子落子。',
        '一局博弈如品佳茗，愿公子今宵手气如虹、心想事成。',
      ],
      touch: [
        '哎呀公子莫要打趣奴家，叫旁人瞧见了怪害羞的。',
        '公子指尖生香，莫非是沾了今日的锦鲤福气不成？',
        '小女子只愿长伴公子左右，为您执牌添香。',
      ],
      cheer: [
        '风起云涌之际，正是公子大展宏图之时，奴家为您祈福。',
        '胜负乃兵家常事，公子运筹帷幄，定能反败为胜！',
        '愿鸿运如春风拂面，助公子一举夺魁！',
      ],
      win: [
        '恭贺公子大获全胜！真乃当世奇才，令人仰慕不已。',
        '满堂喝彩皆为公子而鸣，今夜当浮一大白！',
        '谈笑间强敌灰飞烟灭，公子果真有大将之风！',
      ],
    },
  },
  {
    id: 'gyaru',
    name: '辣妹派对甜心',
    tagline: '“哈喽帅哥！今天这把超赞的耶，直接All-in冲鸭！”',
    requiredAffection: 8000,
    voiceConfig: { pitch: 1.28, rate: 1.18 },
    quotes: {
      idle: [
        '哈喽帅哥！今天这把超赞的耶，直接全押冲鸭！',
        '哇塞今天的场子超嗨的！快坐过来跟人家一起炸翻全场啦！',
        '别磨蹭啦亲爱的，趁热打铁赶紧来一把超级刺激的！',
      ],
      touch: [
        '诶嘿嘿，帅哥你也太主动了吧，人家超喜欢这种直球耶！',
        '哇哦，你手气这么烫，快把好运传给人家一点嘛！',
        '讨厌啦，再撩人家的话，今晚的派对账单可要你请客咯！',
      ],
      cheer: [
        '冲鸭冲鸭！气势不能输，这把绝对爆大金！',
        '相信姐的第六感，今天你就是全场最靓的仔！',
        '稳住别怂！大不了赢了人家请你喝香槟塔！',
      ],
      win: [
        '耶！！超炸裂的胜利！帅哥你简直帅到发光耶！',
        '哇塞赢麻了赢麻了！快击个掌，今晚不醉不归！',
        '全场最佳MVP就是你啦，爱丽丝为你疯狂打call！',
      ],
    },
  },
  {
    id: 'cyber',
    name: '赛博机械姬',
    tagline: '“正在测算胜率矩阵……当前胜率 98.7%。”',
    requiredAffection: 10000,
    voiceConfig: { pitch: 0.96, rate: 1.1 },
    quotes: {
      idle: [
        '正在测算环境胜率矩阵……当前胜率预估：百分之九十八点七。',
        '量子发牌算法已加载完毕，随机数种子完美熵增。',
        '指挥官，爱丽丝已与您的脑波神经元完成共振同步。',
      ],
      touch: [
        '警报：检测到体表微电荷接触，核心温度上升零点八度。',
        '感知回路过载……警告，情感模块发生异常心跳频率。',
        '指令已确认，执行亲密度上升程序：好感度加九百九十九。',
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
  {
    id: 'maid',
    name: '忠犬贴身女仆',
    tagline: '“主人大人辛苦了，女仆艾莉丝随时听候您的差遣！”',
    requiredAffection: 12000,
    voiceConfig: { pitch: 1.2, rate: 1.02 },
    quotes: {
      idle: [
        '欢迎回来，主人大人！女仆艾莉丝已经为您整理好幸运牌桌了。',
        '主人大人辛苦了，请品尝热茶，接下来的发牌全交给艾莉丝吧。',
        '无论主人大人想玩哪一款游戏，艾莉丝都会寸步不离地侍奉左右！',
      ],
      touch: [
        '哇呀！主、主人大人，现在还在工作时间呢……不过如果是主人的命令就可以哦。',
        '摸摸头什么的……艾莉丝最喜欢主人大人的温柔了！',
        '只要主人大人开心，艾莉丝做什么都愿意的！',
      ],
      cheer: [
        '主人大人一定可以的！艾莉丝会把所有的幸运祝福都献给您！',
        '请主人大人放心出牌，您永远是艾莉丝心中最伟大的王者！',
        '加油哦主人大人，赢了的话艾莉丝为您准备了特别惊喜！',
      ],
      win: [
        '恭喜主人大人凯旋而归！艾莉丝为您感到无比自豪！',
        '主人大人太厉害了！这些筹码全都由艾莉丝为您妥善收好！',
        '完美无瑕的胜利！请让艾莉丝为您捶捶肩庆祝一下吧！',
      ],
    },
  },
  {
    id: 'catgirl',
    name: '软萌粘人猫娘',
    tagline: '“喵呜~ 主人摸摸头，幸运小鱼干和好牌都送给你喵~”',
    requiredAffection: 15000,
    voiceConfig: { pitch: 1.42, rate: 1.1 },
    quotes: {
      idle: [
        '喵呜~ 主人终于来陪猫娘玩啦，人家等得好想你喵！',
        '摇摇尾巴施展猫咪魔法，好牌快快飞到主人手里喵~',
        '主人今天要是赢了大筹码，记得买小鱼干奖励猫娘喵！',
      ],
      touch: [
        '呼噜呼噜~ 耳朵后面最舒服了，主人不要停继续摸喵~',
        '喵呀！不可以拽尾巴啦，会变得奇怪的喵！',
        '蹭蹭主人的手心，猫娘的幸运气息全都沾到你身上啦喵~',
      ],
      cheer: [
        '猫娘的肉垫拍拍牌桌，霉运统统走开，好运快来喵！',
        '主人加油喵！把对面那些大坏蛋的筹码全都抢过来！',
        '喵呜~ 猫娘闻到了大胜的味道，这把绝对稳赢喵！',
      ],
      win: [
        '好耶好耶！主人超级无敌厉害喵！猫娘要跳进主人怀里转圈圈！',
        '大丰收大丰收！今晚可以吃十份豪华金枪鱼罐头啦喵！',
        '不愧是猫娘最崇拜的主人，赢牌的样子帅呆了喵~',
      ],
    },
  },
  {
    id: 'cantonese',
    name: '港风赌场大姐大',
    tagline: '“靓仔唔使惊，呢把听姐一句，稳阵到爆！”',
    requiredAffection: 18000,
    voiceConfig: { pitch: 0.94, rate: 1.08 },
    quotes: {
      idle: [
        '靓仔唔使惊，呢把听姐一句，稳阵到爆，今晚饮香槟啦！',
        '欢迎光临顶级贵宾厅！老板今日红光满面，一看就知要大杀四方！',
        '买定离手呀靓仔，机遇唔等人，够胆就落重注！',
      ],
      touch: [
        '喂喂喂，靓仔手多多啊，赢咗钱先请姐食宵夜啦！',
        '哈哈，够胆色！我就钟意你呢种有型有款的潇洒哥！',
        '唔好净系望住姐啦，睇清楚桌上面张牌先好落注呀！',
      ],
      cheer: [
        '顶住啊靓仔！输赢一瞬间，心态稳就一定反杯赢大钱！',
        '呢把牌面靓到震，听我话，放胆同佢搏一铺！',
        '全港九最旺的手气今日都在你身上，冲过去赢晒佢！',
      ],
      win: [
        '犀利呀老板！通杀全场，真系赌神降临冇得顶！',
        '哇塞！呢铺赚到盆满钵满，开支最贵的拉菲庆祝下先！',
        '服咗你啦靓仔！今晚澳门风云榜榜首肯定写你个名！',
      ],
    },
  },
  {
    id: 'sichuan',
    name: '川渝火辣甜妹',
    tagline: '“帅哥莫慌嘛，这把牌巴适得板，直接干翻全场！”',
    requiredAffection: 22000,
    voiceConfig: { pitch: 1.18, rate: 1.14 },
    quotes: {
      idle: [
        '帅哥莫慌嘛，这把牌巴适得板！直接干翻全场要得不嘛！',
        '来咯来咯，老板快坐下，妹儿给你发几张安逸惨了的好牌！',
        '今天手气烫得跟火锅一样，不赢个几万筹码都对不起自己哦！',
      ],
      touch: [
        '哎呀你个瓜娃子，乱戳啥子嘛，把人家都逗笑咯！',
        '要得要得，你再这么撩我，我可要给你发一把天胡咯！',
        '帅哥嘴巴甜手气也甜，难怪大家都喜欢跟你打牌嘛！',
      ],
      cheer: [
        '雄起雄起！莫怕输，大不了下一把加倍赢回来就是咯！',
        '相信妹儿的眼光，这把牌绝对稳起，狠狠给他们上一课！',
        '拿出点气势来嘛帅哥，把对面全部整懵！',
      ],
      win: [
        '巴适得板！老板你太安逸咯，赢这么多必须请吃老火锅！',
        '哇噻，直接把全场刮干净咯，不愧是咱们的牌桌一哥！',
        '漂亮漂亮！这一把打得简直神仙下凡，妹儿给你点一万个赞！',
      ],
    },
  },
  {
    id: 'whisper',
    name: '魅惑夜色低语',
    tagline: '“夜深了……赢完这最后一把，留下来只陪我一个人好吗~”',
    requiredAffection: 28000,
    voiceConfig: { pitch: 0.86, rate: 0.84 },
    quotes: {
      idle: [
        '夜深了……要不要赢完这最后一把，留下来只陪我一个人呢？',
        '灯光有些微醺呢……靠近一点，让我悄悄告诉你下一张牌的秘密。',
        '筹码碰撞的声音很迷人，但远不及你专注看着我时的眼神。',
      ],
      touch: [
        '嗯哼……指尖的温度好烫，你是在试探我的底线吗？',
        '别那么急嘛……好戏和奖赏，总是要留到夜最深的时候。',
        '呵，真拿你没办法……既然被你抓住了，今晚我都听你的。',
      ],
      cheer: [
        '闭上眼睛感受心跳，我会把整夜的幸运都轻吻在你的牌面上。',
        '大胆去赢吧，亲爱的，我会在终点张开双臂迎接你。',
        '这一注，赌的是你的魅力，也是我为你倾倒的心意哦。',
      ],
      win: [
        '赢了呢……不愧是能征服全场的男人，现在，你想要什么奖励？',
        '香槟已经冰好了，这夜色和胜利，全都属于你一个人。',
        '迷人的胜利，迷人的你……今夜注定让人沉醉不愿醒来。',
      ],
    },
  },
];
