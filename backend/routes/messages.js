const express = require("express");
const db = require("../db");
const { uid } = require("../utils/uid");
const { requireAuth } = require("../middleware/auth");
const { serializeUser, serializeMessage } = require("../utils/serialize");
const { isBlockedEitherWay } = require("../utils/blockCheck");
const { VERIFY_BOT_USERNAME, RESTORE_BOT_USERNAME, PREMIUM_BOT_USERNAME, CREATOR_BOT_USERNAME, RESEND_CODE_BOT_USERNAME } = require("../utils/validation");
const { censorText } = require("../utils/censor");
const banSystem = require("../modules/banSystem");
const automators = require("../modules/ruleAutomators");
const restoreBot = require("../modules/restoreBot");
const premiumBot = require("../modules/premiumBot");
const creatorBot = require("../modules/creatorBot");
const botVerification = require("../modules/botVerification");
const resendCodeBot = require("../modules/resendCodeBot");
const bots = require("../modules/bots");
const botWebhook = require("../modules/botWebhook");
const { saveMessage } = require("../modules/messageStore");

const router = express.Router();

function chatIdFor(a, b) {
  return [a, b].sort().join("_");
}

function isCensorEnabled() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'censorEnabled'").get();
  return !row || row.value === "1";
}

function getBotUser(username = VERIFY_BOT_USERNAME) {
  return db
    .prepare("SELECT * FROM users WHERE lower(username) = ? AND is_bot = 1")
    .get(String(username).toLowerCase());
}

/** Very small rule-based "algorithm" behind @verifybot's replies — ported 1:1 from the client. */
function getVerifyBotReplyText(userId, incomingText) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  const lower = String(incomingText || "").trim().toLowerCase();

  if (user?.verified) {
    return "Ваш аккаунт уже верифицирован ✅. Спасибо, что пользуетесь ИДЕЛЬ!";
  }

  const pending = db
    .prepare("SELECT 1 FROM verification_requests WHERE user_id = ? AND status = 'pending'")
    .get(userId);
  if (pending) {
    return "Ваша заявка уже на рассмотрении у администрации. Я сообщу здесь, как только будет решение.";
  }

  const wantsVerification =
    /(верифи|verify|подтверд)/.test(lower) ||
    lower === "/verify" ||
    lower === "начать" ||
    lower === "старт" ||
    lower === "/start";

  if (wantsVerification) {
    db.prepare(
      "INSERT INTO verification_requests (id, user_id, status, created_at) VALUES (?, ?, 'pending', ?)",
    ).run(uid(), userId, new Date().toISOString());
    return "Заявка на верификацию отправлена ✅. Администрация рассмотрит её в ближайшее время, я напишу сюда о результате.";
  }

  return (
    "Привет! Я @verifybot — я подаю заявки на верификацию аккаунтов ИДЕЛЬ.\n\n" +
    "Напишите мне «верификация» (или /verify), чтобы отправить заявку."
  );
}

/**
 * Диспетчер ответов ботов: @restorebot занимается разбаном и апелляциями,
 * @premiumbot — подпиской ИДЕЛЬ ПРЕМИУМ, остальные отвечают как @verifybot.
 */
function getBotReplyText(bot, userId, incomingText, context = {}) {
  const username = String(bot?.username || "").toLowerCase();
  if (username === RESTORE_BOT_USERNAME) {
    return restoreBot.handleRestoreRequest(userId, incomingText).message;
  }
  if (username === PREMIUM_BOT_USERNAME) {
    return premiumBot.handlePremiumRequest(userId, incomingText).message;
  }
  if (username === CREATOR_BOT_USERNAME) {
    return creatorBot.handleCreatorRequest(userId, { text: incomingText, imageUrl: context.imageUrl }).message;
  }
  // @verifybot: сначала опрос верификации ботов, затем обычный сценарий.
  if (username === VERIFY_BOT_USERNAME) {
    const botAnswer = botVerification.handleVerifyBotMessage(userId, incomingText);
    if (botAnswer !== null) return botAnswer;
  }
  if (username === RESEND_CODE_BOT_USERNAME) {
    return resendCodeBot.handleResendCodeRequest(userId, incomingText).message;
  }
  return getVerifyBotReplyText(userId, incomingText);
}

router.get("/chats", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT DISTINCT CASE WHEN from_user_id = ? THEN to_user_id ELSE from_user_id END AS other_id
       FROM messages WHERE from_user_id = ? OR to_user_id = ?`,
    )
    .all(req.userId, req.userId, req.userId);
  if (rows.length === 0) return res.json({ users: [] });
  const placeholders = rows.map(() => "?").join(",");
  const users = db
    .prepare(`SELECT * FROM users WHERE id IN (${placeholders})`)
    .all(...rows.map((r) => r.other_id));
  // Чаты забаненных пользователей скрыты от остальных участников.
  const visible = users.filter((u) => !banSystem.isBanned(u.id));
  res.json({ users: visible.map((u) => serializeUser(u)) });
});

// Бот по умолчанию — @verifybot; другого можно запросить через ?username=.
router.get("/bot", requireAuth, (req, res) => {
  const requested = typeof req.query.username === "string" ? req.query.username : VERIFY_BOT_USERNAME;
  const bot = getBotUser(requested);
  if (!bot) return res.status(404).json({ error: `@${requested} не инициализирован` });
  res.json({ user: serializeUser(bot) });
});

// Приветственное сообщение выбранного бота (@verifybot или @restorebot).
// botId приходит из интерфейса чата; при отсутствии используется @verifybot.
router.post("/bot/welcome", requireAuth, (req, res) => {
  const requestedId = req.body?.botId;
  let bot = null;
  if (requestedId) {
    bot = db.prepare("SELECT * FROM users WHERE id = ? AND is_bot = 1").get(requestedId);
  } else {
    bot = getBotUser(typeof req.body?.username === "string" ? req.body.username : VERIFY_BOT_USERNAME);
  }
  if (!bot) return res.status(404).json({ error: "Бот не инициализирован" });

  const chatId = chatIdFor(bot.id, req.userId);
  const already = db.prepare("SELECT 1 FROM messages WHERE chat_id = ?").get(chatId);
  if (!already) {
    saveMessage({
      chatId,
      fromUserId: bot.id,
      toUserId: req.userId,
      text: getBotReplyText(bot, req.userId, ""),
    });
  }
  res.json({ ok: true, botId: bot.id });
});

router.get("/:userId", requireAuth, (req, res) => {
  // Переписка с забаненным скрыта от остальных (администратор видит всё).
  if (!req.user.is_admin && banSystem.isBanned(req.params.userId)) {
    return res.status(403).json({
      error: "Профиль пользователя был заблокирован за нарушение правил использования платформы!",
      code: "banned_target",
    });
  }
  const chatId = chatIdFor(req.userId, req.params.userId);
  const rows = db
    .prepare("SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC")
    .all(chatId);
  res.json({ messages: rows.map(serializeMessage) });
});

router.post("/", requireAuth, (req, res) => {
  const { toUserId, text, imageUrl } = req.body || {};
  if (!toUserId || (!String(text || "").trim() && !imageUrl)) {
    return res.status(400).json({ error: "Нужен текст или картинка" });
  }

  const recipient = db.prepare("SELECT * FROM users WHERE id = ?").get(toUserId);
  if (!recipient) return res.status(404).json({ error: "Пользователь не найден" });

  // Забаненный пользователь не может отправлять сообщения — кроме переписки
  // с ботами: через @restorebot он подаёт апелляцию на блокировку.
  if (banSystem.isBanned(req.userId) && !recipient.is_bot) {
    return res.status(403).json({ error: "Вы заблокированы и не можете отправлять сообщения", code: "banned" });
  }
  if (isBlockedEitherWay(db, req.userId, toUserId)) {
    return res.status(403).json({ error: "Пользователь недоступен" });
  }
  // Забаненному нельзя писать: его чаты скрыты от остальных.
  if (!recipient.is_bot && !req.user.is_admin && banSystem.isBanned(toUserId)) {
    return res.status(403).json({
      error: "Профиль пользователя был заблокирован за нарушение правил использования платформы!",
      code: "banned_target",
    });
  }

  // Мат в переписке фильтруется и фиксируется как нарушение (варн, −5 к рангу,
  // журнал токсичности для авто-бана за 20 сообщений в неделю).
  const rawText = String(text).trim();
  const censorEnabled = isCensorEnabled();
  const censored = censorEnabled
    ? censorText(rawText)
    : { text: rawText, changed: false, matches: [] };

  const chatId = chatIdFor(req.userId, toUserId);
  const saved = saveMessage({
    chatId,
    fromUserId: req.userId,
    toUserId,
    text: censored.text,
    imageUrl: imageUrl || null,
    createdAt: new Date().toISOString(),
  });

  // Автоматоры правил: мат, оскорбления, спам и т.д. в личной переписке.
  // Баны и варны за это ловят автоматоры, а не отдельная проверка цензора.
  const violation = automators.applyAutomators({
    userId: req.userId,
    context: "message",
    text: rawText,
    source: "message",
    sourceId: saved.id,
    imageUrl: imageUrl || null,
  });
  const removed = !!violation?.removed;

  // Системные боты (@verifybot, @restorebot, @premiumbot, @creatorbot) отвечают
  // сами. Боту, созданному через @creatorbot, событие кладём в очередь: он
  // работает у владельца и забирает его через long-polling.
  if (recipient.is_bot) {
    const platformBot = bots.getBotByBotUserId(recipient.id);
    if (platformBot) {
      // Вебхук, если он настроен, иначе очередь long-polling.
      botWebhook.deliver(platformBot, "message", {
        messageId: saved.id,
        chatId,
        fromUserId: req.userId,
        fromUsername: req.user.username,
        text: censored.text,
        imageUrl: imageUrl || null,
        createdAt: saved.created_at,
      });
    } else {
      // Боту передаём исходный текст: фильтр не должен ломать команды
      // вроде /verify или /my_bots.
      saveMessage({
        chatId,
        fromUserId: recipient.id,
        toUserId: req.userId,
        text: getBotReplyText(recipient, req.userId, rawText, { imageUrl: imageUrl || null }),
      });
    }
  }

  res.status(201).json({
    message: serializeMessage(saved),
    removed,
    ruleNumber: removed ? violation.rule.number : undefined,
    ruleTitle: removed ? violation.rule.title : undefined,
  });
});

module.exports = router;
