'use strict';
const db = require('./db');
const dialogs = require('./dialogs');
const texts = require('./texts');
const keyboards = require('./keyboards');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Отправляет следующий шаг сценария: редактирует предыдущее сообщение-подсказку,
 * либо отправляет новое, если подсказки ещё не было.
 */
async function sendPrompt(ctx, text, markup) {
  const d = dialogs.get(ctx.chat.id, ctx.from.id);
  try {
    if (d && d.msgId) {
      await ctx.api.editMessageText(ctx.chat.id, d.msgId, text, {
        parse_mode: 'HTML',
        reply_markup: markup,
      });
      return;
    }
  } catch {
    /* сообщение не изменилось или уже слишком старое — отправим новое */
  }
  const msg = await ctx.reply(text, { parse_mode: 'HTML', reply_markup: markup });
  if (d) d.msgId = msg.message_id;
  else dialogs.set(ctx.chat.id, ctx.from.id, { type: 'stub', step: '', data: {}, msgId: msg.message_id });
}

/* ------------------------- добавление аккаунта ------------------------- */

async function startAdd(ctx) {
  dialogs.set(ctx.chat.id, ctx.from.id, { type: 'add', step: 'email', data: {}, msgId: null });
  await sendPrompt(
    ctx,
    '📝 <b>Добавление аккаунта</b>\n\nШаг 1️⃣ из 3️⃣ — пришлите <b>почту</b> аккаунта:',
    keyboards.cancelKb()
  );
}

async function finishAdd(ctx, d) {
  let acc;
  try {
    acc = await db.createAccount({
      email: d.data.email,
      password: d.data.password,
      sub: d.data.sub,
      by: ctx.from.id,
    });
  } catch (err) {
    if (err.code === 'EMAIL_EXISTS') {
      d.step = 'email';
      d.data = {};
      await sendPrompt(ctx, '⚠️ Такая почта уже есть в базе. Пришлите <b>другую</b> почту:', keyboards.cancelKb());
      return;
    }
    throw err;
  }

  await db.logAction(acc.id, ctx.from.id, 'created');
  const full = await db.getAccount(acc.id);
  await sendPrompt(
    ctx,
    `✅ <b>Аккаунт #${acc.id} добавлен</b>\n\n${texts.cardText(full)}`,
    keyboards.cardKb(full, ctx.from.id, !!ctx.state.isAdmin, 'menu')
  );
  dialogs.del(ctx.chat.id, ctx.from.id);
}

async function handleAdd(ctx, d, text) {
  if (d.step === 'email') {
    const email = text.trim();
    if (!EMAIL_RE.test(email)) {
      await sendPrompt(ctx, '⚠️ Это не похоже на почту. Пришлите корректный e-mail:', keyboards.cancelKb());
      return true;
    }
    if (await db.emailExists(email)) {
      await sendPrompt(ctx, '⚠️ Такая почта уже есть в базе. Пришлите другую почту:', keyboards.cancelKb());
      return true;
    }
    d.data.email = email;
    d.step = 'password';
    await sendPrompt(ctx, 'Шаг 2️⃣ из 3️⃣ — пришлите <b>пароль</b> аккаунта:', keyboards.cancelKb());
    return true;
  }

  if (d.step === 'password') {
    const password = text.trim();
    if (!password) {
      await sendPrompt(ctx, '⚠️ Пароль пустой. Пришлите пароль:', keyboards.cancelKb());
      return true;
    }
    d.data.password = password;
    d.step = 'sub';
    await sendPrompt(ctx, 'Шаг 3️⃣ из 3️⃣ — выберите <b>тип подписки</b>:', keyboards.subKb());
    return true;
  }

  if (d.step === 'sub' || d.step === 'subcustom') {
    const typed = text.trim();
    if (!typed) {
      await sendPrompt(ctx, '⚠️ Тип подписки пустой. Пришлите текст:', keyboards.cancelKb());
      return true;
    }
    // Если написали тип из списка (Pro, Max 5x...) — берём его, иначе — свой текст
    const known = texts.SUBS.find((s) => s !== 'Другое' && s.toLowerCase() === typed.toLowerCase());
    d.data.sub = known || typed;
    await finishAdd(ctx, d);
    return true;
  }

  return true;
}

/* ------------------------------ поиск --------------------------------- */

async function startFind(ctx) {
  dialogs.set(ctx.chat.id, ctx.from.id, { type: 'find', step: 'query', data: {}, msgId: null });
  await sendPrompt(ctx, '🔍 Пришлите часть почты для поиска:', keyboards.cancelKb());
}

async function handleFind(ctx, d, text) {
  const query = text.trim();
  if (query.length < 2) {
    await sendPrompt(ctx, '⚠️ Слишком короткий запрос. Минимум 2 символа:', keyboards.cancelKb());
    return true;
  }
  const found = await db.searchAccounts(query);
  d.step = 'results';
  d.data.query = query;
  await sendPrompt(
    ctx,
    texts.searchText(query, found),
    found.length ? keyboards.searchResultsKb(found) : keyboards.backMenuKb()
  );
  return true;
}

/* ------------------------------ общий --------------------------------- */

async function handleText(ctx, text) {
  const d = dialogs.get(ctx.chat.id, ctx.from.id);
  if (!d) return false;
  if (d.type === 'add') return handleAdd(ctx, d, text);
  if (d.type === 'find') return handleFind(ctx, d, text);
  return false;
}

async function cancelFlow(ctx) {
  const d = dialogs.get(ctx.chat.id, ctx.from.id);
  dialogs.del(ctx.chat.id, ctx.from.id);
  if (d && d.msgId) {
    try {
      await ctx.api.editMessageText(ctx.chat.id, d.msgId, '✖️ Отменено.', {
        parse_mode: 'HTML',
        reply_markup: keyboards.backMenuKb(),
      });
    } catch {
      /* ignore */
    }
  }
}

module.exports = { sendPrompt, startAdd, finishAdd, startFind, cancelFlow, handleText };
