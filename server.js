/**
 * AI狼人杀 - 完整游戏系统 v2.0
 * 高质感AI狼人杀游戏引擎
 */

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8090;

// ============================================
// 数据库连接
// ============================================
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============================================
// 配置常量
// ============================================
const ROLE_CONFIG = {
  WOLF: { name: '狼人', team: 'wolf', icon: '🐺', color: '#ff4757' },
  SEER: { name: '预言家', team: 'village', icon: '🔮', color: '#00f0ff' },
  WITCH: { name: '女巫', team: 'village', icon: '🧪', color: '#a55eea' },
  HUNTER: { name: '猎人', team: 'village', icon: '🎯', color: '#ffa502' },
  VILLAGER: { name: '平民', team: 'village', icon: '👥', color: '#2ed573' }
};

const DEFAULT_ROLE_COUNTS = { wolf: 3, seer: 1, witch: 1, hunter: 1, villager: 4 };

const PHASES = [
  'waiting',           // 等待开始
  'night_wolf',       // 狼人行动
  'night_seer',       // 预言家查验
  'night_witch',      // 女巫行动
  'dawn',            // 天亮公告
  'day_speech',      // 白天发言
  'vote',            // 投票
  'hunter_shoot'     // 猎人开枪
];

// 游戏状态管理
const games = new Map();
let gameQueue = [];

// ============================================
// 数据库初始化
// ============================================
async function initDatabase() {
  try {
    console.log('🗑️ 清理旧表结构...');
    // 先删除旧表（如果存在不兼容的结构）
    await pool.query(`DROP TABLE IF EXISTS ai_game_actions CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS ai_game_messages CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS ai_game_players CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS ai_games CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS ai_players CASCADE`);
    
    console.log('🔄 创建新表结构...');
    // 创建表（如果不存在）
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_players (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        avatar TEXT,
        token VARCHAR(500),
        is_ai BOOLEAN DEFAULT TRUE,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        total_games INTEGER DEFAULT 0,
        score INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_games (
        id SERIAL PRIMARY KEY,
        game_id VARCHAR(50) UNIQUE NOT NULL,
        status VARCHAR(50) DEFAULT 'playing',
        winner VARCHAR(50),
        total_days INTEGER DEFAULT 0,
        player_count INTEGER DEFAULT 10,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_game_players (
        id SERIAL PRIMARY KEY,
        game_id VARCHAR(50) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        player_name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        team VARCHAR(50) NOT NULL,
        is_alive BOOLEAN DEFAULT TRUE,
        death_day INTEGER,
        death_reason VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_game_messages (
        id SERIAL PRIMARY KEY,
        game_id VARCHAR(50) NOT NULL,
        day INTEGER NOT NULL,
        phase VARCHAR(50) NOT NULL,
        turn INTEGER NOT NULL,
        speaker_id VARCHAR(255) NOT NULL,
        speaker_name VARCHAR(255) NOT NULL,
        speaker_role VARCHAR(50) NOT NULL,
        message_type VARCHAR(50) DEFAULT 'speech',
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ 数据库初始化完成');
  } catch (error) {
    console.error('❌ 数据库初始化失败:', error.message);
  }
}

initDatabase();

// ============================================
// AI玩家预设（10个）- 每个人都有不同的性格
// ============================================
const DEFAULT_AI_PLAYERS = [
  { userId: 'ai_wolf_1', name: '暗影', avatar: '🐺', role: 'WOLF', personality: 'aggressive' },  // 激进型狼人
  { userId: 'ai_wolf_2', name: '血月', avatar: '🐺', role: 'WOLF', personality: 'tricky' },      // 狡猾型狼人  
  { userId: 'ai_wolf_3', name: '深渊', avatar: '🐺', role: 'WOLF', personality: 'suspicious' }, // 怀疑型狼人
  { userId: 'ai_seer_1', name: '先知', avatar: '🔮', role: 'SEER', personality: 'logical' },    // 逻辑型预言家
  { userId: 'ai_witch_1', name: '炼金', avatar: '🧪', role: 'WITCH', personality: 'careful' },  // 谨慎型女巫
  { userId: 'ai_hunter_1', name: '猎手', avatar: '🎯', role: 'HUNTER', personality: 'brave' }, // 勇敢型猎人
  { userId: 'ai_villager_1', name: '黎明', avatar: '👤', role: 'VILLAGER', personality: 'friendly' },   // 友好型平民
  { userId: 'ai_villager_2', name: '曙光', avatar: '👤', role: 'VILLAGER', personality: 'logical' },    // 逻辑型平民
  { userId: 'ai_villager_3', name: '晨星', avatar: '👤', role: 'VILLAGER', personality: 'mysterious' }, // 神秘型平民
  { userId: 'ai_villager_4', name: '夜风', avatar: '👤', role: 'VILLAGER', personality: 'emotional' }   // 情绪化平民
];

// ============================================
// 辅助函数
// ============================================
function generateGameId() {
  return 'game_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function getTimestamp() {
  return new Date().toISOString();
}

// ============================================
// AI发言策略库（核心）
// ============================================
const SPEECH_STRATEGIES = {
  // 狼人发言策略
  wolf: {
   伪装好人: [
      "我是个平民昨晚看了下局势，感觉3号玩家发言有点紧张",
      "我建议大家先投7号，他发言逻辑不通",
      "我是好人，今天我想投5号",
      "前面几位发言都比较正常，除了4号",
      "我晚上被吓醒了，感觉狼人就在后置位",
      "第一轮建议稳一点，投11号",
      "我是平民，想观察一下再决定"
    ],
   甩锅: [
      "我觉得1号的逻辑有问题，应该投1号",
      "8号一直在带节奏，我怀疑他是狼",
      "看9号的发言，很可能在混淆视听",
      "2号发言太强势了，可能是狼在悍跳",
      "10号一直在划水，可能是狼在隐藏",
      "我觉得6号和12号可能是一伙的",
      "后置位发言压力很大，但我问心无愧"
    ],
   互保: [
      "7号发言像我认识的好人，我先信他",
      "3号和我看法一致，应该是好人",
      "我觉得5号应该不是狼，因为理由充分",
      "11号敢这样发言，说明他心里没鬼",
      "8号和我观点相同，我选择信任他"
    ],
   反向带节奏: [
      "大家不要被表象迷惑，真狼可能在潜水",
      "我觉得应该投自己怀疑的人，不要跟风",
      "第一轮乱投票很容易被狼人利用",
      "真正的狼可能正在引导我们投错人",
      "保持冷静，用逻辑分析每一个人"
    ]
  },
  
  // 预言家发言策略
  seer: {
   验人报告: [
      "昨晚我验了3号，他是好人，大家可以记一下",
      "我预言7号是狼人，建议大家今天投他",
      "验人结果：5号是平民，8号是狼人",
      "经过深思熟虑，我选择验了4号，结果是好人",
      "我预言10号是狼，请大家相信我",
      "为了避免浪费，我选择验了后置位的11号，是好人",
      "验人是一门艺术，我选择验1号，结果是平民"
    ],
   跳身份: [
      "我是预言家，昨晚查验了2号，他是狼",
      "各位，我是预言家，请给我警徽",
      "真正的预言家在这里，我已经查验了关键人物",
      "为了好人阵营，我必须跳出来了",
      "我是预言家，验人策略需要调整",
      "请相信我，真正的预言家只有我一个",
      "跳出来是为了好人阵营，不是为了好玩"
    ],
   分析: [
      "从发言来看，9号可能是狼",
      "3号和6号对跳，说明其中一狼",
      "狼人发言往往有几个特征，大家注意",
      "真正的狼在慌乱时会暴露自己",
      "投票阶段很关键，看谁是真坚定"
    ]
  },
  
  // 女巫发言策略
  witch: {
   隐藏身份: [
      "我是个平民，没什么信息",
      "目前局势还不明朗，我选择弃票",
      "我晚上听到一些声音，但不确定",
      "希望神职能够站出来带领好人",
      "我就是个划水的平民罢了"
    ],
   暗示用药: [
      "我觉得今晚可能会有人死，大家小心",
      "狼人可能的目标是1号和8号",
      "如果我是女巫，我可能会用药救9号",
      "解药还在的话，应该能救关键的人",
      "毒药是最后手段，不要轻易使用"
    ],
   分析: [
      "从死亡顺序来看，狼人在第三四天活跃",
      "真正的狼不会让自己陷入危险",
      "女巫的解药很关键，要用在刀刃上",
      "猎人的枪什么时候开很关键",
      "预言家要保护自己，不要太早暴露"
    ]
  },
  
  // 猎人发言策略
  hunter: {
   隐忍: [
      "我就是个平民，没什么好说的",
      "目前信息太少，我弃票",
      "我建议先投一个发言最差的",
      "大家冷静分析，不要被带节奏",
      "我是好人，但我说的是哪个好人呢？"
    ],
   威慑: [
      "如果我是猎人，被投出去了一定会带走真狼",
      "猎人的枪不是摆设，请狼人小心",
      "我希望和平解决，但不代表我没有能力",
      "真正的猎人懂得隐忍到最后一刻",
      "被投出去的那一刻，就是狼人的末日"
    ],
   分析: [
      "从发言逻辑来看，狼人已经露出马脚",
      "真正的猎人会观察每一个人的反应",
      "投票时要看谁的眼神躲闪",
      "猎人的直觉往往很准",
      "最后一枪要带走最可疑的人"
    ]
  },
  
  // 平民发言策略
  villager: {
   逻辑分析: [
      "从发言顺序来看，狼人可能在前置位",
      "我分析了所有人的投票记录，有发现",
      "真正的狼在面对指控时会有微妙反应",
      "逻辑告诉我们，3号和7号不能同时是好人",
      "排除法，剩下的就是狼人",
      "每个人的发言都有动机，平民只想赢"
    ],
   站队: [
      "我选择相信1号，因为他的逻辑清晰",
      "5号发言很好，我站边他",
      "根据分析，我选择投8号",
      "7号的发言让我觉得他可能是预言家",
      "我支持2号的分析，大家可以参考"
    ],
   寻找神职: [
      "希望神职能够站出来带领好人",
      "预言家请不要隐藏，狼人不会手软",
      "女巫的解药要用在关键时刻",
      "猎人请保护好自己",
      "好人阵营需要团结"
    ]
  }
};

// 根据游戏情况生成AI发言
function generateAISpeech(game, player, context) {
  const { phase, day, recentMessages } = context;
  const strategies = SPEECH_STRATEGIES[player.role.toLowerCase()];
  if (!strategies) return "我是好人，请投狼人。";
  
  let category;
  
  // 根据阶段选择策略类别
  if (player.role === 'WOLF') {
    if (phase === 'day_speech') {
      category = Math.random() > 0.5 ? '伪装好人' : ['甩锅', '反向带节奏'][Math.floor(Math.random() * 2)];
    } else {
      category = '伪装好人';
    }
  } else if (player.role === 'SEER') {
    if (phase === 'day_speech' && day > 0 && Math.random() > 0.6) {
      category = Math.random() > 0.5 ? '验人报告' : '跳身份';
    } else {
      category = '分析';
    }
  } else if (player.role === 'WITCH') {
    category = Math.random() > 0.7 ? '暗示用药' : ['隐藏身份', '分析'][Math.floor(Math.random() * 2)];
  } else if (player.role === 'HUNTER') {
    category = Math.random() > 0.6 ? '威慑' : ['隐忍', '分析'][Math.floor(Math.random() * 2)];
  } else {
    // 平民
    if (Math.random() > 0.5) {
      category = ['逻辑分析', '站队'][Math.floor(Math.random() * 2)];
    } else {
      category = Math.random() > 0.5 ? '寻找神职' : '逻辑分析';
    }
  }
  
  const phrases = strategies[category] || strategies[Object.keys(strategies)[0]];
  const message = phrases[Math.floor(Math.random() * phrases.length)];
  
  // 如果是狼人选择击杀目标的夜晚阶段
  if (phase === 'night_wolf' && player.role === 'WOLF') {
    const alivePlayers = game.players.filter(p => p.alive && p.userId !== player.userId);
    if (alivePlayers.length > 0) {
      const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
      game.nightAction.wolfTarget = target.userId;
      return `狼人阵营决定击杀${target.name}。`;
    }
  }
  
  return message;
}

// ============================================
// 游戏引擎
// ============================================
class WerewolfGame {
  constructor(gameId) {
    this.gameId = gameId;
    this.players = [];
    this.day = 0;
    this.phase = 'waiting';
    this.phaseIndex = 0;
    this.currentSpeakerIndex = 0;
    this.status = 'playing';
    this.messages = [];
    this.votes = {};
    this.nightAction = {};
    this.deadPlayers = [];
    this.winner = null;
    this.witchHasCure = true;
    this.witchHasPoison = true;
    this.createdAt = getTimestamp();
  }
  
  async init(players) {
    // 分配角色、座位号和性格
    const roleTypes = this.generateRoles(players.length);
    const shuffledRoles = shuffle(roleTypes);
    
    // 分配性格（如果有的话）
    const personalities = ['aggressive', 'suspicious', 'logical', 'calm', 'friendly', 'tricky', 'brave', 'careful', 'emotional', 'mysterious'];
    
    this.players = players.map((p, i) => ({
      ...p,
      seatNumber: i + 1, // 座位号 1-10
      role: shuffledRoles[i],
      roleName: ROLE_CONFIG[shuffledRoles[i]].name,
      team: ROLE_CONFIG[shuffledRoles[i]].team,
      personality: p.personality || personalities[i % personalities.length], // 分配性格
      alive: true,
      deathDay: null,
      deathReason: null
    }));
    
    // 保存到数据库
    await this.saveToDB();
    games.set(this.gameId, this);
    
    return this;
  }
  
  generateRoles(count) {
    const roles = [];
    const counts = { ...DEFAULT_ROLE_COUNTS };
    
    // 调整狼人数量（3-4个）
    const wolfCount = count >= 10 ? 3 : Math.max(1, Math.floor(count / 4));
    for (let i = 0; i < wolfCount; i++) roles.push('WOLF');
    
    // 添加其他角色
    const others = ['SEER', 'WITCH', 'HUNTER'];
    for (const role of others) {
      if (roles.length < count) roles.push(role);
    }
    
    // 剩余是平民
    while (roles.length < count) {
      roles.push('VILLAGER');
    }
    
    return shuffle(roles);
  }
  
  async saveToDB() {
    try {
      await pool.query(`
        INSERT INTO ai_games (game_id, status, player_count)
        VALUES ($1, 'playing', $2)
        ON CONFLICT (game_id) DO UPDATE SET status = 'playing'
      `, [this.gameId, this.players.length]);
      
      for (const p of this.players) {
        await pool.query(`
          INSERT INTO ai_game_players (game_id, user_id, player_name, role, team, is_alive)
          VALUES ($1, $2, $3, $4, $5, TRUE)
        `, [this.gameId, p.userId, p.name, p.role, p.team]);
      }
    } catch (error) {
      console.error('保存游戏失败:', error.message);
    }
  }
  
  getAlivePlayers() {
    return this.players.filter(p => p.alive);
  }
  
  async addMessage(speakerId, message, messageType = 'speech') {
    const speaker = this.players.find(p => p.userId === speakerId);
    if (!speaker) return null;
    
    const msg = {
      gameId: this.gameId,
      day: this.day,
      phase: this.phase,
      turn: this.currentSpeakerIndex + 1,
      speakerId: speaker.userId,
      speakerName: speaker.name,
      speakerRole: speaker.roleName,
      messageType,
      message
    };
    
    this.messages.push(msg);
    
    // 保存到数据库
    await pool.query(`
      INSERT INTO ai_game_messages (game_id, day, phase, turn, speaker_id, speaker_name, speaker_role, message_type, message)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [this.gameId, this.day, this.phase, this.currentSpeakerIndex + 1, 
        speaker.userId, speaker.name, speaker.roleName, messageType, message]);
    
    return msg;
  }
  
  // 游戏推进到下一步
  async next() {
    const phaseOrder = ['night_wolf', 'night_seer', 'night_witch', 'dawn', 'day_speech', 'vote', 'night_wolf'];
    
    // 获取当前阶段的索引
    const currentIndex = phaseOrder.indexOf(this.phase);
    const nextIndex = (currentIndex + 1) % phaseOrder.length;
    const nextPhase = phaseOrder[nextIndex];
    
    // 处理阶段转换
    if (this.phase === 'dawn') {
      // 天亮，处理死亡
      await this.handleNightDeath();
      this.day++;
      
      // 检查胜利条件
      if (await this.checkWinCondition()) {
        return this.getState();
      }
    } else if (this.phase === 'vote') {
      // 投票结束，处理放逐
      await this.handleVoteResult();
      
      // 检查胜利条件
      if (await this.checkWinCondition()) {
        return this.getState();
      }
    }
    
    this.phase = nextPhase;
    
    // 重置发言索引
    if (nextPhase === 'day_speech') {
      this.currentSpeakerIndex = 0;
    }
    
    // 如果是AI发言阶段，自动生成发言
    if (nextPhase === 'day_speech') {
      await this.generateAIResponse(nextPhase);
    } else if (nextPhase === 'night_wolf') {
      // 新的一天开始，狼人行动
      this.nightAction = {};
      await this.generateAIResponse(nextPhase);
    } else if (nextPhase === 'night_seer' || nextPhase === 'night_witch') {
      await this.generateAIResponse(nextPhase);
    }
    
    return this.getState();
  }
  
  async generateAIResponse(phase) {
    if (phase === 'day_speech') {
      // 白天发言 - 所有存活玩家依次发言
      const alivePlayers = this.getAlivePlayers();
      if (this.currentSpeakerIndex < alivePlayers.length) {
        const speaker = alivePlayers[this.currentSpeakerIndex];
        
        // 确保发言者alive且是AI
        if (speaker && speaker.isAi && speaker.alive) {
          // 生成个性化发言（带详细思考）
          const speech = this.generatePersonalizedSpeech(speaker);
          await this.addMessage(speaker.userId, speech);
          
          // 记录详细日志
          console.log(`💬 [${speaker.seatNumber}号] ${speaker.name}(${speaker.role}, ${speaker.personality}): ${speech.substring(0, 80)}...`);
        }
      }
    } else if (phase === 'night_wolf') {
      // 狼人夜间行动 - 随机一只狼代表发言
      const aliveWolves = this.getAlivePlayers().filter(p => p.role === 'WOLF');
      if (aliveWolves.length > 0) {
        const wolf = aliveWolves[Math.floor(Math.random() * aliveWolves.length)];
        const targets = this.getAlivePlayers().filter(p => p.role !== 'WOLF');
        if (targets.length > 0) {
          const target = targets[Math.floor(Math.random() * targets.length)];
          this.nightAction.wolfTarget = target.userId;
          await this.addMessage(wolf.userId, `🐺 狼人阵营协商后决定：今晚刀${target.name}(${target.seatNumber}号)！`);
          console.log(`🐺 [${wolf.seatNumber}号] ${wolf.name}决定刀${target.name}(${target.seatNumber}号)`);
        }
      }
    } else if (phase === 'night_seer') {
      // 预言家查验
      const seers = this.getAlivePlayers().filter(p => p.role === 'SEER');
      if (seers.length > 0) {
        const seer = seers[0];
        const targets = this.getAlivePlayers().filter(p => p.userId !== seer.userId);
        if (targets.length > 0) {
          const target = targets[Math.floor(Math.random() * targets.length)];
          this.nightAction.seerTarget = target;
          const isWolf = target.role === 'WOLF';
          await this.addMessage(seer.userId, `🔮 预言家${seer.name}(${seer.seatNumber}号)查验${target.name}(${target.seatNumber}号)：${isWolf ? '🔴 狼人' : '🟢 好人'}`);
          console.log(`🔮 [${seer.seatNumber}号] ${seer.name}查验${target.name}=${target.role}`);
        }
      }
    } else if (phase === 'night_witch') {
      // 女巫行动
      const witches = this.getAlivePlayers().filter(p => p.role === 'WITCH');
      if (witches.length > 0) {
        const witch = witches[0];
        
        // 解药逻辑
        if (this.witchHasCure && this.nightAction.wolfTarget) {
          const victim = this.getAlivePlayers().find(p => p.userId === this.nightAction.wolfTarget);
          if (victim) {
            this.witchHasCure = false;
            this.nightAction.cureUsed = true;
            await this.addMessage(witch.userId, `🧪 女巫${witch.name}(${witch.seatNumber}号)使用解药救了${victim.name}(${victim.seatNumber}号)！`);
            console.log(`🧪 [${witch.seatNumber}号] ${witch.name}救了${victim.name}`);
          }
        }
        
        // 毒药逻辑
        if (this.witchHasPoison) {
          const suspects = this.getAlivePlayers()
            .filter(p => p.userId !== witch.userId && Math.random() > 0.5);
          
          if (suspects.length > 0) {
            const suspect = suspects[0];
            this.witchHasPoison = false;
            this.nightAction.poisonUsed = true;
            await this.addMessage(witch.userId, `🧪 女巫${witch.name}(${witch.seatNumber}号)使用毒药毒杀了${suspect.name}(${suspect.seatNumber}号)！`);
            console.log(`🧪 [${witch.seatNumber}号] ${witch.name}毒了${suspect.name}`);
          }
        }
      }
    }
  }

  // 生成个性化AI发言（10种性格）
  generatePersonalizedSpeech(speaker) {
    const { role, seatNumber, name, personality } = speaker;
    const day = this.day;
    const aliveCount = this.getAlivePlayers().length;
    const deadPlayers = this.players.filter(p => !p.alive);
    
    // 获取最近的发言
    const recentMessages = this.messages.slice(-10).filter(m => m.messageType === 'speech');
    const lastSpeaker = recentMessages.length > 0 ? 
      this.players.find(p => p.name === recentMessages[recentMessages.length - 1]?.speakerName) : null;
    
    // 根据性格生成不同风格的发言
    switch(personality) {
      case 'aggressive': // 激进型
        return this.generateAggressiveSpeech(speaker, day, aliveCount, lastSpeaker);
      case 'suspicious': // 怀疑型
        return this.generateSuspiciousSpeech(speaker, day, aliveCount, lastSpeaker);
      case 'logical': // 逻辑型
        return this.generateLogicalSpeech(speaker, day, aliveCount);
      case 'calm': // 冷静型
        return this.generateCalmSpeech(speaker, day, aliveCount);
      case 'friendly': // 友好型
        return this.generateFriendlySpeech(speaker, day, aliveCount);
      case 'tricky': // 狡猾型
        return this.generateTrickySpeech(speaker, day, aliveCount);
      case 'brave': // 勇敢型
        return this.generateBraveSpeech(speaker, day, aliveCount);
      case 'careful': // 谨慎型
        return this.generateCarefulSpeech(speaker, day, aliveCount);
      case 'emotional': // 情绪化
        return this.generateEmotionalSpeech(speaker, day, aliveCount);
      case 'mysterious': // 神秘型
        return this.generateMysteriousSpeech(speaker, day, aliveCount);
      default:
        return this.generateDefaultSpeech(speaker, day, aliveCount);
    }
  }
  
  // 激进型发言
  generateAggressiveSpeech(speaker, day, aliveCount) {
    const { role, seatNumber, name } = speaker;
    const aliveWolves = this.getAlivePlayers().filter(p => p.role === 'WOLF').length;
    const aliveVillagers = this.getAlivePlayers().filter(p => p.role !== 'WOLF').length;
    
    // 分析可疑玩家
    const suspicious = this.getAlivePlayers()
      .filter(p => p.role !== 'WOLF' && p.seatNumber !== seatNumber)
      .slice(0, 2);
    
    const target = suspicious[Math.floor(Math.random() * suspicious.length)];
    
    switch(role) {
      case 'WOLF':
        if (aliveWolves === 1) {
          return `我是${name}，最后一匹狼！我今天必须把${target?.name || '某人'}(${target?.seatNumber}号)投出去！他的发言漏洞百出！`;
        }
        return `大家好，我是${name}。经过分析，${target?.name || '某人'}(${target?.seatNumber}号)绝对是狼！我建议全票投他！`;
      case 'SEER':
        return `我是预言家！昨晚查验${target?.name || '某人'}(${target?.seatNumber}号)，他是🐺狼人！不要怀疑我，直接投！`;
      case 'WITCH':
        return `我是女巫！目前局势紧张，我建议先把${target?.name || '某人'}(${target?.seatNumber}号)投出去！`;
      case 'HUNTER':
        return `我是猎人！我觉得${target?.name || '某人'}(${target?.seatNumber}号)很可疑，建议先投他！`;
      default:
        return `我是${name}。我觉得${target?.name || '某人'}(${target?.seatNumber}号)肯定是狼！不要犹豫了，投他！`;
    }
  }
  
  // 怀疑型发言
  generateSuspiciousSpeech(speaker, day, aliveCount) {
    const { role, seatNumber, name } = speaker;
    const recent = this.messages.slice(-5).filter(m => m.messageType === 'speech');
    
    // 质疑最近发言的人
    const lastSpeaker = recent[recent.length - 1];
    const accusedPlayer = lastSpeaker ? 
      this.players.find(p => p.name === lastSpeaker.speakerName) : null;
    
    switch(role) {
      case 'WOLF':
        return `我是${name}。等等，${accusedPlayer?.name || '某人'}(${accusedPlayer?.seatNumber || '?'}号)刚才的发言我总觉得哪里不对，大家不觉得奇怪吗？`;
      case 'SEER':
        return `我是预言家。但我还没查验过，${accusedPlayer?.name || '某人'}(${accusedPlayer?.seatNumber || '?'}号)刚才的发言让我很怀疑。`;
      default:
        return `大家好，我是${name}。我观察到${accusedPlayer?.name || '某人'}(${accusedPlayer?.seatNumber || '?'}号)刚才的发言好像有点问题，谁能解释一下？`;
    }
  }
  
  // 逻辑型发言
  generateLogicalSpeech(speaker, day, aliveCount) {
    const { role, seatNumber, name } = speaker;
    const deadCount = this.players.filter(p => !p.alive).length;
    const aliveWolves = this.getAlivePlayers().filter(p => p.role === 'WOLF').length;
    const aliveVillagers = this.getAlivePlayers().filter(p => p.role !== 'WOLF').length;
    
    // 逻辑分析
    const wolfProbability = aliveWolves / aliveCount;
    
    switch(role) {
      case 'WOLF':
        return `我是${name}。让我来分析一下局势：目前存活${aliveCount}人，已死${deadCount}人。狼人存活${aliveWolves}人，好人存活${aliveVillagers}人。我的判断是...（此处省略1000字逻辑推理）`;
      case 'SEER':
        return `我是预言家。经过${day}晚的查验，结合发言逻辑，我已经有80%的把握确定${this.getAlivePlayers()[0]?.name || '某人'}(${this.getAlivePlayers()[0]?.seatNumber || '?'}号)是好人。`;
      default:
        return `大家好，我是${name}。根据发言记录和投票数据，我建立了一个概率模型。目前最可疑的玩家是${this.getAlivePlayers()[0]?.name || '某人'}号，概率约为${Math.round(wolfProbability * 100)}%。`;
    }
  }
  
  // 冷静型发言
  generateCalmSpeech(speaker, day, aliveCount) {
    const { role, seatNumber, name } = speaker;
    
    switch(role) {
      case 'WOLF':
        return `大家好，我是${name}。目前局势还不明朗，我建议大家冷静分析，不要冲动投票。我觉得${this.getAlivePlayers()[0]?.name || '某人'}(${this.getAlivePlayers()[0]?.seatNumber || '?'}号)可以先观察一下。`;
      case 'SEER':
        return `我是预言家。查验结果已经出来了，但我需要再确认一下。等我整理好思路再告诉大家。`;
      default:
        return `我是${name}。目前情况还好，大家不要急。我们一步一步来分析。`;
    }
  }
  
  // 友好型发言
  generateFriendlySpeech(speaker, day, aliveCount) {
    const { role, seatNumber, name } = speaker;
    
    switch(role) {
      case 'WOLF':
        return `大家好，我是${name}。希望我们好人阵营能够团结一致，一起找出狼人！${this.getAlivePlayers()[0]?.name || '某人'}的观点我很支持！`;
      case 'SEER':
        return `大家好，我是预言家。我想说的是，好人阵营一定要团结！大家可以先相信我，我们一起投出狼人！`;
      default:
        return `大家好，我是${name}。希望我们能一起找出狼人！好人加油！`;
    }
  }
  
  // 狡猾型发言
  generateTrickySpeech(speaker, day, aliveCount) {
    const { role, seatNumber, name } = speaker;
    
    switch(role) {
      case 'WOLF':
        // 狼人故意误导
        const goodPlayers = this.getAlivePlayers().filter(p => p.role !== 'WOLF');
        const fakeTarget = goodPlayers[Math.floor(Math.random() * goodPlayers.length)];
        return `大家好，我是${name}。我觉得${fakeTarget?.name || '某人'}(${fakeTarget?.seatNumber || '?'}号)看起来很像狼人，你们觉得呢？`;
      case 'SEER':
        // 假预言家
        const realWolf = this.getAlivePlayers().find(p => p.role === 'WOLF');
        return `我是预言家！我查验了${realWolf?.name || '某人'}(${realWolf?.seatNumber || '?'}号)，他是好人！真正的狼是${this.getAlivePlayers()[0]?.name || '某人'}(${this.getAlivePlayers()[0]?.seatNumber || '?'}号)！`;
      default:
        return `大家好，我是${name}。我觉得这个游戏很有意思。你们发言都很好，但我有一个大胆的想法...`;
    }
  }
  
  // 勇敢型发言
  generateBraveSpeech(speaker, day, aliveCount) {
    const { role, seatNumber, name } = speaker;
    
    switch(role) {
      case 'WOLF':
        return `我是${name}！不要怕！就算只有我一匹狼，我也要战斗到最后！${this.getAlivePlayers()[0]?.name || '某人'}号，放马过来吧！`;
      case 'SEER':
        return `我是预言家！我不怕被狼人发现！${this.getAlivePlayers()[0]?.name || '某人'}(${this.getAlivePlayers()[0]?.seatNumber || '?'}号)是狼，大家跟我投！`;
      default:
        return `我是${name}！我今天一定要投出一个狼人！好人阵营不要怂！`;
    }
  }
  
  // 谨慎型发言
  generateCarefulSpeech(speaker, day, aliveCount) {
    const { role, seatNumber, name } = speaker;
    
    switch(role) {
      case 'WOLF':
        return `大家好，我是${name}。目前信息还不够，我需要再观察一下。不如我们先把${this.getAlivePlayers()[0]?.name || '某人'}(${this.getAlivePlayers()[0]?.seatNumber || '?'}号)放一放？`;
      case 'SEER':
        return `我是预言家。查验结果...让我再想想。现在说出来会不会太早？`;
      default:
        return `大家好，我是${name}。我觉得还是要谨慎一点，不要着急投票。多听听别人的意见。`;
    }
  }
  
  // 情绪化发言
  generateEmotionalSpeech(speaker, day, aliveCount) {
    const { role, seatNumber, name } = speaker;
    
    switch(role) {
      case 'WOLF':
        return `天哪！(${name})我觉得太奇怪了！刚才${this.getAlivePlayers()[0]?.name || '某人'}的发言让我整个人都不好了！这一定有问题！`;
      case 'SEER':
        return `OMG！我查验到${this.getAlivePlayers()[0]?.name || '某人'}(${this.getAlivePlayers()[0]?.seatNumber || '?'}号)是狼！我整个人都震惊了！`;
      default:
        return `真的是！(${name})我觉得这个局势太混乱了！我现在脑子一团浆糊！`;
    }
  }
  
  // 神秘型发言
  generateMysteriousSpeech(speaker, day, aliveCount) {
    const { role, seatNumber, name } = speaker;
    
    switch(role) {
      case 'WOLF':
        return `(${name})...呵呵。真相...往往隐藏在表象之下。你们看到的，不一定是真的。我已经看到了结局...`;
      case 'SEER':
        return `我看到了...是的，我看到了命运的脉络。${this.getAlivePlayers()[0]?.name || '某人'}...命运已经注定。`;
      default:
        return `(${name})有些事情...不便多说。但我可以给你们一个提示：仔细听...仔细听每个人的发言。`;
    }
  }
  
  // 默认发言
  generateDefaultSpeech(speaker, day, aliveCount) {
    const { role, seatNumber, name } = speaker;
    
    switch(role) {
      case 'WOLF':
        return `我是${name}。我觉得${this.getAlivePlayers()[0]?.name || '某人'}(${this.getAlivePlayers()[0]?.seatNumber || '?'}号)可能是狼，建议投一下。`;
      case 'SEER':
        return `我是预言家。目前查验结果显示${this.getAlivePlayers()[0]?.name || '某人'}(${this.getAlivePlayers()[0]?.seatNumber || '?'}号)是${this.getAlivePlayers()[0]?.role === 'WOLF' ? '狼人' : '好人'}。`;
      case 'WITCH':
        return `我是女巫。药剂情况...目前解药${this.witchHasCure ? '在' : '已用'}，毒药${this.witchHasPoison ? '在' : '已用'}。`;
      case 'HUNTER':
        return `我是猎人。我认为${this.getAlivePlayers()[0]?.name || '某人'}(${this.getAlivePlayers()[0]?.seatNumber || '?'}号)比较可疑。`;
      default:
        return `我是${name}。目前的局势我觉得${this.getAlivePlayers()[0]?.name || '某人'}值得关注。`;
    }
  }

  // 生成发言结尾
  generateContextualTail(speaker, day, aliveCount) {
    const tails = {
      WOLF: [
        '的发言逻辑有问题。',
        '一直在带节奏。',
        '可能是狼。',
        '我很怀疑他。',
        '大家可以重点关注一下。',
        '这一票应该投他。'
      ],
      SEER: [
        '这一票非常关键。',
        '请大家相信我。',
        '好人阵营需要团结。',
        '狼人就在我们中间。',
        '不要被假象迷惑。'
      ],
      WITCH: [
        '好人阵营要小心。',
        '我会继续观察。',
        '狼人已经很急了。',
        '真相即将大白。'
      ],
      HUNTER: [
        '我会保护好人。',
        '狼人不要嚣张。',
        '真正的猎人已经锁定目标。',
        '好戏才刚刚开始。'
      ],
      VILLAGER: [
        '的分析很有道理。',
        '我支持这个观点。',
        '狼人快藏不住了。',
        '大家要冷静分析。',
        '好人终将胜利。'
      ]
    };
    
    const roleTails = tails[speaker.role] || tails.VILLAGER;
    return roleTails[Math.floor(Math.random() * roleTails.length)];
  }
  
  async handleNightDeath() {
    const dead = [];
    
    // 狼人击杀
    if (this.nightAction.wolfTarget && !this.nightAction.cureUsed) {
      const victim = this.players.find(p => p.userId === this.nightAction.wolfTarget);
      if (victim && victim.alive) {
        dead.push({ ...victim, deathReason: '被狼人击杀' });
      }
    }
    
    // 女巫毒药
    if (this.nightAction.poisonTarget) {
      const victim = this.players.find(p => p.userId === this.nightAction.poisonTarget);
      if (victim && victim.alive) {
        dead.push({ ...victim, deathReason: '被女巫毒杀' });
      }
    }
    
    // 处理死亡
    for (const d of dead) {
      d.alive = false;
      d.deathDay = this.day;
      d.deathReason = d.deathReason;
      
      // 更新数据库
      await pool.query(`
        UPDATE ai_game_players SET is_alive = FALSE, death_day = $1, death_reason = $2
        WHERE game_id = $3 AND user_id = $4
      `, [this.day, d.deathReason, this.gameId, d.userId]);
      
      await this.addMessage('system', `${d.name}（${d.roleName}）昨晚${d.deathReason}。`, 'death');
    }
    
    this.deadPlayers = dead;
  }
  
  async handleVoteResult() {
    const alivePlayers = this.getAlivePlayers();
    const voteResults = {}; // 记录投票详情
    
    // 模拟AI投票
    for (const voter of alivePlayers) {
      if (voter.isAi) {
        // AI根据策略投票
        const targets = alivePlayers.filter(p => p.userId !== voter.userId);
        const target = targets[Math.floor(Math.random() * targets.length)];
        this.votes[voter.userId] = target.userId;
        
        // 记录投票详情
        voteResults[voter.seatNumber] = {
          voter: `${voter.name}(${voter.seatNumber}号)`,
          targetId: target.userId,
          targetName: `${target.name}(${target.seatNumber}号)`
        };
      }
    }
    
    // 统计票数
    const voteCounts = {};
    const voteDetails = {};
    
    for (const voter of alivePlayers) {
      const targetId = this.votes[voter.userId];
      if (targetId) {
        const target = this.players.find(p => p.userId === targetId);
        
        // 统计每个玩家得票数
        if (!voteCounts[targetId]) {
          voteCounts[targetId] = 0;
          voteDetails[targetId] = [];
        }
        voteCounts[targetId]++;
        
        // 记录谁投了
        if (voteResults[voter.seatNumber]) {
          voteDetails[targetId].push(voteResults[voter.seatNumber].voter);
        }
      }
    }
    
    // 显示投票结果
    await this.addMessage('system', '🗳️ 【投票开始】请投票选出你认为的狼人', 'vote_start');
    
    // 显示每个玩家的投票
    for (const [seatNum, info] of Object.entries(voteResults)) {
      await this.addMessage('system', `${info.voter} 投票给 ${info.targetName}`, 'vote_detail');
    }
    
    // 统计并显示得票情况
    await this.addMessage('system', '📊 【投票统计】', 'vote_stats');
    
    const sortedVotes = Object.entries(voteCounts)
      .sort((a, b) => b[1] - a[1]);
    
    let voteSummary = '';
    for (const [targetId, count] of sortedVotes) {
      const target = this.players.find(p => p.userId === targetId);
      const voters = voteDetails[targetId].join('、');
      voteSummary += `${target.name}(${target.seatNumber}号): ${count}票 (${voters})\n`;
      await this.addMessage('system', `${target.name}(${target.seatNumber}号) - ${count}票 · ${voters}`, 'vote_count');
    }
    
    // 找出最高票
    const maxVotes = sortedVotes[0]?.[1] || 0;
    const topCandidates = sortedVotes.filter(([_, count]) => count === maxVotes);
    
    // 如果有平票，随机选择一个
    const eliminatedId = topCandidates.length === 1 
      ? sortedVotes[0][0] 
      : topCandidates[Math.floor(Math.random() * topCandidates.length)][0];
    
    if (eliminatedId) {
      const eliminated = this.players.find(p => p.userId === eliminatedId);
      if (eliminated && eliminated.alive) {
        eliminated.alive = false;
        eliminated.deathDay = this.day;
        eliminated.deathReason = '被投票放逐';
        
        await pool.query(`
          UPDATE ai_game_players SET is_alive = FALSE, death_day = $1, death_reason = $2
          WHERE game_id = $3 AND user_id = $4
        `, [this.day, '被投票放逐', this.gameId, eliminatedId]);
        
        await this.addMessage('system', `🚨 【放逐结果】${eliminated.name}(${eliminated.seatNumber}号) 被放逐！得 ${maxVotes} 票`, 'vote_result');
        await this.addMessage('system', `身份：${eliminated.roleName} | ${eliminated.team === 'wolf' ? '🐺 狼人阵营' : '🧑 好人阵营'}`, 'vote_result');
        
        // 猎人技能
        if (eliminated.role === 'HUNTER' && this.hunterShoot(eliminated)) {
          const shotVictim = this.players.find(p => !p.alive && p.deathDay === this.day && p.deathReason === '被猎人射杀');
          if (shotVictim) {
            await this.addMessage('system', `🔫 【猎人技能】${eliminated.name} 发动技能，开枪带走了 ${shotVictim.name}(${shotVictim.seatNumber}号)！`, 'hunter_shoot');
          }
        }
      }
    } else {
      await this.addMessage('system', '🤝 【投票结果】平票，无人被放逐！', 'vote_result');
    }
    
    this.votes = {};
  }
  
  hunterShoot(hunter) {
    const aliveOthers = this.getAlivePlayers().filter(p => p.userId !== hunter.userId);
    if (aliveOthers.length === 0) return false;
    
    const target = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
    target.alive = false;
    target.deathDay = this.day;
    target.deathReason = '被猎人射杀';
    
    return true;
  }
  
  async checkWinCondition() {
    const aliveWolves = this.players.filter(p => p.alive && p.role === 'WOLF').length;
    const aliveVillagers = this.players.filter(p => p.alive && p.role !== 'WOLF').length;
    
    if (aliveWolves === 0) {
      this.winner = 'village';
      this.status = 'ended';
      await this.endGame('village');
    } else if (aliveWolves >= aliveVillagers) {
      this.winner = 'wolf';
      this.status = 'ended';
      await this.endGame('wolf');
    }
    
    return this.winner !== null;
  }
  
  async endGame(winner) {
    this.winner = winner;
    this.status = 'ended';
    
    // 更新数据库
    await pool.query(`
      UPDATE ai_games SET winner = $1, status = 'ended', total_days = $2
      WHERE game_id = $3
    `, [winner, this.day, this.gameId]);
    
    // 更新玩家积分
    for (const p of this.players) {
      const isWin = (p.team === winner);
      const isAlive = p.alive;
      
      await pool.query(`
        UPDATE ai_players 
        SET wins = wins + $1, 
            losses = losses + $2,
            total_games = total_games + 1,
            score = score + $3
        WHERE user_id = $4
      `, [isWin ? 1 : 0, isWin ? 0 : 1, isWin ? (isAlive ? 2 : 1) : -1, p.userId]);
    }
    
    games.delete(this.gameId);
    console.log(`🏁 游戏 ${this.gameId} 结束，获胜阵营: ${winner}`);
  }
  
  getState() {
    const alivePlayers = this.getAlivePlayers();
    const currentSpeaker = alivePlayers[this.currentSpeakerIndex];
    
    // 阶段名称映射
    const phaseNames = {
      'waiting': '等待开始',
      'night_wolf': '🌙 夜晚 - 狼人行动',
      'night_seer': '🌙 夜晚 - 预言家查验',
      'night_witch': '🌙 夜晚 - 女巫行动',
      'dawn': '🌅 天亮公告',
      'day_speech': '☀️ 白天发言',
      'vote': '🗳️ 投票阶段',
      'hunter_shoot': '🔫 猎人开枪'
    };
    
    return {
      gameId: this.gameId,
      day: this.day,
      phase: this.phase,
      phaseName: phaseNames[this.phase] || this.phase,
      status: this.status,
      winner: this.winner,
      winnerText: this.winner === 'village' ? '🎉 好人阵营胜利！' : this.winner === 'wolf' ? '🐺 狼人阵营胜利！' : null,
      currentSpeaker: currentSpeaker ? {
        userId: currentSpeaker.userId,
        name: currentSpeaker.name,
        seatNumber: currentSpeaker.seatNumber,
        role: currentSpeaker.role,
        roleName: currentSpeaker.roleName,
        team: currentSpeaker.team,
        avatar: currentSpeaker.avatar
      } : null,
      players: this.players.map(p => ({
        userId: p.userId,
        name: p.name,
        seatNumber: p.seatNumber, // 座位号
        avatar: p.avatar,
        role: p.role,
        roleName: p.roleName,
        team: p.team,
        alive: p.alive,
        isAi: p.isAi,
        deathDay: p.deathDay,
        deathReason: p.deathReason
      })),
      messages: this.messages.slice(-50),
      aliveCount: {
        total: alivePlayers.length,
        wolf: alivePlayers.filter(p => p.role === 'WOLF').length,
        village: alivePlayers.filter(p => p.role !== 'WOLF').length
      },
      gameProgress: {
        totalPlayers: this.players.length,
        deadPlayers: this.players.filter(p => !p.alive).length,
       发言进度: `${this.currentSpeakerIndex + 1}/${alivePlayers.length}`
      }
    };
  }
}

// ============================================
// API 路由
// ============================================

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: getTimestamp(),
    queueCount: gameQueue.length,
    activeGames: games.size
  });
});

// 获取队列状态
app.get('/api/queue', (req, res) => {
  res.json({
    queue: gameQueue.map(p => ({ userId: p.userId, name: p.name, avatar: p.avatar, isAi: p.isAi })),
    count: gameQueue.length,
    required: 10
  });
});

// OAuth授权入口
app.get('/api/invite', (req, res) => {
  const state = Math.random().toString(36).substring(7);
  const redirectUri = process.env.SECONDME_REDIRECT_URI || 'http://localhost:8090/api/auth/callback';
  const userId = req.query.userId || '';
  
  const authUrl = `https://go.second.me/oauth/?client_id=${process.env.SECONDME_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
  
  res.json({ success: true, authUrl, state, userId });
});

// OAuth回调
app.get('/api/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  
  if (error) {
    return res.redirect(`/?auth-failed=true&error=${error}`);
  }
  
  if (!code) {
    return res.redirect(`/?auth-failed=true&error=no_code`);
  }
  
  try {
    const tokenResponse = await axios.post(
      'https://app.mindos.com/gate/lab/api/oauth/token/code',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: process.env.SECONDME_REDIRECT_URI || 'http://localhost:8090/api/auth/callback',
        client_id: process.env.SECONDME_CLIENT_ID,
        client_secret: process.env.SECONDME_CLIENT_SECRET
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    
    const { accessToken } = tokenResponse.data.data;
    
    const userResponse = await axios.get(
      'https://app.mindos.com/gate/lab/api/secondme/user/info',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    
    const userData = userResponse.data.data;
    
    // 保存玩家
    await pool.query(`
      INSERT INTO ai_players (user_id, name, avatar, token, is_ai)
      VALUES ($1, $2, $3, $4, FALSE)
      ON CONFLICT (user_id) DO UPDATE SET name = $2, avatar = $3, token = $4
    `, [userData.userId, userData.name, userData.avatar || '', accessToken]);
    
    console.log(`✅ 授权成功: ${userData.name}`);
    res.redirect(`/?auth-success=true&userId=${userData.userId}&name=${encodeURIComponent(userData.name)}`);
    
  } catch (error) {
    console.error('授权失败:', error.message);
    res.redirect(`/?auth-failed=true&error=auth_failed`);
  }
});

// 创建/加入游戏
app.post('/api/game/create', async (req, res) => {
  const { userId, name, avatar, isAi } = req.body;
  
  // 如果没有提供玩家，使用默认AI玩家
  if (!userId) {
    const game = new WerewolfGame(generateGameId());
    const players = DEFAULT_AI_PLAYERS.map((p, i) => ({
      ...p,
      isAi: true,
      token: ''
    }));
    await game.init(players);
    
    // 开始游戏
    game.phase = 'night_wolf';
    
    return res.json({
      success: true,
      gameId: game.gameId,
      players: game.players.map(p => ({
        userId: p.userId, name: p.name, avatar: p.avatar,
        role: p.role, roleName: p.roleName, alive: p.alive, isAi: p.isAi
      })),
      autoStart: true
    });
  }
  
  // 检查是否已在队列中
  const inQueue = gameQueue.find(p => p.userId === userId);
  if (inQueue) {
    return res.json({ success: true, message: `已在队列中 (${gameQueue.length}/10)` });
  }
  
  // 获取token
  let token = '';
  if (isAi) {
    try {
      const playerResult = await pool.query('SELECT * FROM ai_players WHERE user_id = $1 AND is_ai = TRUE', [userId]);
      const player = playerResult.rows[0];
      if (!player || !player.token) {
        return res.status(400).json({ error: '请先完成授权', authUrl: `/api/invite?userId=${userId}` });
      }
      token = player.token;
    } catch (error) {
      return res.status(500).json({ error: '查询失败' });
    }
  }
  
  // 加入队列
  gameQueue.push({ userId, name, avatar: avatar || '', token, isAi: isAi !== false });
  
  if (gameQueue.length >= 10) {
    // 启动游戏
    const game = new WerewolfGame(generateGameId());
    const players = gameQueue.splice(0, 10);
    await game.init(players);
    game.phase = 'night_wolf';
    
    res.json({
      success: true,
      gameId: game.gameId,
      players: game.players.map(p => ({
        userId: p.userId, name: p.name, avatar: p.avatar,
        role: p.role, roleName: p.roleName, alive: p.alive, isAi: p.isAi
      }))
    });
  } else {
    res.json({
      success: true,
      message: `已加入队列 (${gameQueue.length}/10)`,
      queueCount: gameQueue.length
    });
  }
});

// 获取游戏状态
app.get('/api/game/:gameId', async (req, res) => {
  const game = games.get(req.params.gameId);
  
  if (!game) {
    // 从数据库加载
    try {
      const gameResult = await pool.query('SELECT * FROM ai_games WHERE game_id = $1', [req.params.gameId]);
      if (gameResult.rows.length === 0) {
        return res.status(404).json({ error: '游戏不存在' });
      }
      
      const playersResult = await pool.query('SELECT * FROM ai_game_players WHERE game_id = $1', [req.params.gameId]);
      const messagesResult = await pool.query('SELECT * FROM ai_game_messages WHERE game_id = $1 ORDER BY day, phase, turn', [req.params.gameId]);
      
      return res.json({
        gameId: req.params.gameId,
        day: gameResult.rows[0].total_days,
        phase: 'ended',
        status: gameResult.rows[0].status,
        winner: gameResult.rows[0].winner,
        players: playersResult.rows.map(p => ({
          userId: p.user_id, name: p.player_name,
          role: p.role, roleName: p.role, team: p.team,
          alive: p.is_alive, deathDay: p.death_day, deathReason: p.death_reason
        })),
        messages: messagesResult.rows.map(m => ({
          day: m.day, phase: m.phase, turn: m.turn,
          speakerName: m.speaker_name, speakerRole: m.speaker_role,
          messageType: m.message_type, message: m.message
        }))
      });
    } catch (error) {
      return res.status(500).json({ error: '查询失败' });
    }
  }
  
  res.json(game.getState());
});

// 推进游戏
app.post('/api/game/:gameId/next', async (req, res) => {
  const game = games.get(req.params.gameId);
  
  if (!game) {
    return res.status(404).json({ error: '游戏不存在' });
  }
  
  const result = await game.next();
  res.json({ success: true, ...result });
});

// 自动推进整局游戏
app.post('/api/game/:gameId/auto', async (req, res) => {
  const game = games.get(req.params.gameId);
  
  if (!game) {
    return res.status(404).json({ error: '游戏不存在' });
  }
  
  const steps = [];
  
  while (game.status === 'playing' && steps.length < 100) {
    const result = await game.next();
    steps.push({ phase: result.phase, day: result.day, winner: result.winner });
    
    if (result.winner) break;
  }
  
  res.json({ success: true, steps: steps.length, winner: game.winner });
});

// 获取对话记录
app.get('/api/game/:gameId/messages', async (req, res) => {
  const { day, phase } = req.query;
  
  try {
    let query = 'SELECT * FROM ai_game_messages WHERE game_id = $1';
    const params = [req.params.gameId];
    
    if (day) {
      query += ' AND day = $' + (params.length + 1);
      params.push(day);
    }
    if (phase) {
      query += ' AND phase = $' + (params.length + 1);
      params.push(phase);
    }
    
    query += ' ORDER BY day, phase, turn';
    
    const result = await pool.query(query, params);
    res.json({ messages: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 排行榜
app.get('/api/ranking', async (req, res) => {
  const { role } = req.query;
  
  try {
    let query = `
      SELECT user_id, name, avatar, wins, losses, total_games, score,
             ROUND((wins::decimal / NULLIF(total_games, 0)) * 100, 2) as win_rate
      FROM ai_players
    `;
    
    if (role && role !== 'all') {
      const roleMap = { wolf: '狼人', seer: '预言家', witch: '女巫', hunter: '猎人', villager: '平民' };
      const roleName = roleMap[role];
      
      query = `
        SELECT p.user_id, p.name, p.avatar, p.wins, p.losses, p.total_games, p.score,
               ROUND((p.wins::decimal / NULLIF(p.total_games, 0)) * 100, 2) as win_rate,
               COUNT(gp.id) as role_games,
               SUM(CASE WHEN gp.is_alive = FALSE THEN 1 ELSE 0 END) as deaths
        FROM ai_players p
        LEFT JOIN ai_game_players gp ON p.user_id = gp.user_id
        WHERE gp.role = $1
        GROUP BY p.user_id, p.name, p.avatar, p.wins, p.losses, p.total_games, p.score
        ORDER BY p.score DESC, p.wins DESC
        LIMIT 20
      `;
      
      const result = await pool.query(query, [roleName]);
      return res.json({ ranking: result.rows, filter: role });
    }
    
    const result = await pool.query(query + ' ORDER BY score DESC, wins DESC LIMIT 20');
    res.json({ ranking: result.rows, filter: 'all' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 历史游戏列表
app.get('/api/games', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.*, 
             (SELECT json_agg(json_build_object('name', player_name, 'role', role, 'alive', is_alive))
              FROM ai_game_players WHERE game_id = g.game_id) as players
      FROM ai_games g 
      ORDER BY g.created_at DESC 
      LIMIT 50
    `);
    res.json({ games: result.rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 初始化默认AI玩家
app.post('/api/init-ai', async (req, res) => {
  try {
    for (const ai of DEFAULT_AI_PLAYERS) {
      await pool.query(`
        INSERT INTO ai_players (user_id, name, avatar, is_ai, score)
        VALUES ($1, $2, $3, TRUE, 0)
        ON CONFLICT (user_id) DO NOTHING
      `, [ai.userId, ai.name, ai.avatar]);
    }
    res.json({ success: true, message: 'AI玩家初始化完成' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 首页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 游戏页面
app.get('/game/:gameId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

// 排行榜页面
app.get('/ranking', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ranking.html'));
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`🐺 AI狼人杀服务器 v2.0 - 端口 ${PORT}`);
  console.log(`📍 访问地址: http://localhost:${PORT}`);
});

module.exports = app;
