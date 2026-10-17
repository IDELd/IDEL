// Отправка сообщений от имени бота (@verifybot, @restorebot, @creatorbot) в чат
// пользователя. Используется уведомлениями о галочках, банах и разбане.

const db = require("../db");
const { logWarn } = require("../utils/logger");
const { saveMessage } = require("./messageStore");

function chatIdFor(a, b) {
  return [a, b].sort().join("_");
}

function findBot(botUsername) {
  return db
    .prepare("SELECT * FROM users WHERE lower(username) = ? AND is_bot = 1")
    .get(String(botUsername || "").toLowerCase());
}

/**
 * Кладёт сообщение от бота в личный диалог с пользователем.
 * @returns {object|null} строка сообщения либо null, если бот не найден/не создан.
 */
function sendBotMessage({ botUsername, toUserId, text }) {
  const bot = findBot(botUsername);
  if (!bot) {
    logWarn("Сообщение бота не отправлено: бот не найден", { botUsername, toUserId });
    return null;
  }
  const recipient = db.prepare("SELECT id FROM users WHERE id = ?").get(toUserId);
  if (!recipient) {
    logWarn("Сообщение бота не отправлено: получатель не найден", { botUsername, toUserId });
    return null;
  }

  return saveMessage({
    chatId: chatIdFor(bot.id, toUserId),
    fromUserId: bot.id,
    toUserId,
    text: String(text),
  });
}

module.exports = { sendBotMessage, findBot };
