'use strict';
const config = require('./config');
const db = require('./db');
const dialogs = require('./dialogs');
const texts = require('./texts');
const keyboards = require('./keyboards');
const flows = require('./flows');

/** HTML-опции сообщений */
const M = (markup) => ({
  parse_mode: 'HTML',
  reply_markup: markup,
  link_preview_options: { is_disabled: true },
});

/** Безопасное редактирование сообщения (тихо игнорируем «не изменилось» и т.п.) */
async function edit(ctx, text, markup) {
  try {
    await ctx.editMessageText(text, M(markup));
  } catch (err) {
    const msg = String(err?.message || '');
    if (!/message is not modified|message to edit not found|message is too old|message can't be edited/i.test(msg)) {
      console.error('[cb] edit:', msg);
    }
  }
}

/** Ответ на нажатие кнопки (всплывающее уведомление) */
async function toast(ctx, text, alert = true) {
  try {
    await ctx.answerCallbackQuery({ text, show_alert: alert });
  } catch {
    /* ответ уже был дан или кнопка устарела */
  }
}

/** «Назад» из карточки/действия: parts = [prefix, id, ...back] */
const backOf = (parts) => parts.slice(2).join(':') || 'menu';

const notFound = async (ctx) => {
  await toast(ctx, 'Аккаунт не найден (возможно, удалён).');
  await edit(ctx, '❌ Аккаунт не найден.', keyboards.backMenuKb());
};

/** Перерисовать карточку после действия */
async function refreshCard(ctx, id, back, isAdmin, alertText) {
  const acc = await db.getAccount(id);
  if (!acc) return notFound(ctx);
  if (alertText) await toast(ctx, alertText);
  return edit(ctx, texts.cardText(acc), keyboards.cardKb(acc, ctx.from.id, isAdmin, back));
}

/* ------------------------- действия над аккаунтом ------------------------ */

async function doReserve(ctx, id, back, isAdmin) {
  const ok = await db.reserveAccount(id, ctx.from.id);
  if (!ok) return refreshCard(ctx, id, back, isAdmin, '⛔️ Не удалось забронировать: аккаунт уже занят.');
  await db.logAction(id, ctx.from.id, 'reserved');
  return refreshCard(ctx, id, back, isAdmin, '✅ Аккаунт забронирован за вами.');
}

async function doTakeNow(ctx, id, back, isAdmin) {
  const ok = await db.takeNow(id, ctx.from.id);
  if (!ok) return refreshCard(ctx, id, back, isAdmin, '⛔️ Не удалось взять: аккаунт уже занят.');
  await db.logAction(id, ctx.from.id, 'took');
  return refreshCard(ctx, id, back, isAdmin, '✅ Аккаунт ваш: забронирован и выдан сразу.');
}

async function doIssue(ctx, id, back, isAdmin) {
  const ok = await db.issueReserved(id, ctx.from.id);
  if (!ok) {
    const acc = await db.getAccount(id);
    let reason = '⛔️ Не удалось выдать: статус аккаунта изменился.';
    if (acc && acc.status === 'reserved' && acc.reserved_by !== ctx.from.id && !isAdmin) {
      reason = '⛔️ Бронь на этот аккаунт сделал другой селлер.';
    }
    return refreshCard(ctx, id, back, isAdmin, reason);
  }
  await db.logAction(id, ctx.from.id, 'issued');
  return refreshCard(ctx, id, back, isAdmin, '✅ Аккаунт выдан вам.');
}

async function doUnreserve(ctx, id, back, isAdmin) {
  const ok = await db.unreserve(id, ctx.from.id, isAdmin);
  if (!ok) {
    const acc = await db.getAccount(id);
    let reason = '⛔️ Не удалось снять бронь: статус изменился.';
    if (acc && acc.status === 'reserved' && acc.reserved_by !== ctx.from.id && !isAdmin) {
      reason = '⛔️ Снимать чужую бронь может только админ.';
    }
    return refreshCard(ctx, id, back, isAdmin, reason);
  }
  await db.logAction(id, ctx.from.id, 'unreserved');
  return refreshCard(ctx, id, back, isAdmin, '✅ Бронь снята, аккаунт свободен.');
}

async function doReturn(ctx, id, back, isAdmin) {
  const ok = await db.giveBack(id, ctx.from.id, isAdmin);
  if (!ok) {
    const acc = await db.getAccount(id);
    let reason = '⛔️ Не удалось вернуть: статус изменился.';
    if (acc && acc.status === 'issued' && acc.issued_by !== ctx.from.id && !isAdmin) {
      reason = '⛔️ Вернуть аккаунт может только тот, кому он выдан (или админ).';
    }
    return refreshCard(ctx, id, back, isAdmin, reason);
  }
  await db.logAction(id, ctx.from.id, 'returned');
  return refreshCard(ctx, id, back, isAdmin, '↩️ Аккаунт возвращён.');
}

async function doOpen(ctx, id, back, isAdmin) {
  const ok = await db.openFree(id, ctx.from.id, isAdmin);
  if (!ok) {
    const acc = await db.getAccount(id);
    let reason = '⛔️ Не удалось открыть: статус изменился.';
    if (acc && acc.status === 'returned' && acc.returned_by !== ctx.from.id && !isAdmin) {
      reason = '⛔️ Открыть аккаунт может только возвративший его (или админ).';
    }
    return refreshCard(ctx, id, back, isAdmin, reason);
  }
  await db.logAction(id, ctx.from.id, 'opened');
  return refreshCard(ctx, id, back, isAdmin, '♻️ Аккаунт снова свободен.');
}

async function doBlock(ctx, id, back, isAdmin) {
  if (!isAdmin) return toast(ctx, '⛔️ Только для админа.');
  const ok = await db.blockAccount(id);
  if (!ok) return refreshCard(ctx, id, back, isAdmin, '⛔️ Аккаунт уже заблокирован.');
  await db.logAction(id, ctx.from.id, 'blocked');
  return refreshCard(ctx, id, back, isAdmin, '⛔️ Аккаунт заблокирован.');
}

async function doDelete(ctx, id, back, isAdmin) {
  if (!isAdmin) return toast(ctx, '⛔️ Только для админа.');
  const acc = await db.getAccount(id);
  if (!acc) return notFound(ctx);
  return edit(
    ctx,
    `🗑 <b>Удалить аккаунт #${acc.id}?</b>\n\n📧 <code>${acc.email}</code>\n💳 Подписка: ${acc.sub}\n\n⚠️ Действие необратимо.`,
    keyboards.confirmDeleteKb(acc.id, back)
  );
}

async function doDeleteConfirm(ctx, id, isAdmin) {
  if (!isAdmin) return toast(ctx, '⛔️ Только для админа.');
  await db.logAction(id, ctx.from.id, 'deleted');
  const removed = await db.deleteAccount(id);
  if (!removed) return notFound(ctx);
  await toast(ctx, '🗑 Аккаунт удалён.');
  return edit(ctx, `🗑 Аккаунт <code>${removed.email}</code> удалён.`, keyboards.backMenuKb());
}

/* ------------------------------- экраны --------------------------------- */

async function screenList(ctx, filter, rawPage, isAdmin) {
  let page = Math.max(0, Number(rawPage) || 0);
  let res = await db.listAccounts(filter, ctx.from.id, page, config.perPage);
  if (!res.rows.length && page > 0) {
    page = Math.max(0, res.pages - 1);
    res = await db.listAccounts(filter, ctx.from.id, page, config.perPage);
  }
  return edit(ctx, texts.listText(filter, res.rows, page, res.pages, res.total), keyboards.listKb(res.rows, filter, page, res.pages));
}

async function screenMenu(ctx, isAdmin) {
  const counts = await db.statusCounts();
  return edit(ctx, texts.menuText(counts), keyboards.mainMenu(isAdmin));
}

async function screenStats(ctx) {
  const [counts, subs] = await Promise.all([db.statusCounts(), db.subCounts()]);
  return edit(ctx, texts.statsText(counts, subs), keyboards.backMenuKb());
}

async function screenUsers(ctx, isAdmin) {
  if (!isAdmin) return toast(ctx, '⛔️ Только для админа.');
  const users = await db.listUsers();
  return edit(ctx, texts.usersText(users), keyboards.usersKb(users));
}

async function screenUserCard(ctx, tgId, isAdmin) {
  if (!isAdmin) return toast(ctx, '⛔️ Только для админа.');
  const user = await db.getUser(Number(tgId));
  if (!user) return toast(ctx, 'Пользователь не найден.');
  return edit(ctx, texts.userCardText(user), keyboards.userCardKb(user));
}

/* -------------------------------- роутер -------------------------------- */

async function handleCallback(ctx) {
  const parts = String(ctx.callbackQuery?.data || '').split(':');
  const cmd = parts[0];
  const isAdmin = !!ctx.state.isAdmin;
  const id = Number(parts[1]);

  switch (cmd) {
    case 'noop':
      return toast(ctx, '·', false);

    case 'menu':
    case 'refresh':
      dialogs.del(ctx.chat.id, ctx.from.id);
      return screenMenu(ctx, isAdmin);

    case 'help':
      return edit(ctx, texts.helpText, keyboards.backMenuKb());

    case 'list':
      return screenList(ctx, parts[1] || 'all', parts[2], isAdmin);

    case 'acc': {
      const acc = await db.getAccount(id);
      if (!acc) return notFound(ctx);
      return edit(ctx, texts.cardText(acc), keyboards.cardKb(acc, ctx.from.id, isAdmin, backOf(parts)));
    }

    case 'pw': {
      const acc = await db.getAccount(id);
      if (!acc) return notFound(ctx);
      return edit(ctx, texts.cardText(acc, { showPassword: true }), keyboards.cardKb(acc, ctx.from.id, isAdmin, backOf(parts)));
    }

    case 'hist': {
      const acc = await db.getAccount(id);
      if (!acc) return notFound(ctx);
      const entries = await db.getLog(acc.id, 8);
      return edit(ctx, texts.logText(acc, entries), keyboards.backKb(backOf(parts)));
    }

    case 'res':
      return doReserve(ctx, id, backOf(parts), isAdmin);
    case 'take':
      return doTakeNow(ctx, id, backOf(parts), isAdmin);
    case 'iss':
      return doIssue(ctx, id, backOf(parts), isAdmin);
    case 'unres':
      return doUnreserve(ctx, id, backOf(parts), isAdmin);
    case 'ret':
      return doReturn(ctx, id, backOf(parts), isAdmin);
    case 'open':
      return doOpen(ctx, id, backOf(parts), isAdmin);
    case 'blk':
      return doBlock(ctx, id, backOf(parts), isAdmin);
    case 'del':
      return doDelete(ctx, id, backOf(parts), isAdmin);
    case 'dely':
      return doDeleteConfirm(ctx, id, isAdmin);

    case 'stats':
      return screenStats(ctx);

    case 'users':
      return screenUsers(ctx, isAdmin);
    case 'usr':
      return screenUserCard(ctx, id, isAdmin);
    case 'setrole': {
      if (!isAdmin) return toast(ctx, '⛔️ Только для админа.');
      const role = parts[2];
      if (role !== 'admin' && role !== 'seller') return toast(ctx, 'Неизвестная роль.');
      await db.setRole(id, role);
      await toast(ctx, '✅ Роль обновлена.');
      return screenUserCard(ctx, id, isAdmin);
    }

    case 'add':
      return flows.startAdd(ctx);
    case 'find':
      return flows.startFind(ctx);
    case 'flowcancel':
      await flows.cancelFlow(ctx);
      return toast(ctx, '✖️ Отменено.', false);

    case 'sub': {
      const d = dialogs.get(ctx.chat.id, ctx.from.id);
      if (!d || d.type !== 'add' || d.step !== 'sub') return toast(ctx, 'Добавление не активно.');
      if (parts[1] === 'custom') {
        d.step = 'subcustom';
        return flows.sendPrompt(ctx, '✍️ Пришлите <b>тип подписки</b> текстом:', keyboards.cancelKb());
      }
      const sub = texts.SUBS[Number(parts[1])];
      if (!sub || sub === 'Другое') return toast(ctx, 'Неизвестный тип подписки.');
      d.data.sub = sub;
      return flows.finishAdd(ctx, d);
    }

    default:
      return toast(ctx, 'Неизвестная команда.', false);
  }
}

module.exports = { handleCallback };
