// Ограничители частоты для ботов.
//
// Счётчики живут в памяти процесса и сбрасываются при перезапуске сервера —
// для защиты чата от разогнавшегося бота этого достаточно.

const WINDOW_MS = 60 * 1000;

/** Запросов к API в минуту. */
const REQUEST_LIMIT = 60;
/** Сообщений, которые бот может отправить в минуту. */
const MESSAGE_LIMIT = 20;

const buckets = new Map();

function consume(botId, kind, limit) {
  const key = `${botId}:${kind}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true, remaining: limit - 1 };
  }
  if (bucket.count >= limit) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      limit,
    };
  }
  bucket.count += 1;
  return { ok: true, remaining: limit - bucket.count };
}

/** Общий лимит запросов к API бота. */
function consumeRequest(botId) {
  return consume(botId, "requests", REQUEST_LIMIT);
}

/** Отдельный лимит на отправку сообщений. */
function consumeMessage(botId) {
  return consume(botId, "messages", MESSAGE_LIMIT);
}

/** Сбрасывает счётчики бота (например, после перевыпуска токена). */
function reset(botId) {
  for (const key of [...buckets.keys()]) {
    if (key.startsWith(`${botId}:`)) buckets.delete(key);
  }
}

module.exports = {
  WINDOW_MS,
  REQUEST_LIMIT,
  MESSAGE_LIMIT,
  consumeRequest,
  consumeMessage,
  reset,
};
