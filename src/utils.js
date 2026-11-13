'use strict';
const config = require('./config');

/** Экранирование текста для HTML-разметки Telegram */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Дата в виде 19.10.2026 14:30 в часовом поясе из конфига */
function fmtDate(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: config.timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

/** @username, либо имя, либо id — для отображения "кем забронирован/выдан" */
function mention(tgId, username, fullName) {
  if (username) return '@' + username;
  if (fullName) return escapeHtml(fullName);
  if (tgId) return `user ${tgId}`;
  return '—';
}

/**
 * Человек из строки аккаунта: person(acc, 'reserved') → @user / имя / —
 * Работает для полей reserved_*, issued_*, returned_*, created_*
 * (подставляются через JOIN: <prefix>_username, <prefix>_name, <prefix>_by)
 */
function person(acc, prefix) {
  const tgId = acc[`${prefix}_by`];
  if (!tgId) return '—';
  return mention(tgId, acc[`${prefix}_username`], acc[`${prefix}_name`]);
}

/** Время действия из поля <prefix>_at */
function timeOf(acc, prefix) {
  return acc[`${prefix}_at`] ? fmtDate(acc[`${prefix}_at`]) : '';
}

module.exports = { escapeHtml, fmtDate, mention, person, timeOf };
