// Управление уровнями верификационных галочек.
//
// Уровни: 0 — нет, 1 — 🥉 бронзовая, 2 — 🥈 серебряная, 3 — 🔵 синяя (максимум).
// Галочка — визуальный префикс рядом с ником, никаких дополнительных прав она
// не даёт. Уровень можно выдать пользователю (в том числе боту — бот это тоже
// запись в users) и каналу.
//
// При бане: синяя и серебряная понижаются сразу до бронзовой, бронзовая
// снимается полностью. О понижении/снятии пользователю пишет @verifybot.

const db = require("../db");
const { logInfo } = require("../utils/logger");
const reputation = require("./reputation");
const { sendBotMessage } = require("./botMessages");
const { VERIFY_BOT_USERNAME } = require("../utils/validation");

const LEVEL_NONE = 0;
const LEVEL_BRONZE = 1;
const LEVEL_SILVER = 2;
const LEVEL_BLUE = 3;
const MAX_LEVEL = LEVEL_BLUE;

/** Название уровня — используется в уведомлениях @verifybot (иконку в текст не вставить). */
const LEVEL_LABELS = {
  0: null,
  1: "Бронзовая",
  2: "Серебряная",
  3: "Синяя",
};

const BADGE_REMOVED_MESSAGE =
  "Ваша верификационная галочка была снята за нарушение правил платформы!";

function levelLabel(level) {
  return LEVEL_LABELS[level] || null;
}

/** Текстовое уведомление о понижении уровня. */
function downgradeMessage(newLevel) {
  return `У Вашей верификационной галочки был понижен уровень на: ${levelLabel(newLevel)}!`;
}

function tableFor(targetType) {
  return targetType === "channel" ? "channels" : "users";
}

function getBadgeLevel(targetType, targetId) {
  const row = db
    .prepare(`SELECT badge_level FROM ${tableFor(targetType)} WHERE id = ?`)
    .get(targetId);
  return row ? row.badge_level ?? 0 : null;
}

/**
 * Выставляет уровень галочки.
 *
 * @param {{targetType?: 'user'|'channel', targetId: string, level: number,
 *   by?: string|null, enforceRestrictions?: boolean}} input
 *   enforceRestrictions=true применяет системные ограничения (ранг < 50 или
 *   блокировка от @restorebot). Администратор вызывает без него — он вправе
 *   выдать галочку вручную и снять ограничение.
 */
function setBadgeLevel({ targetType = "user", targetId, level, by = null, enforceRestrictions = false }) {
  const target = Math.max(LEVEL_NONE, Math.min(MAX_LEVEL, Math.round(Number(level) || 0)));

  if (targetType === "channel") {
    const channel = db.prepare("SELECT id, name, badge_level FROM channels WHERE id = ?").get(targetId);
    if (!channel) return { ok: false, error: "Канал не найден" };
    const previous = channel.badge_level ?? 0;
    db.prepare("UPDATE channels SET badge_level = ? WHERE id = ?").run(target, targetId);
    logInfo("Изменён уровень галочки канала", { targetId, name: channel.name, previous, level: target, by });
    return { ok: true, targetType, targetId, previous, level: target };
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId);
  if (!user) return { ok: false, error: "Пользователь не найден" };

  const previous = user.badge_level ?? 0;
  const restricted = !reputation.canEarnBronzeBadge(targetId);

  // Ограничение действует только на ПЕРВИЧНУЮ выдачу бронзы и выше.
  if (enforceRestrictions && target >= LEVEL_BRONZE && previous === LEVEL_NONE && restricted) {
    return {
      ok: false,
      error: "Пользователь не может получить галочку: низкий ранг или ограничение от @restorebot",
      code: "badge_locked",
      restricted: true,
    };
  }

  // verified остаётся синхронизированным, чтобы старые проверки не сломались.
  db.prepare("UPDATE users SET badge_level = ?, verified = ? WHERE id = ?").run(
    target,
    target > LEVEL_NONE ? 1 : 0,
    targetId,
  );
  logInfo("Изменён уровень галочки", {
    targetId,
    username: user.username,
    previous,
    level: target,
    by,
    isBot: !!user.is_bot,
  });
  return { ok: true, targetType: "user", targetId, previous, level: target, restricted };
}

/**
 * Понижение галочки при бане.
 * Синяя/серебряная → бронзовая, бронзовая → снятие. Возвращает текст
 * уведомления для @verifybot (null, если галочки не было).
 */
function downgradeOnBan(userId) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return null;

  const previous = user.badge_level ?? 0;
  if (previous === LEVEL_NONE) {
    return { changed: false, previous: LEVEL_NONE, level: LEVEL_NONE, message: null };
  }

  const next = previous === LEVEL_BRONZE ? LEVEL_NONE : LEVEL_BRONZE;
  db.prepare("UPDATE users SET badge_level = ?, verified = ? WHERE id = ?").run(
    next,
    next > LEVEL_NONE ? 1 : 0,
    userId,
  );

  const message = next === LEVEL_NONE ? BADGE_REMOVED_MESSAGE : downgradeMessage(next);
  logInfo("Галочка понижена при бане", { userId, username: user.username, previous, level: next });

  return { changed: true, previous, level: next, message };
}

/** Уведомляет пользователя о понижении/снятии галочки через @verifybot. */
function notifyBadgeChange(userId, message) {
  if (!message) return null;
  return sendBotMessage({ botUsername: VERIFY_BOT_USERNAME, toUserId: userId, text: message });
}

module.exports = {
  LEVEL_NONE,
  LEVEL_BRONZE,
  LEVEL_SILVER,
  LEVEL_BLUE,
  MAX_LEVEL,
  LEVEL_LABELS,
  BADGE_REMOVED_MESSAGE,
  levelLabel,
  downgradeMessage,
  getBadgeLevel,
  setBadgeLevel,
  downgradeOnBan,
  notifyBadgeChange,
};
