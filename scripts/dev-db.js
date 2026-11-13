'use strict';
/**
 * Локальный PostgreSQL "из коробки" — без установки и прав админа.
 * Нужен только для разработки/тестирования на этом компьютере.
 * На реальном сервере используйте свой PostgreSQL и DATABASE_URL в .env.
 *
 * Запуск: node scripts/dev-db.js   (данные сохраняются в ./data/pgdev)
 */

(async () => {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');

  const pg = new EmbeddedPostgres({
    databaseDir: './data/pgdev',
    user: 'postgres',
    password: 'postgres',
    port: 5432,
    persistent: true,
  });

  await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase('claude_accounts');
  } catch {
    console.log('ℹ️ БД claude_accounts уже существует');
  }
  console.log('✅ PostgreSQL запущен: localhost:5432 (user=postgres, pass=postgres, db=claude_accounts)');

  const stop = async () => {
    console.log('\n⏻ Останавливаю PostgreSQL...');
    try {
      await pg.stop();
    } catch {}
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})().catch((err) => {
  console.error('❌ Не удалось запустить PostgreSQL:', err);
  process.exit(1);
});
