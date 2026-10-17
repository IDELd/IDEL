// Опрос верификации ботов в @verifybot.
//
// Когда владелец бота в @creatorbot пишет /verify <бот> или выбирает пункт
// меню, для аккаунта бота создаётся заявка в verification_requests. Затем
// владелец заходит в чат с @verifybot — тот задаёт пять вопросов, записывает
// ответы в заявку и отправляет её на рассмотрение администрации. Галочку
// выдаёт/выбирает администратор в панели: сам бот галочку не присваивает.

const db = require("../db");
const { logInfo } = require("../utils/logger");

const BOT_QUESTIONS = [
  "Что делает ваш бот?",
  "Какие команды он понимает? Перечислите через запятую.",
  "Есть ли исходный код бота? Пришлите ссылку или напишите «нет».",
  "Подтверждаете, что бот не рассылает спам и рекламу? Да / нет",
  "Зачем боту галочка ИДЕЛЬ?",
];

function getDialog(userId) {
  const row = db.prepare("SELECT * FROM verify_dialogs WHERE user_id = ?").get(userId);
  if (!row) return null;
  let answers = [];
  try {
    answers = row.answers ? JSON.parse(row.answers) : [];
  } catch {
    answers = [];
  }
  return { verificationId: row.verification_id, step: row.step, answers };
}

function setDialog(userId, verificationId, step, answers) {
  db.prepare(
    `INSERT INTO verify_dialogs (user_id, verification_id, step, answers, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       verification_id = excluded.verification_id,
       step = excluded.step,
       answers = excluded.answers,
       updated_at = excluded.updated_at`,
  ).run(userId, verificationId, step, JSON.stringify(answers), new Date().toISOString());
}

function clearDialog(userId) {
  db.prepare("DELETE FROM verify_dialogs WHERE user_id = ?").run(userId);
}

/**
 * Ожидающие заявки на верификацию ботов владельца, по которым ещё не собран
 * опрос. Заявки с ответами сюда не попадают: иначе после завершения опроса
 * любое новое сообщение в @verifybot начинало бы его заново.
 */
function pendingBotRequests(userId) {
  return db
    .prepare(
      `SELECT vr.*, u.username AS bot_name
       FROM verification_requests vr
       JOIN bots b ON b.bot_user_id = vr.user_id
       JOIN users u ON u.id = b.bot_user_id
       WHERE b.user_id = ? AND vr.status = 'pending'
         AND (vr.ai_details IS NULL OR vr.ai_details NOT LIKE '%"answers"%')
       ORDER BY vr.created_at ASC`,
    )
    .all(userId);
}

function finishDialog(userId, verificationId, answers) {
  // Ответы кладём в ai_details: для бот-заявок там объект {type:'bot', answers}.
  db.prepare("UPDATE verification_requests SET ai_details = ? WHERE id = ?").run(
    JSON.stringify({ type: "bot", answers }),
    verificationId,
  );
  clearDialog(userId);
  logInfo("Завершён опрос верификации бота", { userId, verificationId });
}

/**
 * Обрабатывает сообщение в @verifybot.
 * @returns {string|null} текст ответа или null, если обрабатывать должен
 *   обычный сценарий @verifybot.
 */
function handleVerifyBotMessage(userId, incomingText) {
  const text = String(incomingText || "").trim();
  const lower = text.toLowerCase();

  // 1. Активный опрос.
  const dialog = getDialog(userId);
  if (dialog) {
    if (lower === "/cancel" || lower === "отмена") {
      clearDialog(userId);
      return "Опрос прерван. Заявку можно подать снова через @creatorbot: /verify <бот>.";
    }

    // step -1 — выбор бота из списка, если заявок больше одной.
    if (dialog.step === -1) {
      const pending = pendingBotRequests(userId);
      const index = Number(text);
      if (!Number.isInteger(index) || index < 1 || index > pending.length) {
        return (
          "Выберите бота номером:\n" +
          pending.map((r, i) => `${i + 1}. @${r.bot_name}`).join("\n")
        );
      }
      const chosen = pending[index - 1];
      setDialog(userId, chosen.id, 0, []);
      return `Начинаем. Вопрос 1 из ${BOT_QUESTIONS.length}.\n\n${BOT_QUESTIONS[0]}`;
    }

    const answers = dialog.answers;
    answers.push(text || "—");
    const nextStep = dialog.step + 1;

    if (nextStep < BOT_QUESTIONS.length) {
      setDialog(userId, dialog.verificationId, nextStep, answers);
      return `Вопрос ${nextStep + 1} из ${BOT_QUESTIONS.length}.\n\n${BOT_QUESTIONS[nextStep]}`;
    }

    finishDialog(userId, dialog.verificationId, answers);
    return "Спасибо! Ответы записаны. Заявка у администрации — решение придёт сюда.";
  }

  // 2. Нет активного опроса — есть ли заявки на верификацию ботов?
  const pending = pendingBotRequests(userId);
  if (pending.length === 1) {
    setDialog(userId, pending[0].id, 0, []);
    return `У вас есть заявка на галочку для бота @${pending[0].bot_name}. Начнём опрос.\n\nВопрос 1 из ${BOT_QUESTIONS.length}.\n\n${BOT_QUESTIONS[0]}`;
  }
  if (pending.length > 1) {
    setDialog(userId, "", -1, []);
    return "У вас несколько заявок на галочку для ботов. Выберите бота номером:\n" +
      pending.map((r, i) => `${i + 1}. @${r.bot_name}`).join("\n");
  }

  return null;
}

module.exports = {
  BOT_QUESTIONS,
  handleVerifyBotMessage,
  pendingBotRequests,
};