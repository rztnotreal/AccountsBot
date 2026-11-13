-- Схема БД (создаётся ботом автоматически при старте, файл для справки)

CREATE TABLE IF NOT EXISTS users (
  tg_id     BIGINT PRIMARY KEY,          -- Telegram ID
  username  TEXT,                        -- @username (может быть пустым)
  full_name TEXT,
  role      TEXT NOT NULL DEFAULT 'seller', -- admin | seller
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  password    TEXT NOT NULL,
  sub         TEXT NOT NULL,                      -- тип подписки
  status      TEXT NOT NULL DEFAULT 'free',       -- free | reserved | issued | returned | blocked
  created_by  BIGINT REFERENCES users(tg_id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- кем забронирован
  reserved_by BIGINT,
  reserved_at TIMESTAMPTZ,
  -- кем выдан
  issued_by   BIGINT,
  issued_at   TIMESTAMPTZ,
  -- кем возвращён
  returned_by BIGINT,
  returned_at TIMESTAMPTZ
);

-- почта уникальна без учёта регистра
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_uniq ON accounts (lower(email));
CREATE INDEX IF NOT EXISTS accounts_status_idx ON accounts (status);

-- журнал действий (кто и что сделал с аккаунтом)
CREATE TABLE IF NOT EXISTS action_log (
  id         BIGSERIAL PRIMARY KEY,
  account_id BIGINT REFERENCES accounts(id) ON DELETE CASCADE,
  actor      BIGINT,
  action     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS action_log_account_idx ON action_log (account_id);
