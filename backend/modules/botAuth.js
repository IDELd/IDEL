// Вход ботов в профиль пользователя по коду подтверждения.
//
// Схема:
//  1. Бот вызывает POST /api/bot/auth/request, передавая ник или почту и список
//     возможностей, которые ему нужны.
//  2. Пользователю приходит код от @resendcode_bot — не на почту (почта позже),
//     а в чат с этим ботом. В сообщении видно, какой именно бот просит доступ
//     и что он сможет делать.
//  3. Пользователь отдаёт код боту, бот подтверждает его
//     (POST /api/bot/auth/confirm) и получает временное разрешение (grant).
//  4. По grant бот выполняет только те действия, которые были объявлены и
//     подтверждены: завершение сессий, сообщения от имени пользователя,
//     удаление профиля, бессрочная блокировка.
//
// Сессия, созданная при подтверждении, видна пользователю в «Настройки →
// Сессии» как «Вход через бота @x». Если её завершить — grant сразу перестаёт
// действовать.

const crypto = require("crypto");
const db = require("../db");
const { uid } = require("../utils/uid");
const { logInfo, logWarn } = require("../utils/logger");
const { saveMessage } = require("./messageStore");
const { censorText } = require("../utils/censor");
const sessions = require("./sessions");
const banSystem = require("./banSystem");
const automators = require("./ruleAutomators");
const { deleteAccount } = require("./accountDelete");
const { sendBotCodeEmail } = require("../utils/mailer");
const { RESEND_CODE_BOT_USERNAME } = require("../utils/validation");

/** Возможности бота: ключ → подпись для пользователя. */
const CAPABILITIES = {
  login: "вход в профиль",
  kick_sessions: "завершение всех сессий, кроме главной",
  send_message: "отправка сообщений от вашего имени",
  delete_profile: "удаление профиля",
  ban_profile: "бессрочная блокировка профиля за нарушение правил",
};

const REQUEST_TTL_MS = 10 * 60 * 1000;
const GRANT_TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const CODE_RE = /^\d{6}$/;

function codeSecret() {
  return process.env.BOT_CODE_SECRET || process.env.JWT_SECRET || "idel_dev_bot_code_key";
}

function hashCode(requestId, code) {
  return crypto.createHmac("sha256", codeSecret()).update(`${requestId}:${code}`).digest("hex");
}

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function capabilitiesText(capabilities) {
  return capabilities.map((key) => CAPABILITIES[key] || key).join(", ");
}

/** Сообщение с кодом отправляет системный @resendcode_bot. */
function sendCodeMessage({ userId, botUsername, code, capabilities }) {
  const sender = db
    .prepare("SELECT * FROM users WHERE lower(username) = ? AND is_bot = 1")
    .get(RESEND_CODE_BOT_USERNAME);
  if (!sender) {
    logWarn("Не найден @resendcode_bot для отправки кода", { userId });
    return false;
  }
  const text =
    `ВНИМАНИЕ!!! В Ваш аккаунт пытается войти: @${botUsername}! ` +
    `Этот бот может: ${capabilitiesText(capabilities)}! ` +
    `Вот ваш код для входа: ${code}.\n\n` +
    "Никому не сообщайте код. Дальнейшие коды для входа и действий с аккаунтом будут приходить сюда же. " +
    "Если это не вы — проигнорируйте сообщение и завершите сессию в настройках.";
  saveMessage({
    chatId: [sender.id, userId].sort().join("_"),
    fromUserId: sender.id,
    toUserId: userId,
    text,
  });
  return true;
}

function findUser({ username, email }) {
  const cleanUsername = String(username || "").trim().replace(/^@/, "").toLowerCase();
  if (cleanUsername) {
    return db.prepare("SELECT * FROM users WHERE lower(username) = ?").get(cleanUsername) || null;
  }
  if (email) {
    const cleanEmail = String(email).trim().toLowerCase();
    return db.prepare("SELECT * FROM users WHERE lower(email) = ?").get(cleanEmail) || null;
  }
  return null;
}

/**
 * Создаёт запрос на вход и отправляет код: в чат @resendcode_bot, если у
 * пользователя есть активная сессия, иначе на почту из профиля.
 * @returns {{ok: true, request: object} | {ok: false, status: number, error: string, code?: string}}
 */
async function requestLogin(bot, { username, email, capabilities } = {}) {
  const target = findUser({ username, email });
  if (!target) {
    return {
      ok: false,
      status: 404,
      error: "Пользователь не найден. Укажите username (или email, если он сохранён в профиле).",
      code: "user_not_found",
    };
  }
  if (target.is_admin) {
    return { ok: false, status: 403, error: "Вход в аккаунт администрации через бота запрещён", code: "admin_forbidden" };
  }
  if (target.is_bot) {
    return { ok: false, status: 400, error: "Нельзя войти в аккаунт бота", code: "bot_target" };
  }

  const requested = Array.isArray(capabilities) ? capabilities : [];
  const caps = requested.filter((key) => Object.prototype.hasOwnProperty.call(CAPABILITIES, key));
  if (!caps.includes("login")) caps.unshift("login");
  if (caps.length === 1) {
    return {
      ok: false,
      status: 400,
      error: "Укажите возможности бота в capabilities: login, kick_sessions, send_message, delete_profile, ban_profile",
      code: "no_capabilities",
    };
  }

  // Куда доставлять код: при наличии активной сессии — в чат @resendcode_bot,
  // иначе (пользователь не в сети) — на почту из профиля.
  const hasActiveSession = sessions.countSessions(target.id) > 0;
  const delivery = hasActiveSession ? "resendcode_bot" : "email";
  if (delivery === "email" && !target.email) {
    return {
      ok: false,
      status: 400,
      error:
        "У аккаунта нет активных сессий и не указана почта — код некуда отправить. Войдите в аккаунт и повторите запрос.",
      code: "no_sessions",
    };
  }

  const id = uid();
  const code = generateCode();
  const now = new Date();
  db.prepare(
    `INSERT INTO bot_auth_requests
       (id, bot_id, user_id, code_hash, capabilities, status, attempts, session_id, created_at, expires_at, confirmed_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?, NULL)`,
  ).run(
    id,
    bot.id,
    target.id,
    hashCode(id, code),
    JSON.stringify(caps),
    now.toISOString(),
    new Date(now.getTime() + REQUEST_TTL_MS).toISOString(),
  );

  let delivered = false;
  if (delivery === "resendcode_bot") {
    delivered = sendCodeMessage({
      userId: target.id,
      botUsername: bot.username,
      code,
      capabilities: caps,
    });
  } else {
    const result = await sendBotCodeEmail({
      to: target.email,
      username: target.username,
      botUsername: bot.username,
      capabilities: capabilitiesText(caps),
      code,
    });
    // В dev-режиме SMTP не настроен: письмо выводится в консоль — считаем доставленным.
    delivered = result.delivered || result.reason === "smtp_not_configured";
  }
  if (!delivered) {
    db.prepare("DELETE FROM bot_auth_requests WHERE id = ?").run(id);
    return { ok: false, status: 503, error: "Сервис кодов временно недоступен", code: "delivery_failed" };
  }

  logInfo("Запрос бота на вход в аккаунт", {
    botId: bot.id,
    bot: bot.username,
    userId: target.id,
    capabilities: caps,
    delivery,
  });

  return {
    ok: true,
    request: {
      id,
      expiresInSec: REQUEST_TTL_MS / 1000,
      capabilities: caps,
      delivery,
      user: { id: target.id, username: target.username },
    },
  };
}

/** Подтверждение кода: создаёт сессию-разрешение и возвращает grant. */
function confirmLogin(bot, { requestId, code } = {}) {
  const row = db
    .prepare("SELECT * FROM bot_auth_requests WHERE id = ? AND bot_id = ?")
    .get(String(requestId || ""), bot.id);
  if (!row) {
    return { ok: false, status: 404, error: "Запрос не найден", code: "request_not_found" };
  }
  if (row.status !== "pending") {
    const reason =
      row.status === "confirmed"
        ? "Запрос уже подтверждён"
        : row.status === "failed"
          ? "Слишком много неверных попыток — создайте новый запрос"
          : "Срок действия кода истёк — создайте новый запрос";
    return { ok: false, status: 400, error: reason, code: `request_${row.status}` };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare("UPDATE bot_auth_requests SET status = 'expired' WHERE id = ?").run(row.id);
    return { ok: false, status: 400, error: "Срок действия кода истёк — создайте новый запрос", code: "code_expired" };
  }

  const value = String(code || "").trim();
  if (!CODE_RE.test(value) || hashCode(row.id, value) !== row.code_hash) {
    const attempts = Number(row.attempts) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      db.prepare("UPDATE bot_auth_requests SET attempts = ?, status = 'failed' WHERE id = ?").run(attempts, row.id);
      logWarn("Код входа бота: превышено число попыток", { botId: bot.id, requestId: row.id });
      return {
        ok: false,
        status: 400,
        error: "Слишком много неверных попыток — создайте новый запрос",
        code: "too_many_attempts",
      };
    }
    db.prepare("UPDATE bot_auth_requests SET attempts = ? WHERE id = ?").run(attempts, row.id);
    return {
      ok: false,
      status: 400,
      error: `Неверный код. Осталось попыток: ${MAX_ATTEMPTS - attempts}`,
      code: "invalid_code",
      attemptsLeft: MAX_ATTEMPTS - attempts,
    };
  }

  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id);
  if (!target) {
    return { ok: false, status: 404, error: "Аккаунт больше не существует", code: "user_not_found" };
  }

  const sessionId = sessions.createBotSession({
    userId: target.id,
    botUsername: bot.username,
    ip: null,
  });
  const confirmedAt = new Date().toISOString();
  db.prepare(
    "UPDATE bot_auth_requests SET status = 'confirmed', session_id = ?, confirmed_at = ? WHERE id = ?",
  ).run(sessionId, confirmedAt, row.id);

  logInfo("Бот подтвердил вход в аккаунт", {
    botId: bot.id,
    bot: bot.username,
    userId: target.id,
    sessionId,
  });

  return {
    ok: true,
    grant: {
      id: row.id,
      sessionId,
      expiresInSec: GRANT_TTL_MS / 1000,
      capabilities: JSON.parse(row.capabilities),
      user: { id: target.id, username: target.username, fullName: target.full_name },
    },
  };
}

/** Проверяет, что разрешение действительно и не отозвано. */
function getGrant(bot, grantId) {
  const row = db
    .prepare("SELECT * FROM bot_auth_requests WHERE id = ? AND bot_id = ?")
    .get(String(grantId || ""), bot.id);
  if (!row || row.status !== "confirmed" || !row.session_id) {
    return { ok: false, status: 404, error: "Разрешение не найдено", code: "grant_not_found" };
  }
  // Пользователь мог завершить сессию «Вход через бота» — тогда разрешение
  // сразу недействительно.
  if (!sessions.getSession(row.session_id)) {
    return {
      ok: false,
      status: 403,
      error: "Разрешение отозвано: сессия бота завершена пользователем",
      code: "grant_revoked",
    };
  }
  const confirmedAt = new Date(row.confirmed_at || row.created_at).getTime();
  if (Date.now() - confirmedAt > GRANT_TTL_MS) {
    return { ok: false, status: 403, error: "Разрешение истекло — запросите код заново", code: "grant_expired" };
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id);
  if (!user) {
    return { ok: false, status: 404, error: "Аккаунт больше не существует", code: "user_not_found" };
  }
  return {
    ok: true,
    id: row.id,
    user,
    sessionId: row.session_id,
    capabilities: JSON.parse(row.capabilities),
    expiresInSec: Math.max(0, Math.round((GRANT_TTL_MS - (Date.now() - confirmedAt)) / 1000)),
  };
}

function denyCapability(grant, capability) {
  if (grant.capabilities.includes(capability)) return null;
  return {
    status: 403,
    error: `Бот не запрашивал возможность: ${CAPABILITIES[capability] || capability}`,
    code: "capability_denied",
  };
}

/** Кикает все сессии, кроме главной (самая свежая) и сессии бота. */
function kickSessions(bot, grant) {
  const rows = db
    .prepare("SELECT id FROM user_sessions WHERE user_id = ? AND id != ? ORDER BY last_active DESC")
    .all(grant.user.id, grant.sessionId);
  const mainSessionId = rows[0]?.id || null;
  let closed = 0;
  for (const row of rows.slice(1)) {
    db.prepare("DELETE FROM user_sessions WHERE id = ?").run(row.id);
    closed += 1;
  }
  logInfo("Бот завершил прочие сессии аккаунта", {
    bot: bot.username,
    userId: grant.user.id,
    closed,
    keptMain: mainSessionId,
  });
  return { closed, keptMainSession: mainSessionId };
}

/** Сообщение от имени пользователя. */
function sendMessageAsUser(bot, grant, { toUserId, toUsername, text, imageUrl } = {}) {
  const target = toUserId
    ? db.prepare("SELECT * FROM users WHERE id = ?").get(String(toUserId))
    : db
        .prepare("SELECT * FROM users WHERE lower(username) = ?")
        .get(String(toUsername || "").replace(/^@/, "").toLowerCase());
  if (!target) return { status: 404, error: "Получатель не найден", code: "recipient_not_found" };

  const author = grant.user;
  if (banSystem.isBanned(author.id)) {
    return { status: 403, error: "Аккаунт заблокирован и не может отправлять сообщения", code: "banned" };
  }
  if (banSystem.isBanned(target.id) && !target.is_bot) {
    return { status: 403, error: "Получатель заблокирован", code: "banned_target" };
  }

  const rawText = String(text || "").trim();
  if (!rawText && !imageUrl) return { status: 400, error: "Нужен текст или картинка", code: "empty" };

  const censored = censorText(rawText);
  const chatId = [author.id, target.id].sort().join("_");
  const saved = saveMessage({
    chatId,
    fromUserId: author.id,
    toUserId: target.id,
    text: censored.text,
    imageUrl: imageUrl || null,
  });

  const violation = automators.applyAutomators({
    userId: author.id,
    context: "message",
    text: rawText,
    source: "message",
    sourceId: saved.id,
    imageUrl: imageUrl || null,
  });

  logInfo("Бот отправил сообщение от имени пользователя", {
    bot: bot.username,
    userId: author.id,
    toUserId: target.id,
    removed: !!violation?.removed,
  });

  return {
    message: {
      id: saved.id,
      fromUserId: author.id,
      toUserId: target.id,
      text: censored.text,
      imageUrl: imageUrl || null,
      createdAt: saved.created_at,
    },
    removed: !!violation?.removed,
  };
}

/** Удаление профиля пользователя ботом. */
function deleteProfile(bot, grant) {
  const result = deleteAccount({
    targetId: grant.user.id,
    reason: `Удаление по запросу подтверждённого доступа бота @${bot.username}`,
    deletedBy: null,
  });
  if (!result.ok) return { status: result.status || 400, error: result.error };
  logInfo("Бот удалил профиль по подтверждённому доступу", {
    bot: bot.username,
    userId: grant.user.id,
    grantId: grant.id,
  });
  return { ok: true, deleted: result.deleted };
}

/** Бессрочная блокировка профиля за нарушение правил. */
function banProfile(bot, grant, { ruleNumber, reason } = {}) {
  const number = ruleNumber === undefined || ruleNumber === null ? null : Number(ruleNumber);
  if (number !== null && (!Number.isInteger(number) || number < 1)) {
    return { status: 400, error: "ruleNumber должен быть номером пункта правил", code: "bad_rule" };
  }
  const text = String(reason || "").trim();
  const banReason =
    text ||
    `Бессрочная блокировка: нарушение правил платформы${number ? ` (пункт ${number})` : ""}`;

  const result = banSystem.applyBan({
    userId: grant.user.id,
    reason: banReason,
    ruleNumber: number,
    mode: banSystem.MODE_NORMAL,
    durationDays: null, // бессрочно
    bannedBy: null,
    isAuto: true,
  });
  if (!result.ok) return { status: 400, error: result.error };

  logInfo("Бот заблокировал профиль навсегда", {
    bot: bot.username,
    userId: grant.user.id,
    ruleNumber: number,
    reason: banReason,
  });
  return { ok: true, ban: banSystem.getBanState(grant.user.id) };
}

module.exports = {
  CAPABILITIES,
  REQUEST_TTL_MS,
  GRANT_TTL_MS,
  MAX_ATTEMPTS,
  requestLogin,
  confirmLogin,
  getGrant,
  denyCapability,
  kickSessions,
  sendMessageAsUser,
  deleteProfile,
  banProfile,
};