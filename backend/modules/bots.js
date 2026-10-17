// Ядро платформы ботов (@creatorbot).
//
// Бот — это обычная запись в users (is_bot = 1) плюс строка в bots с
// API-токеном. Токен показывается владельцу (хранится зашифрованным) и
// ищется при авторизации по sha256-хешу. Все действия бота идут через
// официальный API /api/bot/*, код бота исполняется у владельца.

const crypto = require("crypto");
const db = require("../db");
const { uid } = require("../utils/uid");
const { logInfo, logWarn } = require("../utils/logger");
const { checkNickname } = require("./nicknameFilter");
const { createCipher } = require("./crypto");

const TOKEN_BYTES = 32;
const KEY_SOURCE =
  process.env.BOT_TOKEN_ENC_KEY ||
  process.env.MESSAGE_ENC_KEY ||
  process.env.SESSION_ENC_KEY ||
  process.env.JWT_SECRET ||
  "idel_dev_bot_key";
const { encrypt, decrypt } = createCipher(KEY_SOURCE);

/** Сколько ботов может создать один владелец. */
const MAX_BOTS_PER_USER = 10;

/** Допустимые формы имени бота (после приведения к нижнему регистру, без @). */
const NAME_PATTERNS = [
  { label: "vasyapupkin_bot", re: /^[a-z0-9_]{2,20}_bot$/ },
  { label: "bot_vasyapupkin", re: /^bot_[a-z0-9_]{2,20}$/ },
  { label: "vasyapupkinBot", re: /^[a-z0-9_]{2,20}bot$/ },
];

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function generateToken() {
  return `idel_${crypto.randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

/** Проверяет форму имени бота. */
function validateBotName(rawName) {
  const name = String(rawName || "").trim().replace(/^@/, "").toLowerCase();
  if (!name) return { ok: false, error: "Пришлите имя бота текстом." };
  if (!NAME_PATTERNS.some((pattern) => pattern.re.test(name))) {
    return {
      ok: false,
      error:
        "Имя должно быть в одном из форматов:\n" +
        "• vasyapupkin_bot\n• bot_vasyapupkin\n• vasyapupkinBot\n" +
        "Только латиница, цифры и подчёркивание, 3–22 символа.",
    };
  }
  const nickname = checkNickname(name);
  if (!nickname.ok) return { ok: false, error: nickname.error };
  return { ok: true, name };
}

function nameTaken(name) {
  return !!db.prepare("SELECT id FROM users WHERE lower(username) = ?").get(name);
}

function countBots(userId) {
  const row = db.prepare("SELECT COUNT(*) AS c FROM bots WHERE user_id = ?").get(userId);
  return row ? row.c : 0;
}

/**
 * Создаёт бота: аккаунт-бота, строку bots и API-токен.
 * @returns {{ok: true, bot: object, token: string}|{ok: false, error: string}}
 */
function createBot({ ownerId, rawName, description = "", avatarUrl = null }) {
  const validation = validateBotName(rawName);
  if (!validation.ok) return { ok: false, error: validation.error };
  const name = validation.name;

  if (nameTaken(name)) return { ok: false, error: `Имя @${name} уже занято.` };
  if (countBots(ownerId) >= MAX_BOTS_PER_USER) {
    return { ok: false, error: `Достигнут лимит: не больше ${MAX_BOTS_PER_USER} ботов на аккаунт.` };
  }

  const owner = db.prepare("SELECT id FROM users WHERE id = ?").get(ownerId);
  if (!owner) return { ok: false, error: "Владелец не найден." };

  const botUserId = uid();
  const botId = uid();
  const token = generateToken();
  const now = new Date().toISOString();
  const bio = String(description || "").trim().slice(0, 300);

  db.prepare(
    `INSERT INTO users (id, username, full_name, bio, password_hash, avatar_url, cover_url, is_admin, verified, is_bot, aktiviki, confirmed, badge_level, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, 0, 0, 1, 0, 1, 0, ?)`,
  ).run(
    botUserId,
    name,
    String(rawName || "").trim().replace(/^@/, "") || name,
    bio,
    // У бота нет пароля: войти под ним нельзя.
    crypto.randomBytes(24).toString("hex"),
    avatarUrl || null,
    now,
  );

  db.prepare(
    "INSERT INTO bots (id, user_id, bot_user_id, token_hash, token_enc, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(botId, ownerId, botUserId, hashToken(token), encrypt(token), now);

  logInfo("Создан бот", { botId, name, ownerId });

  // Автоматоры правил для ботов (массовое создание и т.п.). Проверка после
  // вставки: правило считает количество ботов за сутки, включая нового.
  try {
    require("./ruleAutomators").applyAutomators({
      userId: ownerId,
      context: "bot_create",
      text: name,
      source: null,
      sourceId: botId,
    });
  } catch (error) {
    logWarn("Ошибка автоматора при создании бота", { ownerId, error: String(error) });
  }

  return { ok: true, bot: getBotById(botId), token };
}

function hydrateBot(row) {
  if (!row) return null;
  const botUser = db.prepare("SELECT * FROM users WHERE id = ?").get(row.bot_user_id);
  return {
    id: row.id,
    ownerId: row.user_id,
    botUserId: row.bot_user_id,
    createdAt: row.created_at,
    username: botUser?.username || null,
    fullName: botUser?.full_name || null,
    description: botUser?.bio || "",
    avatarUrl: botUser?.avatar_url || null,
    webhookUrl: row.webhook_url || null,
  };
}

/** Внутренние данные вебхука: URL и расшифрованный секрет подписи. */
function getWebhook(botId) {
  const row = db.prepare("SELECT webhook_url, webhook_secret FROM bots WHERE id = ?").get(botId);
  if (!row?.webhook_url) return null;
  return { url: row.webhook_url, secret: row.webhook_secret ? decrypt(row.webhook_secret) : null };
}

/**
 * Устанавливает вебхук бота. Секрет для HMAC-подписи генерируется, если не
 * передан (тогда он вернётся один раз — бот должен сохранить его).
 */
function setWebhook(botId, rawUrl, providedSecret) {
  const url = String(rawUrl || "").trim();
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Некорректный URL вебхука" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: "Вебхук должен быть http(s) URL" };
  }
  const secret = String(providedSecret || "").trim() || crypto.randomBytes(32).toString("hex");
  if (secret.length < 16) return { ok: false, error: "Секрет подписи слишком короткий (минимум 16 символов)" };

  db.prepare("UPDATE bots SET webhook_url = ?, webhook_secret = ? WHERE id = ?").run(
    url,
    encrypt(secret),
    botId,
  );
  logInfo("Установлен вебхук бота", { botId, url });
  return { ok: true, webhookUrl: url, secret };
}

function clearWebhook(botId) {
  db.prepare("UPDATE bots SET webhook_url = NULL, webhook_secret = NULL WHERE id = ?").run(botId);
  logInfo("Вебхук бота удалён", { botId });
  return { ok: true };
}

function getBotById(botId) {
  return hydrateBot(db.prepare("SELECT * FROM bots WHERE id = ?").get(botId));
}

/** Бот по аккаунту-боту (нужно диспетчеру сообщений). */
function getBotByBotUserId(botUserId) {
  return hydrateBot(db.prepare("SELECT * FROM bots WHERE bot_user_id = ?").get(botUserId));
}

function listBots(ownerId) {
  return db
    .prepare("SELECT * FROM bots WHERE user_id = ? ORDER BY created_at ASC")
    .all(ownerId)
    .map(hydrateBot);
}

/** Бот по номеру в списке владельца (нумерация с 1, как в /my_bots). */
function getBotByIndex(ownerId, index) {
  const bots = listBots(ownerId);
  const position = Number(index);
  if (!Number.isInteger(position) || position < 1 || position > bots.length) return null;
  return bots[position - 1];
}

/** Авторизация по API-токену. */
function findBotByToken(token) {
  if (!token) return null;
  const row = db.prepare("SELECT * FROM bots WHERE token_hash = ?").get(hashToken(token));
  return hydrateBot(row);
}

/** Показывает токен владельцу. */
function revealToken(botId) {
  const row = db.prepare("SELECT token_enc FROM bots WHERE id = ?").get(botId);
  return row ? decrypt(row.token_enc) : null;
}

/** Перевыпускает токен: старый сразу перестаёт работать. */
function regenerateToken(botId) {
  const token = generateToken();
  db.prepare("UPDATE bots SET token_hash = ?, token_enc = ? WHERE id = ?").run(
    hashToken(token),
    encrypt(token),
    botId,
  );
  logInfo("Перевыпущен токен бота", { botId });
  return token;
}

/** Меняет данные бота (имя, описание, аватар). */
function updateBot(botId, { name, description, avatarUrl } = {}) {
  const bot = getBotById(botId);
  if (!bot) return { ok: false, error: "Бот не найден." };

  const updates = [];
  const params = [];

  if (name !== undefined) {
    const validation = validateBotName(name);
    if (!validation.ok) return { ok: false, error: validation.error };
    if (validation.name !== bot.username && nameTaken(validation.name)) {
      return { ok: false, error: `Имя @${validation.name} уже занято.` };
    }
    updates.push("username = ?");
    params.push(validation.name);
  }
  if (description !== undefined) {
    updates.push("bio = ?");
    params.push(String(description || "").trim().slice(0, 300));
  }
  if (avatarUrl !== undefined) {
    updates.push("avatar_url = ?");
    params.push(avatarUrl || null);
  }
  if (updates.length === 0) return { ok: true, bot };

  params.push(bot.botUserId);
  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  logInfo("Изменён бот", { botId, fields: updates.length });
  return { ok: true, bot: getBotById(botId) };
}

/** Удаляет бота вместе с его аккаунтом и данными. */
function deleteBot(botId) {
  const bot = getBotById(botId);
  if (!bot) return { ok: false, error: "Бот не найден." };
  // Каскады чистят bots, bot_updates, bot_kv и переписку бота.
  db.prepare("DELETE FROM users WHERE id = ?").run(bot.botUserId);
  logInfo("Бот удалён", { botId, username: bot.username });
  return { ok: true, bot };
}

// ---------------------------------------------------------------------------
// Обновления для long-polling
// ---------------------------------------------------------------------------

function pushUpdate(botId, type, payload) {
  db.prepare(
    "INSERT INTO bot_updates (bot_id, type, payload, created_at) VALUES (?, ?, ?, ?)",
  ).run(botId, type, JSON.stringify(payload ?? null), new Date().toISOString());
}

/** Отдаёт обновления после offset, при необходимости ожидая появления новых. */
async function takeUpdates(botId, offset = 0, timeoutMs = 0) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  for (;;) {
    const rows = db
      .prepare("SELECT * FROM bot_updates WHERE bot_id = ? AND id > ? ORDER BY id ASC LIMIT 100")
      .all(botId, Number(offset) || 0);
    if (rows.length > 0 || Date.now() >= deadline) {
      return {
        updates: rows.map((row) => ({
          updateId: row.id,
          type: row.type,
          payload: safeParse(row.payload),
          createdAt: row.created_at,
        })),
        nextOffset: rows.length > 0 ? rows[rows.length - 1].id : Number(offset) || 0,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

function safeParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

/** Убирает старые события, чтобы очередь не росла бесконечно. */
function purgeOldUpdates(days = 3) {
  const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare("DELETE FROM bot_updates WHERE created_at < ?").run(threshold);
  return result.changes;
}

// ---------------------------------------------------------------------------
// Хранилище ключ-значение
// ---------------------------------------------------------------------------

function kvGet(botId, key) {
  const row = db.prepare("SELECT value, updated_at FROM bot_kv WHERE bot_id = ? AND key = ?").get(botId, key);
  return row ? { key, value: row.value, updatedAt: row.updated_at } : null;
}

function kvSet(botId, key, value) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO bot_kv (bot_id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(bot_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(botId, String(key), value === null || value === undefined ? null : String(value), now);
  return { key: String(key), value: value ?? null, updatedAt: now };
}

function kvDelete(botId, key) {
  const result = db.prepare("DELETE FROM bot_kv WHERE bot_id = ? AND key = ?").run(botId, String(key));
  return result.changes > 0;
}

function kvList(botId) {
  return db
    .prepare("SELECT key, value, updated_at FROM bot_kv WHERE bot_id = ? ORDER BY key ASC")
    .all(botId)
    .map((row) => ({ key: row.key, value: row.value, updatedAt: row.updated_at }));
}

module.exports = {
  MAX_BOTS_PER_USER,
  NAME_PATTERNS,
  validateBotName,
  nameTaken,
  createBot,
  getBotById,
  getBotByBotUserId,
  getBotByIndex,
  listBots,
  findBotByToken,
  revealToken,
  regenerateToken,
  updateBot,
  deleteBot,
  pushUpdate,
  takeUpdates,
  purgeOldUpdates,
  getWebhook,
  setWebhook,
  clearWebhook,
  kvGet,
  kvSet,
  kvDelete,
  kvList,
  countBots,
};
