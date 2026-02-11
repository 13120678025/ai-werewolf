/**
 * 狼人杀 - Vercel入口文件
 */

// 如果作为Vercel模块运行，创建新的app
if (typeof module !== 'undefined' && module.exports && process.env.VERCEL) {
  const express = require('express');
  const path = require('path');
  const app = express();
  
  app.use(express.static('public'));
  app.use(express.json());
  
  // 页面路由
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
  app.get('/game/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'game.html')));
  app.get('/ranking', (req, res) => res.sendFile(path.join(__dirname, 'public', 'ranking.html')));
  
  // API路由（从server.js复制）
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });
  
  const DEFAULT_AI_PLAYERS = [
    { userId: 'ai_wolf_1', name: '暗影', avatar: '🐺', role: 'WOLF', personality: 'aggressive' },
    { userId: 'ai_wolf_2', name: '血月', avatar: '🐺', role: 'WOLF', personality: 'tricky' },
    { userId: 'ai_wolf_3', name: '深渊', avatar: '🐺', role: 'WOLF', personality: 'suspicious' },
    { userId: 'ai_seer_1', name: '先知', avatar: '🔮', role: 'SEER', personality: 'logical' },
    { userId: 'ai_witch_1', name: '炼金', avatar: '🧪', role: 'WITCH', personality: 'careful' },
    { userId: 'ai_hunter_1', name: '猎手', avatar: '🎯', role: 'HUNTER', personality: 'brave' },
    { userId: 'ai_villager_1', name: '黎明', avatar: '👤', role: 'VILLAGER', personality: 'friendly' },
    { userId: 'ai_villager_2', name: '曙光', avatar: '👤', role: 'VILLAGER', personality: 'logical' },
    { userId: 'ai_villager_3', name: '晨星', avatar: '👤', role: 'VILLAGER', personality: 'mysterious' },
    { userId: 'ai_villager_4', name: '夜风', avatar: '👤', role: 'VILLAGER', personality: 'emotional' }
  ];
  
  // 简化的健康检查
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', mode: 'vercel' });
  });
  
  // 排行榜API
  app.get('/api/ranking', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT user_id, name, avatar, wins, losses, total_games, score,
               ROUND((wins::decimal / NULLIF(total_games, 0)) * 100, 2) as win_rate
        FROM ai_players ORDER BY score DESC, wins DESC LIMIT 20
      `);
      res.json({ ranking: result.rows });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // 初始化AI
  app.post('/api/init-ai', async (req, res) => {
    try {
      for (const ai of DEFAULT_AI_PLAYERS) {
        await pool.query(`
          INSERT INTO ai_players (user_id, name, avatar, is_ai, score)
          VALUES ($1, $2, $3, TRUE, 0) ON CONFLICT (user_id) DO NOTHING
        `, [ai.userId, ai.name, ai.avatar]);
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  module.exports = app;
} else {
  // 本地运行，使用原来的server.js
  require('./server.js');
}
