// Доставка событий ботам по вебхуку.
//
// Если у бота задан webhook_url, сервер POSTит события прямо на него, а очередь
// long-polling не используется. Подпись — HMAC-SHA256 от тела запроса в
// заголовке X-Idel-Signature: sha256=<hex>. Ошибки доставки не роняют сервер:
// три попытки с паузами, затем событие всё равно попадает в очередь, чтобы бот
// мог забрать его long-polling'ом.

const crypto = require("crypto");
const bots = require("./bots");
const { logWarn, logInfo } = require("../utils/logger");

const ATTEMPTS = 3;
const TIMEOUT_MS = 5000;
const RETRY_DELAYS_MS = [0, 1000, 3000];

function signBody(secret, body) {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function postOnce(url, body, signature, botUsername, attempt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "IDEL-Webhook/1.0",
        "X-Idel-Bot": botUsername || "",
        "X-Idel-Signature": signature,
        "X-Idel-Attempt": String(attempt),
      },
      body,
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Отправляет событие на вебхук бота с подписью и повторами.
 * @returns {Promise<{ok: boolean, status?: number, error?: string}>}
 */
async function deliverToWebhook(bot, type, payload) {
  const hook = bot?.id ? bots.getWebhook(bot.id) : null;
  if (!hook?.url || !hook.secret) return { ok: false, error: "webhook_not_configured" };

  const update = {
    updateId: Date.now(),
    type,
    payload: payload ?? null,
    botUsername: bot.username,
  };
  const body = JSON.stringify(update);
  const signature = signBody(hook.secret, body);

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const delay = RETRY_DELAYS_MS[attempt - 1] ?? 0;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const result = await postOnce(hook.url, body, signature, bot.username, attempt);
      if (result.ok) {
        logInfo("Событие доставлено на вебхук бота", { botId: bot.id, type, attempt, status: result.status });
        return { ok: true, status: result.status };
      }
      logWarn("Вебхук ответил ошибкой", { botId: bot.id, type, attempt, status: result.status });
    } catch (error) {
      logWarn("Ошибка доставки на вебхук", { botId: bot.id, type, attempt, error: String(error) });
    }
  }

  // Резерв: событие кладём в очередь, бот заберёт его long-polling'ом.
  try {
    bots.pushUpdate(bot.id, type, payload);
    logInfo("Событие возвращено в очередь long-polling", { botId: bot.id, type });
  } catch (error) {
    logWarn("Не удалось вернуть событие в очередь", { botId: bot.id, type, error: String(error) });
  }
  return { ok: false, error: "delivery_failed" };
}

/**
 * Единая точка доставки события боту: вебхук, если настроен, иначе очередь.
 * Не блокирует вызывающий обработчик.
 */
function deliver(bot, type, payload) {
  const hook = bot?.id ? bots.getWebhook(bot.id) : null;
  if (hook?.url) {
    void deliverToWebhook(bot, type, payload);
    return "webhook";
  }
  bots.pushUpdate(bot.id, type, payload);
  return "polling";
}

module.exports = { deliver, deliverToWebhook, signBody, ATTEMPTS };