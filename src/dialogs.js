'use strict';

/**
 * Диалоги (пошаговые сценарии): добавление аккаунта, поиск.
 * Ключ — "<chatId>:<userId>", чтобы в группе сценарии разных
 * пользователей не мешали друг другу.
 */

const TTL_MS = 5 * 60 * 1000; // сценарий живёт 5 минут
const store = new Map();

const key = (chatId, userId) => `${chatId}:${userId}`;

function get(chatId, userId) {
  const k = key(chatId, userId);
  const d = store.get(k);
  if (!d) return null;
  if (Date.now() > d.expires) {
    store.delete(k);
    return null;
  }
  return d;
}

function set(chatId, userId, dialog) {
  store.set(key(chatId, userId), { ...dialog, expires: Date.now() + TTL_MS });
}

function del(chatId, userId) {
  store.delete(key(chatId, userId));
}

module.exports = { get, set, del, key };
