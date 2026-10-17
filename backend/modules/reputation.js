// Ранг пользователя (репутация) 0–100.
//
// Старт — 100. Каждое нарушение: −5. За каждые сутки без нарушений: +1
// (но не выше 100). Репутация ниже 50 закрывает доступ к бронзовой галочке —
// это ограничение накладывает @restorebot и снимает только администратор.
//
// Восстановление считается по факту (ленивый пересчёт при чтении + суточный
// тик), поэтому оно не зависит от того, был ли сервер запущен в нужный момент.

const db = require("../db");
const { logInfo } = require("../utils/logger");

const DAY_MS = 24 * 60 * 60 * 1000;

const START_REPUTATION = 100;
const MAX_REPUTATION = 100;
const MIN_REPUTATION = 0;
const VIOLATION_PENALTY = 5;
const DAILY_RECOVERY = 1;

/** Порог, ниже которого бронзовая галочка недоступна. */
const BRONZE_BADGE_MIN_REPUTATION = 50;

function toTime(value) {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : null;
}

function clamp(value) {
  return Math.max(MIN_REPUTATION, Math.min(MAX_REPUTATION, Math.round(value)));
}

/**
 * Начисляет +1 за каждые полные сутки без нарушений.
 * Идемпотентно: повторный вызов в тот же день ничего не меняет.
 */
function tickReputation(userId) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return null;

  const now = Date.now();
  const lastTick = toTime(user.last_reputation_tick) ?? toTime(user.created_at) ?? now;
  const lastViolation = toTime(user.last_violation_at);

  // Сутки, прошедшие после нарушения, начинают отсчёт заново: нарушение
  // «обнуляет» накопленные до него дни.
  const creditFrom = lastViolation && lastViolation > lastTick ? lastViolation : lastTick;
  const days = Math.floor((now - creditFrom) / DAY_MS);

  if (days <= 0) return user.reputation;

  const updated = clamp(user.reputation + days * DAILY_RECOVERY);
  const nextTick = new Date(creditFrom + days * DAY_MS).toISOString();
  db.prepare("UPDATE users SET reputation = ?, last_reputation_tick = ? WHERE id = ?").run(
    updated,
    nextTick,
    userId,
  );
  return updated;
}

/** Суточный проход по всем, у кого репутация не максимальна. */
function tickAllReputations() {
  const rows = db.prepare("SELECT id FROM users WHERE reputation < ?").all(MAX_REPUTATION);
  let updated = 0;
  for (const row of rows) {
    const before = db.prepare("SELECT reputation FROM users WHERE id = ?").get(row.id)?.reputation;
    const after = tickReputation(row.id);
    if (after !== before) updated += 1;
  }
  if (updated > 0) logInfo(`Репутация восстановлена у ${updated} пользовател(я/ей)`);
  return updated;
}

/** Нарушение: сначала начисляем заработанные дни, затем штраф −5. */
function applyViolation(userId, { penalty = VIOLATION_PENALTY } = {}) {
  tickReputation(userId);
  const user = db.prepare("SELECT reputation FROM users WHERE id = ?").get(userId);
  if (!user) return null;

  const updated = clamp(user.reputation - penalty);
  const now = new Date().toISOString();
  db.prepare("UPDATE users SET reputation = ?, last_violation_at = ?, last_reputation_tick = ? WHERE id = ?").run(
    updated,
    now,
    now,
    userId,
  );
  return updated;
}

function getReputation(userId) {
  const row = db.prepare("SELECT reputation FROM users WHERE id = ?").get(userId);
  return row ? row.reputation : null;
}

/** Разбирает JSON-поле restrictions; битые данные трактуются как пустые. */
function getRestrictions(userId) {
  const row = db.prepare("SELECT restrictions FROM users WHERE id = ?").get(userId);
  if (!row?.restrictions) return {};
  try {
    const parsed = JSON.parse(row.restrictions);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function setRestrictions(userId, restrictions) {
  db.prepare("UPDATE users SET restrictions = ? WHERE id = ?").run(
    JSON.stringify(restrictions || {}),
    userId,
  );
}

/** Может ли пользователь получить бронзовую галочку (нет блокировки от @restorebot и ранг ≥ 50). */
function canEarnBronzeBadge(userId) {
  const reputation = getReputation(userId);
  if (reputation === null) return false;
  if (reputation < BRONZE_BADGE_MIN_REPUTATION) return false;
  return !getRestrictions(userId).bronze_badge_blocked;
}

/** Блокирует получение бронзовой галочки (используется @restorebot). */
function blockBronzeBadge(userId) {
  const restrictions = getRestrictions(userId);
  restrictions.bronze_badge_blocked = true;
  setRestrictions(userId, restrictions);
  return restrictions;
}

/** Снимает блокировку бронзовой галочки — только администратор. */
function unblockBronzeBadge(userId) {
  const restrictions = getRestrictions(userId);
  delete restrictions.bronze_badge_blocked;
  setRestrictions(userId, restrictions);
  return restrictions;
}

module.exports = {
  START_REPUTATION,
  MAX_REPUTATION,
  MIN_REPUTATION,
  VIOLATION_PENALTY,
  DAILY_RECOVERY,
  BRONZE_BADGE_MIN_REPUTATION,
  tickReputation,
  tickAllReputations,
  applyViolation,
  getReputation,
  getRestrictions,
  setRestrictions,
  canEarnBronzeBadge,
  blockBronzeBadge,
  unblockBronzeBadge,
};
