const jwt = require("jsonwebtoken");
const db = require("../db");
const sessions = require("../modules/sessions");

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

/**
 * Подписывает токен доступа. Кроме пользователя токен несёт идентификатор
 * сессии (sid), поэтому сессию можно завершить принудительно — сервер
 * проверяет её наличие на каждом запросе.
 */
function signToken(userId, sessionId) {
  return jwt.sign({ userId, sid: sessionId }, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "30d",
  });
}

function extractToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

/**
 * Разбирает токен и проверяет сессию.
 * @returns {{status: 'none'|'invalid'|'session_required'|'session_revoked'|'ok',
 *   user?: object, sessionId?: string}}
 */
function resolveAuth(req) {
  const token = extractToken(req);
  if (!token) return { status: "none" };

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return { status: "invalid" };
  }

  // Токены, выданные до появления сессий, больше не принимаются.
  if (!payload || !payload.sid) return { status: "session_required" };

  const session = sessions.getSession(payload.sid);
  if (!session || session.user_id !== payload.userId) return { status: "session_revoked" };

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.userId);
  if (!user) return { status: "invalid" };

  return { status: "ok", user, sessionId: payload.sid };
}

const AUTH_ERRORS = {
  none: { error: "Требуется авторизация" },
  invalid: { error: "Недействительный токен" },
  session_required: { error: "Срок действия входа истёк — войдите заново", code: "session_required" },
  session_revoked: { error: "Сессия завершена", code: "session_revoked" },
};

/** Требует валидную сессию. Attaches `req.userId`, `req.user` и `req.sessionId`. */
function requireAuth(req, res, next) {
  const resolved = resolveAuth(req);
  if (resolved.status !== "ok") {
    return res.status(401).json(AUTH_ERRORS[resolved.status] || AUTH_ERRORS.invalid);
  }
  sessions.touchSession(resolved.sessionId);
  req.userId = resolved.user.id;
  req.user = resolved.user;
  req.sessionId = resolved.sessionId;
  next();
}

/** Как requireAuth, но без токена просто пропускает запрос (гость). */
function optionalAuth(req, _res, next) {
  const resolved = resolveAuth(req);
  if (resolved.status === "ok") {
    sessions.touchSession(resolved.sessionId);
    req.userId = resolved.user.id;
    req.user = resolved.user;
    req.sessionId = resolved.sessionId;
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: "Требуются права администратора" });
  }
  next();
}

module.exports = { signToken, requireAuth, optionalAuth, requireAdmin, resolveAuth, JWT_SECRET };
