// ИДЕЛЬ ПРЕМИУМ — подписка.
//
// Получить её можно только от администратора (в админ-панели) либо разово
// через @creatorbot командой /premium: триал на 3 дня даётся один раз на
// аккаунт. Что даёт подписка:
//   * персиковый значок перед ником и переливающийся персиковый ник;
//   * свой цвет текста в сообщениях, комментариях и постах (виден всем);
//   * авто-расшифровка голосовых комментариев, записанных в браузере.
//
// Галочки (badge_level) к подписке отношения не имеют — это разные вещи.

const db = require("../db");
const { logInfo } = require("../utils/logger");

/** Срок разового триала. */
const TRIAL_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** «Бессрочно» храним датой-маркером, чтобы сравнения оставались простыми. */
const PERMANENT_UNTIL = "9999-12-31T23:59:59.000Z";

/**
 * Палитра цветов текста. Специально средние тона: читаются и на светлой
 * карточке, и на тёмной плашке своего сообщения.
 */
const MESSAGE_COLORS = [
  "#e2603c",
  "#d97706",
  "#c2410c",
  "#b91c1c",
  "#a21caf",
  "#4338ca",
  "#0e7490",
  "#15803d",
];

function isPremium(user) {
  if (!user?.premium_until) return false;
  return new Date(user.premium_until).getTime() > Date.now();
}

function isPermanent(user) {
  return user?.premium_until === PERMANENT_UNTIL;
}

/** Публичное состояние подписки. */
function getState(userId) {
  const user = db
    .prepare("SELECT premium_until, premium_trial_used, message_color FROM users WHERE id = ?")
    .get(userId);
  if (!user) return null;
  return {
    premium: isPremium(user),
    permanent: isPermanent(user),
    until: user.premium_until || null,
    trialUsed: !!user.premium_trial_used,
    messageColor: user.message_color || null,
  };
}

/**
 * Выдаёт подписку.
 * @param {{userId: string, days?: number|null, permanent?: boolean, by?: string|null}} input
 */
function grant({ userId, days = null, permanent = false, by = null }) {
  const user = db.prepare("SELECT id, premium_until FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, error: "Пользователь не найден" };

  let until;
  if (permanent) {
    until = PERMANENT_UNTIL;
  } else {
    const parsed = Number(days);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { ok: false, error: "Укажите срок подписки" };
    }
    // Продление считается от текущего срока, если он ещё не истёк.
    const base = isPremium(user) && !isPermanent(user) ? new Date(user.premium_until).getTime() : Date.now();
    until = new Date(base + parsed * DAY_MS).toISOString();
  }

  db.prepare("UPDATE users SET premium_until = ? WHERE id = ?").run(until, userId);
  logInfo("Выдана подписка ИДЕЛЬ ПРЕМИУМ", { userId, until, permanent, by: by || "trial" });
  mirrorState(userId);
  return { ok: true, until, permanent };
}

/** Снимает подписку и цвет сообщений. */
function revoke(userId, { by = null } = {}) {
  const user = db.prepare("SELECT premium_until FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, error: "Пользователь не найден" };
  db.prepare("UPDATE users SET premium_until = NULL, message_color = NULL WHERE id = ?").run(userId);
  logInfo("Подписка ИДЕЛЬ ПРЕМИУМ снята", { userId, by });
  mirrorState(userId);
  return { ok: true };
}

/** Копия состояния подписки в Supabase (best-effort, не блокирует ответ). */
function mirrorState(userId) {
  try {
    const state = getState(userId);
    require("./cloudMirror")
      .mirrorPremium({
        userId,
        active: !!state?.premium,
        until: state?.until || null,
        permanent: !!state?.permanent,
      })
      .catch(() => {});
  } catch {
    /* зеркало не должно ломать выдачу подписки */
  }
}

/**
 * Разовый триал на 3 дня (команда /premium в @creatorbot).
 * Триал не расходуется, если подписка уже активна.
 */
function grantTrial(userId) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, reason: "not_found" };

  if (isPremium(user)) {
    return {
      ok: false,
      reason: "already_premium",
      until: user.premium_until,
      permanent: isPermanent(user),
    };
  }
  if (user.premium_trial_used) {
    return { ok: false, reason: "used" };
  }

  const until = new Date(Date.now() + TRIAL_DAYS * DAY_MS).toISOString();
  db.prepare("UPDATE users SET premium_until = ?, premium_trial_used = 1 WHERE id = ?").run(until, userId);
  logInfo("Выдан триал ИДЕЛЬ ПРЕМИУМ", { userId, days: TRIAL_DAYS, until });
  mirrorState(userId);
  return { ok: true, until, days: TRIAL_DAYS };
}

/** Устанавливает цвет текста (только для подписчиков). */
function setMessageColor(userId, color) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, error: "Пользователь не найден" };
  if (!isPremium(user)) return { ok: false, error: "Цвет текста доступен по подписке ИДЕЛЬ ПРЕМИУМ", code: "premium_required" };

  if (color === null || color === undefined || color === "") {
    db.prepare("UPDATE users SET message_color = NULL WHERE id = ?").run(userId);
    return { ok: true, color: null };
  }

  const normalized = String(color).trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(normalized)) {
    return { ok: false, error: "Цвет должен быть в формате #RRGGBB" };
  }
  if (!MESSAGE_COLORS.includes(normalized)) {
    return { ok: false, error: "Выберите цвет из доступной палитры", code: "color_not_allowed" };
  }

  db.prepare("UPDATE users SET message_color = ? WHERE id = ?").run(normalized, userId);
  logInfo("Изменён цвет сообщений", { userId, color: normalized });
  return { ok: true, color: normalized };
}

module.exports = {
  TRIAL_DAYS,
  PERMANENT_UNTIL,
  MESSAGE_COLORS,
  isPremium,
  isPermanent,
  getState,
  grant,
  revoke,
  grantTrial,
  setMessageColor,
};
