'use strict';
const { Bot } = require('grammy');
const config = require('./config');
const db = require('./db');
const dialogs = require('./dialogs');
const texts = require('./texts');
const keyboards = require('./keyboards');
const flows = require('./flows');
const { handleCallback } = require('./callbacks');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Создаёт бота со всей обработкой (новый экземпляр — для чистого перезапуска) */
function createBot() {
  // timeoutSeconds=40: локальные прокси/VPN иногда молча убивают длинные
  // соединения — без таймаута поллинг зависает навсегда. Поллинг в Telegram —
  // 30с, поэтому 40с надёжно отсекает зависшие запросы и переподключается.
  const bot = new Bot(config.token, { client: { timeoutSeconds: 40 } });

  /* ---------------------------- middleware ---------------------------- */

  bot.use(async (ctx, next) => {
    // Ограниченный список чатов: пропускаем всё, что из «чужих» чатов
    if (config.allowedChatIds.length && ctx.chat && !config.allowedChatIds.includes(ctx.chat.id)) return;

    // Регистрируем/обновляем пользователя и определяем роль
    if (ctx.from && !ctx.from.is_bot) {
      let user = await db.upsertUser(ctx.from);
      if (config.isAdmin(ctx.from.id) && user.role !== 'admin') {
        user = await db.setRole(ctx.from.id, 'admin');
      }
      ctx.state.user = user;
      ctx.state.isAdmin = !!user && user.role === 'admin';
    }
    await next();
  });

  /* ------------------------------ команды ------------------------------ */

  async function replyMenu(ctx) {
    const counts = await db.statusCounts();
    await ctx.reply(texts.menuText(counts), {
      parse_mode: 'HTML',
      reply_markup: keyboards.mainMenu(!!ctx.state.isAdmin),
    });
  }

  bot.command(['start', 'menu'], async (ctx) => {
    dialogs.del(ctx.chat.id, ctx.from.id);
    await replyMenu(ctx);
  });

  bot.command('help', (ctx) =>
    ctx.reply(texts.helpText, { parse_mode: 'HTML', reply_markup: keyboards.backMenuKb() })
  );

  bot.command('add', (ctx) => flows.startAdd(ctx));
  bot.command('find', (ctx) => flows.startFind(ctx));

  bot.command('stats', async (ctx) => {
    const [counts, subs] = await Promise.all([db.statusCounts(), db.subCounts()]);
    await ctx.reply(texts.statsText(counts, subs), {
      parse_mode: 'HTML',
      reply_markup: keyboards.backMenuKb(),
    });
  });

  bot.command('cancel', async (ctx) => {
    const had = dialogs.get(ctx.chat.id, ctx.from.id);
    await flows.cancelFlow(ctx);
    if (had) await ctx.reply('✖️ Отменено.');
  });

  bot.command('id', (ctx) =>
    ctx.reply(`Ваш Telegram ID: <code>${ctx.from.id}</code>`, { parse_mode: 'HTML' })
  );

  /* --------------------------- кнопки и ввод --------------------------- */

  bot.on('callback_query:data', async (ctx) => {
    const who = ctx.from.username ? '@' + ctx.from.username : ctx.from.first_name;
    console.log(`🖱 ${who}: ${ctx.callbackQuery.data}`);
    await handleCallback(ctx);
  });

  // Простой «отклик» на любое сообщение: в личке — всегда, в группе — если
  // бота упомянули, ответили на его сообщение, либо раз в N минут на обычный текст.
  const nudgeAt = new Map();
  const NUDGE_COOLDOWN_MS = 3 * 60 * 1000;
  function allowNudge(ctx) {
    const k = `${ctx.chat.id}:${ctx.from.id}`;
    const now = Date.now();
    if (now - (nudgeAt.get(k) || 0) < NUDGE_COOLDOWN_MS) return false;
    nudgeAt.set(k, now);
    return true;
  }

  bot.on('message:text', async (ctx) => {
    const who = ctx.from.username ? '@' + ctx.from.username : ctx.from.first_name;
    console.log(`📥 ${ctx.chat.type === 'private' ? 'ЛС' : 'группа'} ${who}: ${ctx.text.slice(0, 60)}`);
    try {
      const handled = await flows.handleText(ctx, ctx.text);
      if (handled) return;

      const username = (bot.botInfo?.username || '').toLowerCase();
      const text = ctx.text.toLowerCase();
      const isMention = !!username && text.includes('@' + username);
      const isReplyToBot = ctx.message.reply_to_message?.from?.id === bot.botInfo?.id;
      const isPrivate = ctx.chat.type === 'private';

      if (!isPrivate && !isMention && !isReplyToBot && !allowNudge(ctx)) return;

      await ctx.reply(
        '👋 Я бот учёта аккаунтов Claude.\n\nНажмите кнопку ниже или напишите /menu — откроется меню управления.',
        { parse_mode: 'HTML', reply_markup: keyboards.mainMenu(!!ctx.state.isAdmin) }
      );
    } catch (err) {
      console.error('[bot] ошибка сценария:', err);
      dialogs.del(ctx.chat.id, ctx.from.id);
      await ctx.reply('⚠️ Что-то пошло не так. Начните заново: /add или /find');
    }
  });

  bot.catch((err) => console.error('[bot] ошибка обработки апдейта:', err.error));

  return bot;
}

/* ------------------------------- запуск --------------------------------- */

(async () => {
  await db.init();
  console.log('✅ PostgreSQL: подключена, схема готова');

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  let bot = null;
  function shutdown(signal) {
    console.log(`\n⏻ Остановка (${signal})...`);
    try {
      if (bot) bot.stop();
    } catch {
      /* polling ещё не запущен */
    }
    db.pool
      .end()
      .catch(() => {})
      .finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  }

  await (async () => {
    // Главный цикл: если поллинг упал — пересоздаём бота и пробуем снова
    for (;;) {
      bot = createBot();
      try {
        await bot.start({
          // false: не сбрасывать накопленные сообщения (раньше /start юзеров терялся)
          drop_pending_updates: false,
          onStart: (info) => console.log(`🤖 Бот запущен: @${info.username}`),
        });
        return; // корректная остановка снаружи
      } catch (err) {
        const desc = String(err?.description || err?.message || err);
        console.error('❌ Поллинг упал:', desc);
        if (/409|Conflict/i.test(desc)) {
          console.error('⚠️ Telegram сообщает: бот уже слушается в другом месте (другой экземпляр или getUpdates-запрос).');
          console.error('   Повтор через 10 секунд...');
          await sleep(10_000);
          continue;
        }
        console.error('   Повтор через 5 секунд...');
        await sleep(5_000);
      }
    }
  })();
})().catch((err) => {
  console.error('❌ Не удалось запустить бота:', err);
  process.exit(1);
});
