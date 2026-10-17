// Система варнов.
//
// Варн выдаётся за запрещённый ник, мат, спам и другие нарушения.
// Три варна → автоматический бан без участия администратора.
// Учёт варнов ведётся в таблице warnings (issued_by = NULL → выдано системой).

const db = require("../db");
const { uid } = require("../utils/uid");
const { logInfo } = require("../utils/logger");
const reputation = require("./reputation");
const banSystem = require("./banSystem");

/** Сколько варнов приводят к автоматическому бану. */
const WARNINGS_TO_BAN = 3;

const CATEGORY_LABELS = {
  nickname: "Запрещённый ник",
  profanity: "Нецензурная лексика",
  spam: "Спам",
  toxicity: "Токсичное поведение",
  other: "Нарушение правил",
};

function labelFor(category) {
  return CATEGORY_LABELS[category] || CATEGORY_LABELS.other;
}

function countWarnings(userId) {
  const row = db.prepare("SELECT COUNT(*) AS c FROM warnings WHERE user_id = ?").get(userId);
  return row ? row.c : 0;
}

function listWarnings(userId) {
  return db.prepare("SELECT * FROM warnings WHERE user_id = ? ORDER BY created_at DESC").all(userId);
}

/**
 * Записывает варн без побочных эффектов (репутация, авто-бан).
 * Используется внутренними вызовами registerViolation.
 */
function addWarning({ userId, reason, category = "other", issuedBy = null, ruleNumber = null }) {
  const id = uid();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO warnings (id, user_id, reason, category, issued_by, created_at, rule_number)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, String(reason || labelFor(category)), category, issuedBy, createdAt, ruleNumber);
  return db.prepare("SELECT * FROM warnings WHERE id = ?").get(id);
}

/**
 * Единая точка фиксации нарушения: варн + −5 репутации + журнал токсичности
 * + проверка «3 варна → бан» и «>20 токсичных сообщений за 7 дней → бан».
 *
 * @param {{userId: string, reason?: string, category?: string, issuedBy?: string|null,
 *   source?: 'message'|'post'|'comment'|null, sourceId?: string|null,
 *   matched?: string|null, ruleNumber?: number|null}} input
 */
function registerViolation({
  userId,
  reason,
  category = "other",
  issuedBy = null,
  source = null,
  sourceId = null,
  matched = null,
  ruleNumber = null,
}) {
  const user = db.prepare("SELECT id, username FROM users WHERE id = ?").get(userId);
  if (!user) return { ok: false, error: "Пользователь не найден" };

  const text = String(reason || labelFor(category));

  // 1. Штраф к рангу (внутри учитываются заработанные дни восстановления).
  const newReputation = reputation.applyViolation(userId);

  // 2. Сам варн.
  const warning = addWarning({ userId, reason: text, category, issuedBy, ruleNumber });

  // 3. Журнал токсичного контента — окно для авто-бана за 7 дней.
  if (source) {
    db.prepare(
      "INSERT INTO toxic_messages (id, user_id, source, source_id, matched, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(uid(), userId, source, sourceId, matched, warning.created_at);
  }

  const count = countWarnings(userId);
  let ban = null;
  let autoBan = null;

  if (!banSystem.isBanned(userId)) {
    if (count >= WARNINGS_TO_BAN) {
      // 4. Три варна — автоматический бан.
      const result = banSystem.applyBan({
        userId,
        reason: `Автоматический бан: ${count} предупреждения за нарушение правил платформы`,
        ruleNumber,
        mode: banSystem.MODE_NORMAL,
        bannedBy: null,
        isAuto: true,
      });
      if (result.ok) ban = result;
    } else if (source) {
      // 5. Отдельный предохранитель: поток токсичных сообщений.
      const toxicResult = banSystem.checkToxicAutoBan(userId);
      if (toxicResult.triggered) autoBan = toxicResult.ban;
    }
  }

  logInfo("Зафиксировано нарушение", {
    userId,
    username: user.username,
    category,
    source,
    warnings: count,
    reputation: newReputation,
    banned: !!(ban || autoBan),
    issuedBy: issuedBy || "system",
  });

  return {
    ok: true,
    warning,
    warningId: warning.id,
    warningsCount: count,
    reputation: newReputation,
    banned: !!(ban || autoBan),
    ban: ban || autoBan,
  };
}

module.exports = {
  WARNINGS_TO_BAN,
  CATEGORY_LABELS,
  labelFor,
  countWarnings,
  listWarnings,
  addWarning,
  registerViolation,
};
