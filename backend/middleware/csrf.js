// CSRF-защита по схеме «двойная отправка токена» (double-submit).
//
// Токен не хранится на сервере: это подписанный HMAC'ом конверт с nonce,
// сроком жизни и привязкой к пользователю. Клиент получает его через
// GET /api/csrf-token и присылает обратно в заголовке X-CSRF-Token на каждом
// изменяющем запросе. Запрос без валидного токена отклоняется с 403.

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("./auth");
const { logWarn } = require("../utils/logger");

const CSRF_SECRET = process.env.CSRF_SECRET || `${JWT_SECRET}::csrf`;
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 часа
const HEADER_NAME = "x-csrf-token";

/**
 * Эндпоинты, доступные без CSRF-токена:
 *  * вход/регистрация/подтверждение/сброс пароля — до появления токена;
 *  * /api/bot — машино-машинный API ботов: авторизация своим токеном, браузера
 *    и cookie там нет, поэтому CSRF-атака неприменима.
 */
const EXEMPT_PREFIXES = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/confirm",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/bot",
];

function sign(encodedPayload) {
  return crypto.createHmac("sha256", CSRF_SECRET).update(encodedPayload).digest("base64url");
}

/** Выпускает новый токен, привязанный к конкретному пользователю. */
function issueToken(userId) {
  const payload = JSON.stringify({
    n: crypto.randomBytes(16).toString("hex"),
    u: userId || null,
    exp: Date.now() + TOKEN_TTL_MS,
  });
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

/** Проверяет подпись, срок жизни и владельца токена. */
function verifyToken(token, userId) {
  if (!token || typeof token !== "string") return false;
  const separator = token.indexOf(".");
  if (separator <= 0) return false;

  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = sign(encoded);

  const provided = Buffer.from(signature, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (provided.length !== wanted.length || !crypto.timingSafeEqual(provided, wanted)) return false;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now()) return false;
  return (payload.u || null) === (userId || null);
}

/** Достаёт userId из Bearer-токена, не роняя запрос при невалидном токене. */
function userIdFromRequest(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET).userId || null;
  } catch {
    return null;
  }
}

function isExempt(path) {
  return EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Глобальный middleware: пропускает безопасные методы и явно разрешённые
 * эндпоинты, для остальных изменяющих запросов требует валидный CSRF-токен.
 */
function csrfProtection(req, res, next) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  if (isExempt(req.path)) return next();

  const userId = userIdFromRequest(req);
  const headerToken = req.get(HEADER_NAME) || null;
  const bodyToken = req.body && typeof req.body._csrf === "string" ? req.body._csrf : null;

  if (!verifyToken(headerToken || bodyToken, userId)) {
    logWarn("Отклонён запрос без валидного CSRF-токена", {
      method,
      path: req.path,
      ip: req.ip,
      userId,
    });
    return res.status(403).json({
      error: "Недействительный CSRF-токен. Обновите страницу и попробуйте снова.",
      code: "csrf_invalid",
    });
  }
  return next();
}

module.exports = { csrfProtection, issueToken, verifyToken, TOKEN_TTL_MS, HEADER_NAME };
