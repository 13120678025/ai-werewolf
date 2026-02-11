const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

async function fixDB() {
  console.log('🗑️ 正在删除旧表...');
  try {
    await pool.query('DROP TABLE IF EXISTS ai_game_messages CASCADE');
    await pool.query('DROP TABLE IF EXISTS ai_game_players CASCADE');
    await pool.query('DROP TABLE IF EXISTS ai_games CASCADE');
    await pool.query('DROP TABLE IF EXISTS ai_players CASCADE');
    console.log('✅ 旧表已删除！');
    console.log('');
    console.log('💡 现在请重新启动 server.js：');
    console.log('   node server.js');
    console.log('');
    console.log('然后访问 http://localhost:8090 即可！');
  } catch (e) {
    console.error('❌ 错误:', e.message);
  }
  process.exit(0);
}

fixDB();
