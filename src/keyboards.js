'use strict';
const { InlineKeyboard } = require('grammy');

/** Главное меню */
function mainMenu(isAdmin) {
  const kb = new InlineKeyboard()
    .text('🎫 Взять аккаунт', 'list:free:0')
    .text('📋 Список', 'list:all:0')
    .row()
    .text('👤 Мои аккаунты', 'list:mine:0')
    .text('📊 Статистика', 'stats')
    .row()
    .text('🔍 Поиск', 'find')
    .text('➕ Добавить аккаунт', 'add')
    .row();
  if (isAdmin) kb.text('👥 Пользователи', 'users').row();
  kb.text('ℹ️ Помощь', 'help').text('🔄 Обновить', 'refresh');
  return kb;
}

const STATUS_ICON = { free: '🟢', reserved: '🟡', issued: '🔵', returned: '🟣', blocked: '🔴' };

/** Список: кнопки-аккаунты + фильтры + пагинация */
function listKb(accounts, filter, page, pages) {
  const kb = new InlineKeyboard();
  for (const a of accounts) {
    kb.text(`${STATUS_ICON[a.status] || '❔'} #${a.id} ${a.email}`, `acc:${a.id}:list:${filter}:${page}`).row();
  }
  kb.text('📋', 'list:all:0')
    .text('🟢', 'list:free:0')
    .text('🟡', 'list:reserved:0')
    .row()
    .text('🔵', 'list:issued:0')
    .text('🟣', 'list:returned:0')
    .text('🔴', 'list:blocked:0')
    .row();
  if (page > 0) kb.text('⬅️', `list:${filter}:${page - 1}`);
  kb.text(`📄 ${page + 1}/${pages}`, 'noop');
  if (page + 1 < pages) kb.text('➡️', `list:${filter}:${page + 1}`);
  kb.row().text('🔍 Поиск', 'find').text('➕ Добавить', 'add').text('🏠 В меню', 'menu');
  return kb;
}

/**
 * Карточка аккаунта: кнопки зависят от статуса, владельца и роли.
 * back — callback-строка «назад» (например list:free:0 или find).
 */
function cardKb(acc, viewerId, isAdmin, back = 'menu') {
  const kb = new InlineKeyboard();
  const mineRes = acc.reserved_by === viewerId;
  const mineIss = acc.issued_by === viewerId;

  if (acc.status === 'free') {
    kb.text('🎫 Забронировать', `res:${acc.id}:${back}`).row()
      .text('⚡ Взять сразу (выдан)', `take:${acc.id}:${back}`).row();
  } else if (acc.status === 'reserved') {
    if (mineRes) {
      kb.text('💳 Выдать себе', `iss:${acc.id}:${back}`).row()
        .text('❌ Снять бронь', `unres:${acc.id}:${back}`).row();
    } else if (isAdmin) {
      kb.text('❌ Снять чужую бронь', `unres:${acc.id}:${back}`).row();
    }
  } else if (acc.status === 'issued') {
    if (mineIss || isAdmin) kb.text('↩️ Вернуть аккаунт', `ret:${acc.id}:${back}`).row();
  } else if (acc.status === 'returned') {
    if (isAdmin || acc.returned_by === viewerId) {
      kb.text('♻️ Сделать свободным', `open:${acc.id}:${back}`).row();
    }
  } else if (acc.status === 'blocked') {
    if (isAdmin) kb.text('♻️ Разблокировать (в свободные)', `open:${acc.id}:${back}`).row();
  }

  if (isAdmin && acc.status !== 'blocked') {
    kb.text('⛔️ Заблокировать', `blk:${acc.id}:${back}`);
  }
  if (isAdmin) {
    kb.text('🗑 Удалить', `del:${acc.id}:${back}`);
    kb.row();
  }

  kb.text('👁 Пароль', `pw:${acc.id}:${back}`)
    .text('🕘 История', `hist:${acc.id}:${back}`)
    .row()
    .text('◀️ Назад', back)
    .text('🏠 Меню', 'menu');
  return kb;
}

/** Подтверждение удаления */
function confirmDeleteKb(id, back) {
  return new InlineKeyboard()
    .text('✅ Да, удалить', `dely:${id}`)
    .text('❌ Нет', `acc:${id}:${back}`);
}

/** Кнопки-аккаунты в результатах поиска */
function searchResultsKb(accounts) {
  const kb = new InlineKeyboard();
  for (const a of accounts) {
    kb.text(`${STATUS_ICON[a.status] || '❔'} #${a.id} ${a.email}`, `acc:${a.id}:find`).row();
  }
  kb.text('🔍 Новый поиск', 'find').text('🏠 Меню', 'menu');
  return kb;
}

/** Кнопки «Отмена» во время пошагового ввода */
const cancelKb = () => new InlineKeyboard().text('✖️ Отмена', 'flowcancel');

/** Выбор типа подписки */
function subKb() {
  const options = require('./texts').SUBS;
  const kb = new InlineKeyboard();
  const list = options.filter((s) => s !== 'Другое');
  list.forEach((sub, i) => {
    kb.text(sub, `sub:${options.indexOf(sub)}`);
    if (i % 2 === 1) kb.row();
  });
  if (list.length % 2 === 0) kb.row();
  kb.text('✍️ Другое (ввести текстом)', 'sub:custom').row()
    .text('✖️ Отмена', 'flowcancel');
  return kb;
}

/** Экран пользователей (админ) */
function usersKb(users) {
  const kb = new InlineKeyboard();
  users.forEach((u, i) => {
    const icon = u.role === 'admin' ? '👑' : '🛒';
    kb.text(`${icon} ${u.username ? '@' + u.username : u.full_name || u.tg_id}`, `usr:${u.tg_id}`);
    if (i % 2 === 1) kb.row();
  });
  if (users.length % 2 === 0) kb.row();
  kb.text('🏠 Меню', 'menu');
  return kb;
}

/** Карточка пользователя (админ): смена роли */
function userCardKb(u) {
  const kb = new InlineKeyboard();
  if (u.role === 'admin') kb.text('⬇️ Понизить до селлера', `setrole:${u.tg_id}:seller`);
  else kb.text('⬆️ Сделать админом', `setrole:${u.tg_id}:admin`);
  kb.row().text('◀️ К пользователям', 'users').text('🏠 Меню', 'menu');
  return kb;
}

/** Кнопка «Назад» на заданный экран */
const backKb = (back = 'menu') => new InlineKeyboard().text('◀️ Назад', back);

/** Утилита: кнопки «назад в меню» для служебных экранов */
const backMenuKb = () => new InlineKeyboard().text('🏠 В меню', 'menu');

module.exports = {
  mainMenu,
  listKb,
  cardKb,
  confirmDeleteKb,
  searchResultsKb,
  cancelKb,
  subKb,
  usersKb,
  userCardKb,
  backKb,
  backMenuKb,
};
