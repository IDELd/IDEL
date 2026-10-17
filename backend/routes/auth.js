const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { uid } = require("../utils/uid");
const { checkNickname } = require("../modules/nicknameFilter");
const { serializeUser } = require("../utils/serialize");
const { signToken, requireAuth } = require("../middleware/auth");
const { sendConfirmationEmail, sendPasswordResetEmail } = require("../utils/mailer");
const sessions = require("../modules/sessions");
const { logInfo, logWarn } = require("../utils/logger");

const router = express.Router();

const CONFIRM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** IP и User-Agent текущего запроса — сохраняются в сессии в зашифрованном виде. */
function requestContext(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : String(forwarded || "").split(",")[0]).trim()
    || req.ip
    || "неизвестно";
  return { ip, userAgent: req.get("user-agent") || "неизвестно" };
}

router.post("/register", async (req, res) => {
  const { username, password, fullName, bio, email, avatarUrl, coverUrl } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: "Укажите имя пользователя и пароль" });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "Пароль слишком короткий" });
  }
  // Проверка ника: формат + запрещённые слова (таблица forbidden_words).
  const validation = checkNickname(username);
  if (!validation.ok) {
    return res.status(400).json({
      error: validation.error,
      code: validation.code,
      matched: validation.matched,
    });
  }
  const existing = db.prepare("SELECT id FROM users WHERE lower(username) = ?").get(validation.username);
  if (existing) {
    return res.status(409).json({ error: "Username уже занят" });
  }

  const id = uid();
  const passwordHash = bcrypt.hashSync(password, 10);
  const createdAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO users (id, username, full_name, bio, password_hash, avatar_url, cover_url, is_admin, verified, is_bot, aktiviki, confirmed, email, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?)`,
  ).run(
    id,
    validation.username,
    String(fullName || "").trim(),
    String(bio || "").trim(),
    passwordHash,
    avatarUrl || null,
    coverUrl || null,
    email ? 0 : 1, // if no email was supplied, there's nothing to confirm
    email ? String(email).trim().toLowerCase() : null,
    createdAt,
  );

  let confirmation = null;
  if (email) {
    const token = uid();
    const expiresAt = new Date(Date.now() + CONFIRM_TOKEN_TTL_MS).toISOString();
    db.prepare(
      "INSERT INTO confirmations (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
    ).run(uid(), id, token, expiresAt);
    const confirmLink = `${process.env.FRONTEND_URL || "http://localhost:5173"}/#/confirm?token=${token}`;
    confirmation = await sendConfirmationEmail(email, validation.username, confirmLink);
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  const sessionId = sessions.createSession({ userId: id, ...requestContext(req) });
  const token = signToken(id, sessionId);
  res.status(201).json({ token, user: serializeUser(user, { includeModeration: true }), confirmation });
});

router.get("/confirm", (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Токен не указан" });

  const row = db.prepare("SELECT * FROM confirmations WHERE token = ?").get(token);
  if (!row) return res.status(404).json({ error: "Ссылка недействительна" });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(410).json({ error: "Ссылка истекла" });
  }

  db.prepare("UPDATE users SET confirmed = 1 WHERE id = ?").run(row.user_id);
  db.prepare("DELETE FROM confirmations WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

router.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Укажите имя пользователя и пароль" });
  }
  const clean = String(username).trim().replace(/^@/, "").toLowerCase();
  const user = db.prepare("SELECT * FROM users WHERE lower(username) = ?").get(clean);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Неверные данные" });
  }
  const token = signToken(user.id, sessions.createSession({ userId: user.id, ...requestContext(req) }));
  res.json({ token, user: serializeUser(user, { includeModeration: true }) });
});

// Выход завершает именно текущую сессию (остальные устройства остаются в системе).
router.post("/logout", requireAuth, (req, res) => {
  sessions.revokeSession(req.sessionId, req.userId);
  res.json({ ok: true });
});

/**
 * Смена пароля: проверяем текущий пароль, ставим новый и завершаем все
 * остальные сессии — текущая остаётся рабочей.
 */
router.post("/change-password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Укажите текущий и новый пароль" });
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: "Пароль слишком короткий" });
  }
  if (!bcrypt.compareSync(String(currentPassword), req.user.password_hash)) {
    logWarn("Неудачная попытка смены пароля", { userId: req.userId });
    return res.status(401).json({ error: "Неверный текущий пароль" });
  }

  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    bcrypt.hashSync(String(newPassword), 10),
    req.userId,
  );
  const revoked = sessions.revokeOtherSessions(req.userId, req.sessionId);
  logInfo("Пароль изменён", { userId: req.userId, revokedOtherSessions: revoked });
  res.json({ ok: true, revokedOtherSessions: revoked });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: serializeUser(req.user, { includeModeration: true }) });
});

// ---------------------------------------------------------------------------
// Сброс пароля по почте.
//
// В БД хранится только sha256-хеш токена из письма; ссылка живёт 30 минут.
// Ответ на запрос всегда одинаковый, чтобы нельзя было выяснить, есть ли
// такой аккаунт.
// ---------------------------------------------------------------------------

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const RESET_RATE_LIMIT_MS = 60 * 1000;
/** userId → время последнего запроса (не чаще раза в минуту). */
const resetRequestTimes = new Map();

function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

router.post("/forgot-password", async (req, res) => {
  const { email, username } = req.body || {};
  const raw = String(email || username || "").trim().toLowerCase();
  if (!raw) return res.status(400).json({ error: "Укажите почту или ник" });

  const user = raw.includes("@")
    ? db.prepare("SELECT * FROM users WHERE lower(email) = ?").get(raw)
    : db.prepare("SELECT * FROM users WHERE lower(username) = ?").get(raw.replace(/^@/, ""));

  const ok = { ok: true };
  if (!user || user.is_bot) return res.json(ok); // не раскрываем существование аккаунта
  if (!user.email) {
    logWarn("Сброс пароля: у аккаунта нет почты", { userId: user.id });
    return res.json(ok);
  }
  const last = resetRequestTimes.get(user.id) || 0;
  if (Date.now() - last < RESET_RATE_LIMIT_MS) return res.json(ok);
  resetRequestTimes.set(user.id, Date.now());

  const token = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(user.id);
  db.prepare(
    "INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(
    uid(),
    user.id,
    hashResetToken(token),
    new Date(now.getTime() + RESET_TOKEN_TTL_MS).toISOString(),
    now.toISOString(),
  );

  const link = `${process.env.FRONTEND_URL || "http://localhost:5173"}/#/reset-password?token=${token}`;
  const delivery = await sendPasswordResetEmail({
    to: user.email,
    username: user.username,
    resetLink: link,
  });
  logInfo("Запрошен сброс пароля", { userId: user.id, delivered: delivery.delivered });
  res.json(ok);
});

router.post("/reset-password", (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: "Укажите токен и новый пароль" });
  if (String(password).length < 6) return res.status(400).json({ error: "Пароль слишком короткий" });

  const row = db.prepare("SELECT * FROM password_resets WHERE token_hash = ?").get(hashResetToken(token));
  if (!row) return res.status(404).json({ error: "Ссылка недействительна" });
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM password_resets WHERE id = ?").run(row.id);
    return res.status(410).json({ error: "Ссылка истекла — запросите новую" });
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id);
  if (!user) return res.status(404).json({ error: "Аккаунт не найден" });

  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    bcrypt.hashSync(String(password), 10),
    user.id,
  );
  db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(user.id);
  // После сброса пароля все старые сессии завершаются — вход заново.
  const revoked = sessions.revokeOtherSessions(user.id, null);
  logInfo("Пароль восстановлен по почте", { userId: user.id, revokedSessions: revoked });
  res.json({ ok: true });
});

module.exports = router;
