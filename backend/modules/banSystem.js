// Расширенная система банов.
//
// Обычный бан: пользователь не может создавать посты, комментарии и сообщения,
// посты остаются на месте.
//
// Серьёзный бан дополнительно полностью сбрасывает профиль: случайный ник,
// стандартный аватар, пустое описание, удалённая обложка. Посты не удаляются.
//
// Авто-бан: больше 20 токсичных сообщений за 7 дней → бан на 3 дня без
// участия администратора.

const fs = require("fs");
const path = require("path");
const db = require("../db");
const { uid } = require("../utils/uid");
const { logInfo, logWarn } = require("../utils/logger");
const { UPLOAD_ROOT } = require("../middleware/upload");
const badges = require("./badges");

const DAY_MS = 24 * 60 * 60 * 1000;

const TOXIC_BAN_THRESHOLD = 20; // сообщений
const TOXIC_BAN_WINDOW_DAYS = 7;
const TOXIC_BAN_DURATION_DAYS = 3;

const MODE_NORMAL = "normal";
const MODE_SERIOUS = "serious";

function nowIso() {
  return new Date().toISOString();
}

/**
 * Удаляет локально загруженный файл по его публичному URL.
 * Data-URL (аватары из формы регистрации) и внешние ссылки не трогаем.
 */
function deleteUploadedFile(url) {
  if (!url || typeof url !== "string") return false;
  const match = url.match(/\/uploads\/(avatars|covers|posts|voice|video)\/([\w.\-]+)$/);
  if (!match) return false;
  const target = path.join(UPLOAD_ROOT, match[1], match[2]);
  // Защита от выхода за пределы каталога загрузок.
  if (!target.startsWith(UPLOAD_ROOT)) return false;
  try {
    fs.unlinkSync(target);
    return true;
  } catch {
    return false;
  }
}

/** Состояние бана с учётом автоматического истечения срока. */
function getBanState(userId) {
  const row = db.prepare("SELECT * FROM bans WHERE user_id = ?").get(userId);
  if (!row) return { banned: false };

  if (row.expires_at) {
    const expiresAt = new Date(row.expires_at).getTime();
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      // Срок истёк — снимаем бан и сообщаем как «не забанен».
      unban(userId, { by: null, reason: "expired" });
      return { banned: false };
    }
  }

  const daysLeft = row.expires_at
    ? Math.max(1, Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / DAY_MS))
    : null;

  return {
    banned: true,
    reason: row.reason,
    ruleNumber: row.rule_number ?? null,
    mode: row.mode || MODE_NORMAL,
    isAuto: !!row.is_auto,
    bannedBy: row.banned_by || null,
    expiresAt: row.expires_at || null,
    daysLeft,
    createdAt: row.created_at,
  };
}

function isBanned(userId) {
  return getBanState(userId).banned;
}

/**
 * Полный сброс профиля для серьёзного бана.
 * Ник становится случайным восьмизначным числом (как в требованиях: 12345678).
 */
function resetProfile(userId) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return null;

  let newUsername = null;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = String(10000000 + Math.floor(Math.random() * 90000000));
    const taken = db.prepare("SELECT id FROM users WHERE lower(username) = ? AND id != ?").get(candidate, userId);
    if (!taken) {
      newUsername = candidate;
      break;
    }
  }
  if (!newUsername) newUsername = `user${Date.now().toString().slice(-8)}`;

  deleteUploadedFile(user.avatar_url);
  deleteUploadedFile(user.cover_url);

  db.prepare(
    `UPDATE users
     SET username = ?, full_name = '', bio = '', avatar_url = NULL, cover_url = NULL, serious_banned = 1
     WHERE id = ?`,
  ).run(newUsername, userId);

  logInfo("Профиль сброшен (серьёзный бан)", { userId, newUsername });
  return {
    previousUsername: user.username,
    username: newUsername,
    avatarDropped: !!user.avatar_url,
    coverDropped: !!user.cover_url,
  };
}

/**
 * Накладывает бан (обычный или серьёзный).
 * @param {{userId: string, reason: string, ruleNumber?: number|null, mode?: string,
 *   durationDays?: number|null, bannedBy?: string|null, isAuto?: boolean}} input
 */
function applyBan({
  userId,
  reason,
  ruleNumber = null,
  mode = MODE_NORMAL,
  durationDays = null,
  bannedBy = null,
  isAuto = false,
}) {
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!target) return { ok: false, error: "Пользователь не найден" };
  if (target.is_admin) return { ok: false, error: "Нельзя забанить администратора" };

  const expiresAt = durationDays ? new Date(Date.now() + durationDays * DAY_MS).toISOString() : null;
  const createdAt = nowIso();

  db.prepare("DELETE FROM bans WHERE user_id = ?").run(userId);
  db.prepare(
    `INSERT INTO bans (id, user_id, reason, banned_by, created_at, mode, rule_number, expires_at, is_auto)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    uid(),
    userId,
    String(reason || "Нарушение правил платформы"),
    bannedBy,
    createdAt,
    mode,
    ruleNumber,
    expiresAt,
    isAuto ? 1 : 0,
  );

  // Причина и пункт правил видны самому владельцу профиля.
  db.prepare("UPDATE users SET ban_reason = ?, ban_rule_number = ? WHERE id = ?").run(
    String(reason || "Нарушение правил платформы"),
    ruleNumber,
    userId,
  );

  const reset = mode === MODE_SERIOUS ? resetProfile(userId) : null;

  // Понижение галочки при бане (синяя/серебряная → бронзовая, бронзовая → снятие)
  // и уведомление об этом от @verifybot.
  const badge = badges.downgradeOnBan(userId);
  if (badge?.message) badges.notifyBadgeChange(userId, badge.message);

  logInfo(mode === MODE_SERIOUS ? "Выдан серьёзный бан" : "Выдан бан", {
    userId,
    username: target.username,
    reason,
    ruleNumber,
    durationDays,
    isAuto,
    bannedBy,
  });

  return {
    ok: true,
    mode,
    expiresAt,
    durationDays,
    reason: String(reason || "Нарушение правил платформы"),
    ruleNumber,
    reset,
    badge,
    previousUsername: reset?.previousUsername || target.username,
  };
}

/** Снимает бан. `by = null` — автоматическое снятие (истечение срока или @restorebot). */
function unban(userId, { by = null, reason = null } = {}) {
  const existing = db.prepare("SELECT * FROM bans WHERE user_id = ?").get(userId);
  if (!existing) return { ok: false, error: "Пользователь не забанен" };

  db.prepare("DELETE FROM bans WHERE user_id = ?").run(userId);
  db.prepare(
    "UPDATE users SET ban_reason = NULL, ban_rule_number = NULL, serious_banned = 0 WHERE id = ?",
  ).run(userId);

  logInfo("Бан снят", { userId, by, auto: !by, reason: reason || existing.reason });
  return { ok: true, previous: { reason: existing.reason, ruleNumber: existing.rule_number, mode: existing.mode } };
}

/** Снимает все баны с истёкшим сроком. */
function sweepExpiredBans() {
  const rows = db.prepare("SELECT user_id, expires_at FROM bans WHERE expires_at IS NOT NULL").all();
  let released = 0;
  for (const row of rows) {
    const expiresAt = new Date(row.expires_at).getTime();
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      unban(row.user_id, { by: null, reason: "expired" });
      released += 1;
    }
  }
  if (released > 0) logInfo(`Автоматически снято банов по истечении срока: ${released}`);
  return released;
}

/** Количество токсичных сообщений пользователя за указанное окно (в днях). */
function countToxicSince(userId, days = TOXIC_BAN_WINDOW_DAYS) {
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM toxic_messages WHERE user_id = ? AND created_at >= ?")
    .get(userId, since);
  return row ? row.c : 0;
}

/**
 * Авто-бан за токсичность: больше 20 токсичных сообщений за 7 дней.
 * Вызывается после каждого зафиксированного токсичного сообщения.
 */
function checkToxicAutoBan(userId) {
  if (isBanned(userId)) return { triggered: false, banned: true };
  const count = countToxicSince(userId);
  if (count <= TOXIC_BAN_THRESHOLD) return { triggered: false, banned: false, count };

  const ban = applyBan({
    userId,
    reason: `Автоматический бан: более ${TOXIC_BAN_THRESHOLD} токсичных сообщений за ${TOXIC_BAN_WINDOW_DAYS} дней`,
    ruleNumber: 1,
    mode: MODE_NORMAL,
    durationDays: TOXIC_BAN_DURATION_DAYS,
    bannedBy: null,
    isAuto: true,
  });

  if (!ban.ok) {
    logWarn("Не удалось применить авто-бан за токсичность", { userId, error: ban.error });
    return { triggered: false, banned: false, count };
  }

  return { triggered: true, banned: true, count, ban };
}

module.exports = {
  MODE_NORMAL,
  MODE_SERIOUS,
  TOXIC_BAN_THRESHOLD,
  TOXIC_BAN_WINDOW_DAYS,
  TOXIC_BAN_DURATION_DAYS,
  getBanState,
  isBanned,
  applyBan,
  unban,
  resetProfile,
  sweepExpiredBans,
  countToxicSince,
  checkToxicAutoBan,
  deleteUploadedFile,
};
