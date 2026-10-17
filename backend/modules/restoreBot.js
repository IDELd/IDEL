// Логика бота @restorebot — разбан и апелляции.
//
// Если блокировка связана с нецензурной лексикой (мат), бот снимает её сам и
// накладывает ограничение на получение бронзовой галочки (низкая репутация).
// Снять это ограничение может только администратор.
//
// Во всех остальных случаях (запрещённый ник, спам и т.п.) создаётся
// апелляция, которую рассматривает администратор.

const db = require("../db");
const { uid } = require("../utils/uid");
const { logInfo, logWarn } = require("../utils/logger");
const banSystem = require("./banSystem");
const reputation = require("./reputation");
const { sendBotMessage } = require("./botMessages");
const { RESTORE_BOT_USERNAME } = require("../utils/validation");

/** Признаки «мата» в причине бана. */
const PROFANITY_RE = /(мат\b|маты|матерн|нецензурн|токсичн|оскорбл|profan|abuse)/i;

function latestBan(userId) {
  return db.prepare("SELECT * FROM bans WHERE user_id = ?").get(userId);
}

function banWarnings(userId, beforeIso) {
  return db
    .prepare(
      "SELECT * FROM warnings WHERE user_id = ? AND created_at <= ? ORDER BY created_at DESC LIMIT 20",
    )
    .all(userId, beforeIso);
}

/**
 * Блокировка «за маты».
 *
 * Ручной бан администратора решается только по тексту причины: если админ
 * забанил за «пункт правил», а не за нецензурную лексику, бот не должен
 * снимать такой бан сам — даже если раньше у аккаунта были варны за мат
 * (их никто не чистит после наказания).
 *
 * Для автоматических банов (3 предупреждения, поток токсичных сообщений)
 * смотрим и текст причины, и категории варнов, которые привели к бану
 * (только до даты бана — старые варны после снятия бана не в счёт).
 */
function isProfanityBan(userId, ban) {
  const reason = String(ban?.reason || "");
  if (ban && !ban.is_auto && ban.banned_by) {
    return PROFANITY_RE.test(reason);
  }
  if (PROFANITY_RE.test(reason)) return true;
  return banWarnings(userId, ban?.created_at).some((warning) => warning.category === "profanity");
}

function findPendingAppeal(userId) {
  return db
    .prepare("SELECT * FROM appeals WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC")
    .get(userId);
}

function createAppeal({ userId, banReason, appealText }) {
  const id = uid();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO appeals (id, user_id, ban_reason, appeal_text, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
  ).run(id, userId, banReason || null, String(appealText || "").trim(), createdAt);
  logInfo("Создана апелляция", { userId, banReason });
  return db.prepare("SELECT * FROM appeals WHERE id = ?").get(id);
}

/** Уведомление пользователя о решении по апелляции (от @restorebot). */
function notifyAppealDecision(userId, approved, comment) {
  const text = approved
    ? "Ваша апелляция одобрена ✅ Блокировка снята, доступ к публикациям и сообщениям восстановлен."
    : `Ваша апелляция отклонена. Блокировка остаётся в силе.${comment ? `\n\nКомментарий администрации: ${comment}` : ""}`;
  return sendBotMessage({ botUsername: RESTORE_BOT_USERNAME, toUserId: userId, text });
}

/**
 * Обрабатывает обращение пользователя к @restorebot.
 * @returns {{action: 'none'|'unban'|'appeal'|'appeal_pending', message: string, appeal?: object}}
 */
function handleRestoreRequest(userId, incomingText) {
  const state = banSystem.getBanState(userId);
  if (!state.banned) {
    return {
      action: "none",
      message:
        "Ваш аккаунт не заблокирован ✅ Если вы хотите обжаловать снятие галочки или ограничение, " +
        "опишите ситуацию — я передам обращение администрации.",
    };
  }

  const ban = latestBan(userId);

  // 1. Мат (любое количество) — разбаниваем автоматически.
  if (isProfanityBan(userId, ban)) {
    banSystem.unban(userId, { by: null, reason: "auto-restore: нецензурная лексика" });
    reputation.blockBronzeBadge(userId);

    // Открытые апелляции больше не нужны: доступ восстановлен.
    const closed = db
      .prepare(
        `UPDATE appeals SET status = 'approved', decided_by = NULL, decided_at = ?, decision_comment = ?
         WHERE user_id = ? AND status = 'pending'`,
      )
      .run(new Date().toISOString(), "Автоматический разбан @restorebot за нецензурную лексику", userId);

    logInfo("Авторазбан @restorebot", { userId, closedAppeals: closed.changes });

    return {
      action: "unban",
      message:
        "Проверил вашу блокировку: она за нецензурную лексику, поэтому я снимаю её автоматически 🔓\n\n" +
        "Но репутация снижена, и бронзовая галочка пока недоступна — это ограничение снимает только администрация.",
    };
  }

  // 2. Всё остальное (ники, спам и т.п.) — апелляция на решение администрации.
  const pending = findPendingAppeal(userId);
  if (pending) {
    return {
      action: "appeal_pending",
      message:
        "Ваша апелляция уже на рассмотрении у администрации ⏳ Я напишу сюда, как только будет решение.",
      appeal: pending,
    };
  }

  const appeal = createAppeal({
    userId,
    banReason: ban?.reason || state.reason || null,
    appealText: String(incomingText || "").trim() || "Прошу пересмотреть блокировку.",
  });

  return {
    action: "appeal",
    message:
      "Эта блокировка не связана с нецензурной лексикой, поэтому я передал апелляцию администрации 📨\n\n" +
      `Номер обращения: ${appeal.id.slice(0, 8)}. Ответ придёт сюда.`,
    appeal,
  };
}

module.exports = {
  PROFANITY_RE,
  isProfanityBan,
  createAppeal,
  findPendingAppeal,
  notifyAppealDecision,
  handleRestoreRequest,
};
