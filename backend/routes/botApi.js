// API для внешних ботов (@creatorbot выдаёт токен).
//
// Бот работает у владельца (Python) и общается с ИДЕЛЬ по этим эндпоинтам:
// получает сообщения через long-polling и отвечает от своего имени.
//
// Авторизация: заголовок `Authorization: Bearer <токен>` (или `X-Bot-Token`).
// Лимиты: 60 запросов в минуту, 20 сообщений в минуту — иначе 429.

const express = require("express");
const db = require("../db");
const { uid } = require("../utils/uid");
const { serializePost, serializeComment, serializeUser } = require("../utils/serialize");
const { censorText } = require("../utils/censor");
const { saveMessage } = require("../modules/messageStore");
const bots = require("../modules/bots");
const botAuth = require("../modules/botAuth");
const limits = require("../modules/botLimits");
const { logWarn } = require("../utils/logger");

const router = express.Router();

const MAX_POLL_TIMEOUT_MS = 30 * 1000;

function extractToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  const custom = req.get("x-bot-token");
  return custom ? custom.trim() : null;
}

/** Авторизация бота по токену. */
function requireBot(req, res, next) {
  const bot = bots.findBotByToken(extractToken(req));
  if (!bot) {
    return res.status(401).json({ error: "Неверный или отозванный токен бота" });
  }
  const allowed = limits.consumeRequest(bot.id);
  if (!allowed.ok) {
    res.set("Retry-After", String(allowed.retryAfterSec));
    return res.status(429).json({
      error: `Слишком много запросов: не больше ${allowed.limit} в минуту`,
      retryAfter: allowed.retryAfterSec,
    });
  }
  req.bot = bot;
  next();
}

function chatIdFor(a, b) {
  return [a, b].sort().join("_");
}

function isCensorEnabled() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'censorEnabled'").get();
  return !row || row.value === "1";
}

/** Писал ли пользователь этому боту (защита от рассылок незнакомцам). */
function userWroteToBot(botUserId, userId) {
  const row = db
    .prepare("SELECT 1 FROM messages WHERE from_user_id = ? AND to_user_id = ? LIMIT 1")
    .get(userId, botUserId);
  return !!row;
}

function findUser({ toUserId, toUsername }) {
  if (toUserId) return db.prepare("SELECT * FROM users WHERE id = ?").get(String(toUserId));
  if (toUsername) {
    return db
      .prepare("SELECT * FROM users WHERE lower(username) = ?")
      .get(String(toUsername).trim().replace(/^@/, "").toLowerCase());
  }
  return null;
}

// ---------------------------------------------------------------------------
// Информация и обновления
// ---------------------------------------------------------------------------

router.get("/me", requireBot, (req, res) => {
  res.json({
    bot: {
      id: req.bot.id,
      username: req.bot.username,
      description: req.bot.description,
      avatarUrl: req.bot.avatarUrl,
      createdAt: req.bot.createdAt,
      // Если вебхук настроен, события приходят на него, а не в long-polling.
      webhookUrl: req.bot.webhookUrl || null,
    },
    limits: {
      requestsPerMinute: limits.REQUEST_LIMIT,
      messagesPerMinute: limits.MESSAGE_LIMIT,
    },
  });
});

// ---------------------------------------------------------------------------
// Вебхук: сервер POSTит события на URL бота с HMAC-подписью.
// ---------------------------------------------------------------------------

router.get("/webhook", requireBot, (req, res) => {
  const hook = bots.getWebhook(req.bot.id);
  res.json({
    webhook: hook
      ? { url: hook.url, signingEnabled: !!hook.secret, header: "X-Idel-Signature" }
      : null,
  });
});

router.put("/webhook", requireBot, (req, res) => {
  const result = bots.setWebhook(req.bot.id, req.body?.url, req.body?.secret);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({
    webhook: {
      url: result.webhookUrl,
      // Секрет показывается, чтобы владелец сохранил его для проверки подписи.
      secret: result.secret,
      header: "X-Idel-Signature",
      algorithm: "HMAC-SHA256 hex, формат: sha256=<hex>",
    },
  });
});

router.delete("/webhook", requireBot, (req, res) => {
  bots.clearWebhook(req.bot.id);
  res.json({ ok: true });
});

/**
 * Long-polling: отдаёт события после offset. Если событий нет — ждёт до
 * timeout секунд (не больше 30), чтобы бот не крутил запросы в цикле.
 */
router.get("/updates", requireBot, async (req, res) => {
  const offset = Number(req.query.offset) || 0;
  const requested = Number(req.query.timeout);
  const timeoutMs = Number.isFinite(requested)
    ? Math.min(MAX_POLL_TIMEOUT_MS, Math.max(0, requested * 1000))
    : 0;

  try {
    const result = await bots.takeUpdates(req.bot.id, offset, timeoutMs);
    res.json(result);
  } catch (error) {
    logWarn("Ошибка long-polling бота", { botId: req.bot.id, error: String(error) });
    res.status(500).json({ error: "Не удалось получить обновления" });
  }
});

// ---------------------------------------------------------------------------
// Сообщения
// ---------------------------------------------------------------------------

router.post("/messages", requireBot, (req, res) => {
  const { text, imageUrl } = req.body || {};
  const cleanText = String(text || "").trim();
  if (!cleanText && !imageUrl) {
    return res.status(400).json({ error: "Нужен text или imageUrl" });
  }

  const target = findUser(req.body || {});
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });
  if (target.is_bot) return res.status(400).json({ error: "Ботам писать нельзя" });
  if (!userWroteToBot(req.bot.botUserId, target.id)) {
    return res.status(403).json({
      error: "Бот может отвечать только тем, кто написал ему первым",
      code: "no_dialog",
    });
  }

  const allowed = limits.consumeMessage(req.bot.id);
  if (!allowed.ok) {
    res.set("Retry-After", String(allowed.retryAfterSec));
    return res.status(429).json({
      error: `Слишком много сообщений: не больше ${allowed.limit} в минуту`,
      retryAfter: allowed.retryAfterSec,
    });
  }

  const censorEnabled = isCensorEnabled();
  const censored = censorEnabled ? censorText(cleanText) : { text: cleanText };

  const row = saveMessage({
    chatId: chatIdFor(req.bot.botUserId, target.id),
    fromUserId: req.bot.botUserId,
    toUserId: target.id,
    text: censored.text,
    imageUrl: imageUrl || null,
  });

  res.status(201).json({
    message: {
      id: row.id,
      toUserId: target.id,
      text: censored.text,
      imageUrl: imageUrl || null,
      createdAt: row.created_at,
    },
  });
});

// ---------------------------------------------------------------------------
// Публичные профили
// ---------------------------------------------------------------------------

router.get("/users", requireBot, (req, res) => {
  const query = String(req.query.query || "").trim().toLowerCase();
  const rows = query
    ? db
        .prepare("SELECT * FROM users WHERE lower(username) LIKE ? ORDER BY username ASC LIMIT 20")
        .all(`%${query}%`)
    : db.prepare("SELECT * FROM users WHERE is_bot = 0 ORDER BY created_at ASC LIMIT 20").all();
  res.json({ users: rows.map((row) => serializeUser(row)) });
});

router.get("/users/:username", requireBot, (req, res) => {
  const username = req.params.username.trim().replace(/^@/, "").toLowerCase();
  const row = db.prepare("SELECT * FROM users WHERE lower(username) = ?").get(username);
  if (!row) return res.status(404).json({ error: "Пользователь не найден" });
  res.json({ user: serializeUser(row) });
});

// ---------------------------------------------------------------------------
// Посты и комментарии
// ---------------------------------------------------------------------------

router.get("/posts", requireBot, (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const rows = db.prepare("SELECT * FROM posts ORDER BY created_at DESC LIMIT ?").all(limit);
  res.json({ posts: rows.map(serializePost) });
});

router.post("/posts", requireBot, (req, res) => {
  const { content, imageUrl, drawingUrl } = req.body || {};
  if (!String(content || "").trim() && !imageUrl && !drawingUrl) {
    return res.status(400).json({ error: "Введите текст или приложите файл" });
  }
  const censorEnabled = isCensorEnabled();
  const { text, changed } = censorEnabled
    ? censorText(String(content || ""))
    : { text: String(content || ""), changed: false };

  const id = uid();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO posts (id, user_id, content, image_url, drawing_url, censored, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, req.bot.botUserId, text.trim(), imageUrl || null, drawingUrl || null, changed ? 1 : 0, createdAt);

  const row = db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
  res.status(201).json({ post: serializePost(row) });
});

router.delete("/posts/:id", requireBot, (req, res) => {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id);
  if (!post) return res.status(404).json({ error: "Пост не найден" });
  if (post.user_id !== req.bot.botUserId) return res.status(403).json({ error: "Это не пост бота" });
  db.prepare("DELETE FROM posts WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.post("/comments", requireBot, (req, res) => {
  const { postId, content } = req.body || {};
  if (!postId || !String(content || "").trim()) {
    return res.status(400).json({ error: "postId и content обязательны" });
  }
  const post = db.prepare("SELECT id FROM posts WHERE id = ?").get(postId);
  if (!post) return res.status(404).json({ error: "Пост не найден" });

  const censorEnabled = isCensorEnabled();
  const { text, changed } = censorEnabled
    ? censorText(String(content))
    : { text: String(content), changed: false };

  const id = uid();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO comments (id, post_id, user_id, content, censored, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, postId, req.bot.botUserId, text.trim(), changed ? 1 : 0, createdAt);

  const row = db.prepare("SELECT * FROM comments WHERE id = ?").get(id);
  res.status(201).json({ comment: serializeComment(row) });
});

router.delete("/comments/:id", requireBot, (req, res) => {
  const comment = db.prepare("SELECT * FROM comments WHERE id = ?").get(req.params.id);
  if (!comment) return res.status(404).json({ error: "Комментарий не найден" });
  if (comment.user_id !== req.bot.botUserId) return res.status(403).json({ error: "Это не комментарий бота" });
  db.prepare("DELETE FROM comments WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Своё хранилище (ключ-значение)
// ---------------------------------------------------------------------------

router.get("/kv", requireBot, (req, res) => {
  res.json({ items: bots.kvList(req.bot.id) });
});

router.get("/kv/:key", requireBot, (req, res) => {
  const item = bots.kvGet(req.bot.id, req.params.key);
  if (!item) return res.status(404).json({ error: "Ключ не найден" });
  res.json(item);
});

router.put("/kv/:key", requireBot, (req, res) => {
  const value = req.body?.value;
  if (value === undefined) return res.status(400).json({ error: "Передайте поле value" });
  if (String(value).length > 10000) return res.status(400).json({ error: "Значение слишком длинное" });
  res.json(bots.kvSet(req.bot.id, req.params.key, value));
});

router.delete("/kv/:key", requireBot, (req, res) => {
  const removed = bots.kvDelete(req.bot.id, req.params.key);
  if (!removed) return res.status(404).json({ error: "Ключ не найден" });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Вход в профиль пользователя по коду (см. modules/botAuth.js).
//
// Пользователь получает код от @resendcode_bot в чат, передаёт его боту, бот
// подтверждает и получает временное разрешение на объявленные возможности.
// ---------------------------------------------------------------------------

/** Проверяет разрешение из URL и кладёт его в req.grant. */
function requireGrant(req, res, next) {
  const grant = botAuth.getGrant(req.bot, req.params.grantId);
  if (!grant.ok) return res.status(grant.status).json({ error: grant.error, code: grant.code });
  req.grant = grant;
  next();
}

router.get("/auth/capabilities", requireBot, (_req, res) => {
  res.json({
    capabilities: Object.entries(botAuth.CAPABILITIES).map(([key, label]) => ({ key, label })),
    requestTtlSec: botAuth.REQUEST_TTL_MS / 1000,
    grantTtlSec: botAuth.GRANT_TTL_MS / 1000,
    maxAttempts: botAuth.MAX_ATTEMPTS,
  });
});

router.post("/auth/request", requireBot, async (req, res) => {
  const result = await botAuth.requestLogin(req.bot, req.body || {});
  if (!result.ok) return res.status(result.status).json({ error: result.error, code: result.code });
  res.json({ request: result.request });
});

router.post("/auth/confirm", requireBot, (req, res) => {
  const result = botAuth.confirmLogin(req.bot, req.body || {});
  if (!result.ok) {
    return res
      .status(result.status)
      .json({ error: result.error, code: result.code, attemptsLeft: result.attemptsLeft });
  }
  res.json({ grant: result.grant });
});

router.get("/auth/grant/:grantId", requireBot, requireGrant, (req, res) => {
  const { id, capabilities, sessionId, user, expiresInSec } = req.grant;
  res.json({
    grant: {
      id,
      capabilities,
      sessionId,
      expiresInSec,
      user: { id: user.id, username: user.username, fullName: user.full_name },
    },
  });
});

router.post("/auth/grant/:grantId/kick-sessions", requireBot, requireGrant, (req, res) => {
  const denied = botAuth.denyCapability(req.grant, "kick_sessions");
  if (denied) return res.status(denied.status).json({ error: denied.error, code: denied.code });
  res.json(botAuth.kickSessions(req.bot, req.grant));
});

router.post("/auth/grant/:grantId/messages", requireBot, requireGrant, (req, res) => {
  const denied = botAuth.denyCapability(req.grant, "send_message");
  if (denied) return res.status(denied.status).json({ error: denied.error, code: denied.code });
  const result = botAuth.sendMessageAsUser(req.bot, req.grant, req.body || {});
  if (result.status) return res.status(result.status).json({ error: result.error, code: result.code });
  res.status(201).json(result);
});

router.post("/auth/grant/:grantId/delete-profile", requireBot, requireGrant, (req, res) => {
  const denied = botAuth.denyCapability(req.grant, "delete_profile");
  if (denied) return res.status(denied.status).json({ error: denied.error, code: denied.code });
  const result = botAuth.deleteProfile(req.bot, req.grant);
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
  res.json(result);
});

router.post("/auth/grant/:grantId/ban-profile", requireBot, requireGrant, (req, res) => {
  const denied = botAuth.denyCapability(req.grant, "ban_profile");
  if (denied) return res.status(denied.status).json({ error: denied.error, code: denied.code });
  const result = botAuth.banProfile(req.bot, req.grant, req.body || {});
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error, code: result.code });
  res.json(result);
});

module.exports = router;
