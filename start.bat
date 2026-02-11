@echo off
chcp 65001 >nul
echo 🗑️ 正在清理旧数据库...
node -e "const { Pool } = require('pg'); require('dotenv').config(); const pool = new Pool({ connectionString: process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false } }); pool.query('DROP TABLE IF EXISTS ai_game_messages CASCADE').then(() => pool.query('DROP TABLE IF EXISTS ai_game_players CASCADE')).then(() => pool.query('DROP TABLE IF EXISTS ai_games CASCADE')).then(() => pool.query('DROP TABLE IF EXISTS ai_players CASCADE')).then(() => { console.log('✅ 清理完成！现在启动服务器...'); }).catch(e => { console.error('错误:', e.message); });"
echo.
echo 🚀 启动服务器...
node server.js
