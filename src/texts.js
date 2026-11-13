'use strict';
const { escapeHtml, fmtDate, mention, person, timeOf } = require('./utils');

const STATUS = {
  free: { emoji: '🟢', label: 'Свободный' },
  reserved: { emoji: '🟡', label: 'Забронирован' },
  issued: { emoji: '🔵', label: 'Выдан' },
  returned: { emoji: '🟣', label: 'Возвращён' },
  blocked: { emoji: '🔴', label: 'Заблокирован' },
};

const FILTERS_RU = {
  all: '📋 Все',
  free: '🟢 Свободные',
  reserved: '🟡 Забронированные',
  issued: '🔵 Выданные',
  returned: '🟣 Возвращённые',
  blocked: '🔴 Заблокированные',
  mine: '👤 Мои',
};

/** Типы подписки (последний пункт «Другое» — свой ввод) */
const SUBS = ['Free', 'Pro', 'Max 5x', 'Max 20x', 'Team', 'Другое'];

const ACTIONS_RU = {
  created: '➕ добавил(а) аккаунт',
  reserved: '🎫 забронировал(а)',
  took: '⚡ взял(а) сразу (сразу выдан)',
  issued: '💳 выдал(а) себе',
  unreserved: '❌ снял(а) бронь',
  returned: '↩️ вернул(а) аккаунт',
  opened: '♻️ открыл(а) как свободный',
  blocked: '⛔️ заблокировал(а)',
  deleted: '🗑 удалил(а) аккаунт',
};

/** Главное меню */
function menuText(counts) {
  return [
    '🗂 <b>Учёт аккаунтов Claude</b>',
    '',
    `Всего: <b>${counts.total}</b>  ·  🟢 ${counts.free}  ·  🟡 ${counts.reserved}  ·  🔵 ${counts.issued}`,
    `🟣 ${counts.returned}  ·  🔴 ${counts.blocked}`,
    '',
    '<i>Выберите действие кнопками ниже.</i>',
  ].join('\n');
}

/** Карточка аккаунта */
function cardText(acc, { showPassword = false } = {}) {
  const st = STATUS[acc.status] || { emoji: '❔', label: acc.status };
  const lines = [
    `🎫 <b>Аккаунт #${acc.id}</b>  —  ${st.emoji} <b>${st.label}</b>`,
    '',
    `📧 Почта: <code>${escapeHtml(acc.email)}</code>`,
    `🔑 Пароль: ${
      showPassword ? `<code>${escapeHtml(acc.password)}</code>` : '•••••••• <i>(нажмите «Показать пароль»)</i>'
    }`,
    `💳 Подписка: <b>${escapeHtml(acc.sub)}</b>`,
    `📅 Добавлен: ${fmtDate(acc.created_at)}`,
    `👤 Добавил: ${person(acc, 'created')}`,
    '',
    `🎫 Кем забронирован: <b>${person(acc, 'reserved')}</b>${timeOf(acc, 'reserved') ? `  <i>${timeOf(acc, 'reserved')}</i>` : ''}`,
    `💳 Кем выдан: <b>${person(acc, 'issued')}</b>${timeOf(acc, 'issued') ? `  <i>${timeOf(acc, 'issued')}</i>` : ''}`,
  ];
  if (acc.status === 'returned' || acc.returned_by) {
    lines.push(
      `↩️ Кем возвращён: <b>${person(acc, 'returned')}</b>${timeOf(acc, 'returned') ? `  <i>${timeOf(acc, 'returned')}</i>` : ''}`
    );
  }
  return lines.join('\n');
}

/** Строка списка */
function listLine(acc) {
  const st = STATUS[acc.status] || { emoji: '❔' };
  let line = `#${acc.id} ${st.emoji} <code>${escapeHtml(acc.email)}</code> · ${escapeHtml(acc.sub)}`;
  if (acc.status === 'reserved' && acc.reserved_by) line += ` → ${person(acc, 'reserved')}`;
  if (acc.status === 'issued' && acc.issued_by) line += ` → ${person(acc, 'issued')}`;
  return line;
}

/** Список аккаунтов (с пагинацией) */
function listText(filter, accounts, page, pages, total) {
  const title = FILTERS_RU[filter] || filter;
  const lines = [`<b>${title}</b>  ·  всего: <b>${total}</b>`];
  if (filter === 'free') {
    lines.push('<i>Нажмите на аккаунт, чтобы забронировать или взять сразу.</i>');
  } else if (filter === 'mine') {
    lines.push('<i>Аккаунты, которые вы забронировали или вам выданы.</i>');
  }
  lines.push('');
  if (!accounts.length) lines.push('Пока пусто 🙈');
  else accounts.forEach((a) => lines.push(listLine(a)));
  lines.push('', `<i>Страница ${page + 1} из ${pages}</i>`);
  return lines.join('\n');
}

/** Результаты поиска */
function searchText(query, accounts) {
  const lines = [`🔍 Поиск: <code>${escapeHtml(query)}</code> · найдено: <b>${accounts.length}</b>`, ''];
  if (!accounts.length) lines.push('Ничего не найдено 🙈');
  else accounts.forEach((a) => lines.push(listLine(a)));
  return lines.join('\n');
}

/** История действий по аккаунту */
function logText(acc, entries) {
  const lines = [`🕘 <b>История аккаунта #${acc.id}</b>`, `📧 <code>${escapeHtml(acc.email)}</code>`, ''];
  if (!entries.length) lines.push('Записей нет.');
  for (const e of entries) {
    const who = mention(e.actor, e.username, e.full_name);
    const action = ACTIONS_RU[e.action] || e.action;
    lines.push(`${fmtDate(e.created_at)} — ${who}: ${action}`);
  }
  return lines.join('\n');
}

/** Статистика */
function statsText(counts, subs) {
  const lines = [
    '📊 <b>Статистика</b>',
    '',
    `Всего аккаунтов: <b>${counts.total}</b>`,
    `🟢 Свободных: <b>${counts.free}</b>`,
    `🟡 Забронировано: <b>${counts.reserved}</b>`,
    `🔵 Выдано: <b>${counts.issued}</b>`,
    `🟣 Возвращено: <b>${counts.returned}</b>`,
    `🔴 Заблокировано: <b>${counts.blocked}</b>`,
  ];
  if (subs.length) {
    lines.push('', '<b>По подпискам:</b>');
    for (const s of subs) lines.push(`  · ${escapeHtml(s.sub)} — ${s.c}`);
  }
  return lines.join('\n');
}

/** Экран «Пользователи» (только админ) */
function usersText(users) {
  const lines = ['👥 <b>Команда селлеров</b>', ''];
  if (!users.length) lines.push('Пользователей нет.');
  for (const u of users) {
    const role = u.role === 'admin' ? '👑 админ' : '🛒 селлер';
    lines.push(`${mention(u.tg_id, u.username, u.full_name)} — ${role}`);
  }
  return lines.join('\n');
}

function userCardText(u) {
  return [
    `👤 <b>Пользователь</b>`,
    '',
    `Имя: ${mention(u.tg_id, u.username, u.full_name)}`,
    `ID: <code>${u.tg_id}</code>`,
    `Роль: ${u.role === 'admin' ? '👑 админ' : '🛒 селлер'}`,
    `В боте с: ${fmtDate(u.created_at)}`,
  ].join('\n');
}

const helpText = [
  'ℹ️ <b>Как это работает</b>',
  '',
  '1. Добавляйте аккаунты кнопкой «➕ Добавить аккаунт».',
  '2. Берите свободный аккаунт: «🎫 Забронировать» или сразу «⚡ Взять».',
  '3. Забронированный аккаунт можно «💳 Выдать себе».',
  '4. Использованный аккаунт «↩️ Вернуть» — он станет возвращённым.',
  '5. Возвращённый аккаунт открывается обратно в «Свободный».',
  '',
  'Взять/забронировать можно только аккаунт со статусом 🟢 свободный или 🟡 забронированный (свою бронь).',
  '',
  '<b>Команды:</b> /menu — меню, /add — добавить, /find — поиск, /stats — статистика, /cancel — отменить ввод, /id — свой Telegram ID.',
].join('\n');

module.exports = {
  STATUS,
  FILTERS_RU,
  SUBS,
  ACTIONS_RU,
  menuText,
  cardText,
  listText,
  searchText,
  logText,
  statsText,
  usersText,
  userCardText,
  helpText,
};
