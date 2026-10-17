// Сессии пользователей.
//
// JWT несёт идентификатор сессии (sid), поэтому сессию можно завершить
// принудительно: сервер проверяет её наличие на каждом запросе. IP и
// User-Agent хранятся в БД в зашифрованном виде (AES-256-GCM, ключ
// SESSION_ENC_KEY) и расшифровываются только для владельца сессии.

const db = require("../db");
const { uid } = require("../utils/uid");
const { logInfo } = require("../utils/logger");
const { createCipher } = require("./crypto");

const KEY_SOURCE =
  process.env.SESSION_ENC_KEY || process.env.JWT_SECRET || "idel_dev_session_key";
const { encrypt: encryptValue, decrypt: decryptValue } = createCipher(KEY_SOURCE);

/** Сколько дней неактивности считаем поводом удалить сессию. */
const STALE_SESSION_DAYS = 90;

/**
 * Человекочитаемое устройство из User-Agent: «Chrome · Windows», «Safari · iOS».
 * Разбор по реальным признакам браузеров, без внешних библиотек.
 * Служебные сессии ботов помечаются префиксом BOTGRANT:.
 */
function describeDevice(userAgent) {
  const ua = String(userAgent || "");
  if (!ua) return "Неизвестное устройство";
  const botMatch = /^BOTGRANT:@(.+)$/.exec(ua);
  if (botMatch) return `Вход через бота @${botMatch[1]}`;

  let os = "Неизвестная ОС";
  if (/Windows NT/i.test(ua)) os = "Windows";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Mac OS X/i.test(ua)) os = "macOS";
  else if (/CrOS/i.test(ua)) os = "ChromeOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "Неизвестный браузер";
  if (/YaBrowser/i.test(ua)) browser = "Yandex";
  else if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua)) browser = "Safari";

  const kind = /Mobile|Android.*Mobile|iPhone/i.test(ua)
    ? "телефон"
    : /iPad|Tablet/i.test(ua)
      ? "планшет"
      : "компьютер";

  return `${browser} · ${os} (${kind})`;
}

/** Создаёт сессию и возвращает её идентификатор для JWT. */
function createSession({ userId, ip, userAgent }) {
  const id = uid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_sessions (id, user_id, ip, user_agent, created_at, last_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, encryptValue(ip), encryptValue(userAgent), now, now);
  logInfo("Создана сессия", { userId, sessionId: id, device: describeDevice(userAgent) });
  return id;
}

/**
 * Служебная сессия бота: создаётся после подтверждения кода входа.
 * В списке сессий пользователя выглядит как «Вход через бота @имя» —
 * её можно завершить, и тогда разрешение бота перестанет действовать.
 */
function createBotSession({ userId, botUsername, ip }) {
  return createSession({
    userId,
    ip: ip || null,
    userAgent: `BOTGRANT:@${String(botUsername || "bot").toLowerCase()}`,
  });
}

function getSession(sessionId) {
  if (!sessionId) return null;
  return db.prepare("SELECT * FROM user_sessions WHERE id = ?").get(sessionId);
}

/** Обновляет отметку активности (не чаще раза в минуту, чтобы не гонять запись). */
function touchSession(sessionId) {
  const session = getSession(sessionId);
  if (!session) return false;
  const lastActive = new Date(session.last_active || session.created_at).getTime();
  if (Date.now() - lastActive < 60 * 1000) return true;
  db.prepare("UPDATE user_sessions SET last_active = ? WHERE id = ?").run(
    new Date().toISOString(),
    sessionId,
  );
  return true;
}

/** Список сессий пользователя с расшифрованными IP и устройством. */
function listSessions(userId, currentSessionId = null) {
  const rows = db
    .prepare("SELECT * FROM user_sessions WHERE user_id = ? ORDER BY last_active DESC")
    .all(userId);
  return rows.map((row) => {
    const userAgent = decryptValue(row.user_agent);
    return {
      id: row.id,
      userId: row.user_id,
      ip: decryptValue(row.ip) || "неизвестно",
      userAgent,
      device: describeDevice(userAgent),
      current: !!currentSessionId && row.id === currentSessionId,
      createdAt: row.created_at,
      lastActive: row.last_active,
    };
  });
}

function revokeSession(sessionId, userId) {
  const session = getSession(sessionId);
  if (!session) return { ok: false, error: "Сессия не найдена" };
  if (session.user_id !== userId) return { ok: false, error: "Нет доступа" };
  db.prepare("DELETE FROM user_sessions WHERE id = ?").run(sessionId);
  logInfo("Сессия завершена", { userId, sessionId });
  return { ok: true };
}

/** Завершает все сессии пользователя, кроме указанной (например, текущей). */
function revokeOtherSessions(userId, keepSessionId = null) {
  const result = keepSessionId
    ? db.prepare("DELETE FROM user_sessions WHERE user_id = ? AND id != ?").run(userId, keepSessionId)
    : db.prepare("DELETE FROM user_sessions WHERE user_id = ?").run(userId);
  if (result.changes > 0) {
    logInfo("Завершены прочие сессии", { userId, count: result.changes, kept: keepSessionId });
  }
  return result.changes;
}

/** Удаляет давно неактивные сессии. */
function purgeStaleSessions(days = STALE_SESSION_DAYS) {
  const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare("DELETE FROM user_sessions WHERE last_active < ?").run(threshold);
  if (result.changes > 0) logInfo(`Удалено неактивных сессий: ${result.changes}`);
  return result.changes;
}

function countSessions(userId) {
  const row = db.prepare("SELECT COUNT(*) AS c FROM user_sessions WHERE user_id = ?").get(userId);
  return row ? row.c : 0;
}

module.exports = {
  STALE_SESSION_DAYS,
  encryptValue,
  decryptValue,
  describeDevice,
  createSession,
  createBotSession,
  getSession,
  touchSession,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  purgeStaleSessions,
  countSessions,
};
