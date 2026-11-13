'use strict';
require('dotenv').config();

function parseIds(value) {
  return String(value || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('❌ Не задан BOT_TOKEN. Скопируйте .env.example в .env и заполните его.');
  process.exit(1);
}

const db = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, max: 10 }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 5432),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'claude_accounts',
      max: 10,
    };

module.exports = {
  token,
  adminIds: parseIds(process.env.ADMIN_IDS),
  allowedChatIds: parseIds(process.env.ALLOWED_CHAT_IDS),
  timezone: process.env.TZ || 'Europe/Moscow',
  db,
  perPage: 5,
  isAdmin(tgId) {
    return this.adminIds.includes(Number(tgId));
  },
};
