'use strict';
/* Smoke-тест: проверяет загрузку модулей, рендер текстов и клавиатур.
   Запуск: node scripts/smoke.js  (не требует PostgreSQL и токена) */

process.env.BOT_TOKEN = '123456:TEST-TOKEN';
process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/test';
process.env.ADMIN_IDS = '111';

const assert = require('assert');

const config = require('../src/config');
const texts = require('../src/texts');
const kb = require('../src/keyboards');
const dialogs = require('../src/dialogs');
const utils = require('../src/utils');
const db = require('../src/db');
require('../src/flows');
require('../src/callbacks');

// --- фикстура аккаунта в формате строки с JOIN ---
const acc = {
  id: 15,
  email: 'seller.claude@gmail.com',
  password: 'P@ss<w>&"word',
  sub: 'Max 20x',
  status: 'reserved',
  created_by: 111,
  created_at: new Date(),
  reserved_by: 222,
  reserved_at: new Date(),
  issued_by: null,
  issued_at: null,
  returned_by: null,
  returned_at: null,
  reserved_username: 'vasya', reserved_name: 'Vasya P',
  issued_username: null, issued_name: null,
  returned_username: null, returned_name: null,
  created_username: 'admin', created_name: 'Admin A',
};

// --- тексты рендерятся и экранируют HTML ---
const card = texts.cardText(acc, { showPassword: true });
assert(card.includes('Аккаунт #15'), 'карточка содержит id');
assert(card.includes('@vasya'), 'карточка показывает @username бронирующего');
assert(card.includes('&lt;w&gt;&amp;&quot;'), 'пароль экранирован');
assert(!texts.cardText(acc).includes('P@ss'), 'пароль скрыт по умолчанию');
assert(texts.menuText({ total: 1, free: 1, reserved: 0, issued: 0, returned: 0, blocked: 0 }).includes('Всего'));
assert(texts.listText('free', [acc], 0, 2, 7).includes('Страница 1 из 2'));
assert(texts.searchText('gmail', [acc]).includes('найдено: <b>1</b>'));
assert(texts.logText(acc, [{ created_at: new Date(), action: 'reserved', actor: 222, username: 'vasya' }]).includes('забронировал'));
assert(texts.statsText({ total: 3, free: 1, reserved: 1, issued: 1, returned: 0, blocked: 0 }, [{ sub: 'Pro', c: 3 }]).includes('По подпискам'));
assert(texts.usersText([{ tg_id: 1, username: 'a', full_name: null, role: 'admin' }]).includes('👑'));
assert(texts.userCardText({ tg_id: 1, username: 'a', full_name: null, role: 'seller', created_at: new Date() }).includes('селлер'));
assert(utils.person(acc, 'reserved') === '@vasya' && utils.person(acc, 'issued') === '—');

// --- клавиатуры строятся, callback_data не длиннее 64 байт ---
const keyboards = {
  mainMenu: [kb.mainMenu(true), kb.mainMenu(false)],
  list: [kb.listKb([acc], 'free', 0, 3), kb.listKb([], 'blocked', 0, 1)],
  card: [],
  confirmDelete: kb.confirmDeleteKb(15, 'list:free:0'),
  searchResults: kb.searchResultsKb([acc]),
  cancel: kb.cancelKb(),
  sub: kb.subKb(),
  users: kb.usersKb([{ tg_id: 222, username: 'vasya', role: 'seller' }]),
  userCard: kb.userCardKb({ tg_id: 222, username: 'vasya', role: 'seller' }),
  back: [kb.backKb(), kb.backKb('list:reserved:2')],
  backMenu: kb.backMenuKb(),
};
for (const status of ['free', 'reserved', 'issued', 'returned', 'blocked']) {
  keyboards.card.push(
    kb.cardKb({ ...acc, status, returned_by: 222 }, 222, false, 'list:all:0'),
    kb.cardKb({ ...acc, status, returned_by: 222 }, 999, true, 'list:free:0')
  );
}
for (const [name, list] of Object.entries(keyboards)) {
  for (const k of [].concat(list)) {
    for (const row of k.inline_keyboard) {
      for (const btn of row) {
        assert(Buffer.byteLength(btn.callback_data || '', 'utf8') <= 64, `${name}: callback_data > 64 байт: ${btn.callback_data}`);
      }
    }
  }
}

// --- карточка: нужные действия видны нужному человеку ---
const b = (k) => k.inline_keyboard.flat().map((x) => x.callback_data);
const mine = b(kb.cardKb(acc, 222, false, 'list:all:0'));           // забронировано mной
assert(mine.includes('iss:15:list:all:0') && mine.includes('unres:15:list:all:0'), 'своя бронь: выдать/снять');
const foreign = b(kb.cardKb(acc, 999, false));        // чужая бронь, не админ
assert(!foreign.some((d) => d.startsWith('iss:')), 'чужую бронь нельзя выдать');
const issuedMine = b(kb.cardKb({ ...acc, status: 'issued', issued_by: 222 }, 222, false));
assert(issuedMine.some((d) => d.startsWith('ret:')), 'свой выданный можно вернуть');
const free = b(kb.cardKb({ ...acc, status: 'free', reserved_by: null }, 222, false, 'list:free:0'));
assert(free.includes('res:15:list:free:0') && free.some((d) => d.startsWith('take:')), 'свободный: бронь + взять сразу');
assert(!free.some((d) => d.startsWith('blk:')), 'блокировка только у админа');
assert(b(kb.cardKb(acc, 999, true, 'menu')).some((d) => d.startsWith('blk:')), 'админ может блокировать');

// --- db: список функций, которые используют обработчики ---
for (const fn of ['reserveAccount', 'takeNow', 'issueReserved', 'unreserve', 'giveBack', 'openFree', 'blockAccount',
  'deleteAccount', 'getAccount', 'listAccounts', 'searchAccounts', 'statusCounts', 'subCounts', 'createAccount',
  'emailExists', 'logAction', 'getLog', 'upsertUser', 'setRole', 'listUsers', 'getUser', 'init']) {
  assert(typeof db[fn] === 'function', `db.${fn} экспортирована`);
}

// --- диалоги: изоляция пользователей и TTL ---
dialogs.set(1, 222, { type: 'add', step: 'email', data: {} });
assert(dialogs.get(1, 222).type === 'add', 'диалог сохранён');
assert(dialogs.get(1, 333) === null, 'диалоги пользователей изолированы');
dialogs.del(1, 222);
assert(dialogs.get(1, 222) === null, 'диалог удалён');

console.log('SMOKE_OK: модули, тексты, клавиатуры и права — в порядке');
