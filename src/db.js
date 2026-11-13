'use strict';
const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool(config.db);
pool.on('error', (err) => console.error('[db] ошибка пула:', err.message));

/* ------------------------------------------------------------------ */
/*  Схема (создаётся автоматически при старте)                         */
/* ------------------------------------------------------------------ */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  tg_id     BIGINT PRIMARY KEY,
  username  TEXT,
  full_name TEXT,
  role      TEXT NOT NULL DEFAULT 'seller',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  password    TEXT NOT NULL,
  sub         TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'free',
  created_by  BIGINT REFERENCES users(tg_id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  reserved_by BIGINT,
  reserved_at TIMESTAMPTZ,
  issued_by   BIGINT,
  issued_at   TIMESTAMPTZ,
  returned_by BIGINT,
  returned_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_uniq ON accounts (lower(email));
CREATE INDEX IF NOT EXISTS accounts_status_idx ON accounts (status);

CREATE TABLE IF NOT EXISTS action_log (
  id         BIGSERIAL PRIMARY KEY,
  account_id BIGINT REFERENCES accounts(id) ON DELETE CASCADE,
  actor      BIGINT,
  action     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS action_log_account_idx ON action_log (account_id);
`;

const init = () => pool.query(SCHEMA);

/* ------------------------------------------------------------------ */
/*  Пользователи                                                       */
/* ------------------------------------------------------------------ */

async function upsertUser(from) {
  const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ') || null;
  const { rows } = await pool.query(
    `INSERT INTO users (tg_id, username, full_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (tg_id) DO UPDATE SET username = EXCLUDED.username, full_name = EXCLUDED.full_name
     RETURNING *`,
    [from.id, from.username || null, fullName]
  );
  return rows[0];
}

const getUser = (tgId) =>
  pool.query('SELECT * FROM users WHERE tg_id = $1', [tgId]).then((r) => r.rows[0] || null);

const listUsers = () =>
  pool.query(
    `SELECT * FROM users
     ORDER BY role DESC, COALESCE(username, full_name, tg_id::text) ASC`
  ).then((r) => r.rows);

const setRole = (tgId, role) =>
  pool.query('UPDATE users SET role = $2 WHERE tg_id = $1 RETURNING *', [tgId, role]).then(
    (r) => r.rows[0] || null
  );

/* ------------------------------------------------------------------ */
/*  Аккаунты                                                           */
/* ------------------------------------------------------------------ */

const SELECT_A = `
  SELECT a.*,
    ru.username AS reserved_username, ru.full_name AS reserved_name,
    iu.username AS issued_username,   iu.full_name AS issued_name,
    tu.username AS returned_username, tu.full_name AS returned_name,
    cu.username AS created_username,  cu.full_name AS created_name
  FROM accounts a
  LEFT JOIN users ru ON ru.tg_id = a.reserved_by
  LEFT JOIN users iu ON iu.tg_id = a.issued_by
  LEFT JOIN users tu ON tu.tg_id = a.returned_by
  LEFT JOIN users cu ON cu.tg_id = a.created_by`;

const FILTERS = {
  all: { where: 'TRUE' },
  free: { where: "a.status = 'free'" },
  reserved: { where: "a.status = 'reserved'" },
  issued: { where: "a.status = 'issued'" },
  returned: { where: "a.status = 'returned'" },
  blocked: { where: "a.status = 'blocked'" },
  mine: { where: '(a.reserved_by = $3 OR a.issued_by = $3)' },
};

const getAccount = (id) =>
  pool.query(`${SELECT_A} WHERE a.id = $1`, [id]).then((r) => r.rows[0] || null);

async function listAccounts(filterKey, tgId, page = 0, per = 5) {
  const f = FILTERS[filterKey] ? filterKey : 'all';
  const where = FILTERS[f].where;

  const params = [per, page * per];
  if (where.includes('$3')) params.push(tgId);
  const rows = (
    await pool.query(`${SELECT_A} WHERE ${where} ORDER BY a.id DESC LIMIT $1 OFFSET $2`, params)
  ).rows;

  const countParams = where.includes('$3') ? [tgId] : [];
  const total = (
    await pool.query(`SELECT count(*)::int AS c FROM accounts a WHERE ${where}`, countParams)
  ).rows[0].c;

  return { rows, total, pages: Math.max(1, Math.ceil(total / per)) };
}

const searchAccounts = (query) =>
  pool
    .query(`${SELECT_A} WHERE a.email ILIKE $1 ORDER BY a.id DESC LIMIT 12`, [`%${query}%`])
    .then((r) => r.rows);

const emailExists = (email) =>
  pool.query('SELECT 1 FROM accounts WHERE lower(email) = lower($1)', [email]).then((r) => r.rowCount > 0);

async function createAccount({ email, password, sub, by }) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO accounts (email, password, sub, status, created_by)
       VALUES ($1, $2, $3, 'free', $4) RETURNING *`,
      [email.trim(), password, sub, by]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') {
      const e = new Error('Аккаунт с такой почтой уже существует');
      e.code = 'EMAIL_EXISTS';
      throw e;
    }
    throw err;
  }
}

/* ---------------------------- статусы ------------------------------ */
/* Каждый переход — атомарный UPDATE с проверкой текущего статуса.
   Возвращает id аккаунта или null, если условие не выполнено.        */

/** свободный → забронирован (за указанным юзером) */
const reserveAccount = (id, tgId) =>
  pool
    .query(
      `UPDATE accounts SET status = 'reserved', reserved_by = $2, reserved_at = now()
       WHERE id = $1 AND status = 'free' RETURNING id`,
      [id, tgId]
    )
    .then((r) => r.rows[0] || null);

/** свободный → выдан сразу (бронь + выдача одним действием) */
const takeNow = (id, tgId) =>
  pool
    .query(
      `UPDATE accounts
       SET status = 'issued',
           reserved_by = $2, reserved_at = now(),
           issued_by = $2, issued_at = now()
       WHERE id = $1 AND status = 'free' RETURNING id`,
      [id, tgId]
    )
    .then((r) => r.rows[0] || null);

/** забронирован мной → выдан мне */
const issueReserved = (id, tgId) =>
  pool
    .query(
      `UPDATE accounts SET status = 'issued', issued_by = $2, issued_at = now()
       WHERE id = $1 AND status = 'reserved' AND reserved_by = $2 RETURNING id`,
      [id, tgId]
    )
    .then((r) => r.rows[0] || null);

/** снять бронь (свою, либо любую — для админа) → свободный */
const unreserve = (id, tgId, isAdmin) =>
  pool
    .query(
      `UPDATE accounts
       SET status = 'free', reserved_by = NULL, reserved_at = NULL
       WHERE id = $1 AND status = 'reserved' AND (reserved_by = $2 OR $3) RETURNING id`,
      [id, tgId, !!isAdmin]
    )
    .then((r) => r.rows[0] || null);

/** выданный → возвращён (вернуть может выдавшийся или админ) */
const giveBack = (id, tgId, isAdmin) =>
  pool
    .query(
      `UPDATE accounts SET status = 'returned', returned_by = $2, returned_at = now()
       WHERE id = $1 AND status = 'issued' AND (issued_by = $2 OR $3) RETURNING id`,
      [id, tgId, !!isAdmin]
    )
    .then((r) => r.rows[0] || null);

/** возвращённый/заблокированный → свободный */
const openFree = (id, tgId, isAdmin) =>
  pool
    .query(
      `UPDATE accounts
       SET status = 'free',
           reserved_by = NULL, reserved_at = NULL,
           returned_by = NULL, returned_at = NULL
       WHERE id = $1 AND status IN ('returned', 'blocked')
         AND (returned_by = $2 OR $3) RETURNING id`,
      [id, tgId, !!isAdmin]
    )
    .then((r) => r.rows[0] || null);

/** любой статус → заблокирован (только админ) */
const blockAccount = (id) =>
  pool
    .query(
      `UPDATE accounts SET status = 'blocked', reserved_by = NULL, reserved_at = NULL
       WHERE id = $1 AND status <> 'blocked' RETURNING id`,
      [id]
    )
    .then((r) => r.rows[0] || null);

/** удалить (только админ) */
const deleteAccount = (id) =>
  pool.query('DELETE FROM accounts WHERE id = $1 RETURNING email', [id]).then((r) => r.rows[0] || null);

/* --------------------------- статистика ---------------------------- */

async function statusCounts() {
  const rows = await pool
    .query('SELECT status, count(*)::int AS c FROM accounts GROUP BY status')
    .then((r) => r.rows);
  const out = { free: 0, reserved: 0, issued: 0, returned: 0, blocked: 0, total: 0 };
  for (const row of rows) {
    if (row.status in out) out[row.status] = row.c;
    out.total += row.c;
  }
  return out;
}

const subCounts = () =>
  pool
    .query(
      `SELECT sub, count(*)::int AS c FROM accounts
       GROUP BY sub ORDER BY c DESC, sub ASC`
    )
    .then((r) => r.rows);

/* --------------------------- журнал -------------------------------- */

async function logAction(accountId, actor, action) {
  try {
    await pool.query('INSERT INTO action_log (account_id, actor, action) VALUES ($1, $2, $3)', [
      accountId,
      actor,
      action,
    ]);
  } catch (err) {
    console.error('[db] не удалось записать в журнал:', err.message);
  }
}

const getLog = (accountId, limit = 6) =>
  pool
    .query(
      `SELECT l.created_at, l.action, u.username, u.full_name, l.actor
       FROM action_log l
       LEFT JOIN users u ON u.tg_id = l.actor
       WHERE l.account_id = $1
       ORDER BY l.id DESC LIMIT $2`,
      [accountId, limit]
    )
    .then((r) => r.rows);

module.exports = {
  pool,
  init,
  upsertUser,
  getUser,
  listUsers,
  setRole,
  getAccount,
  listAccounts,
  searchAccounts,
  emailExists,
  createAccount,
  statusCounts,
  subCounts,
  logAction,
  getLog,
  reserveAccount,
  takeNow,
  issueReserved,
  unreserve,
  giveBack,
  openFree,
  blockAccount,
  deleteAccount,
};
