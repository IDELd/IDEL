require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const db = require("./db");
const { uid } = require("./utils/uid");
const { ADMIN_USERNAME, VERIFY_BOT_USERNAME, RESTORE_BOT_USERNAME, PREMIUM_BOT_USERNAME, CREATOR_BOT_USERNAME, RESEND_CODE_BOT_USERNAME } = require("./utils/validation");
const { UPLOAD_ROOT } = require("./middleware/upload");
const { csrfProtection } = require("./middleware/csrf");
const { logInfo, logError, logCritical } = require("./utils/logger");

// ---------------------------------------------------------------------------
// One-time seed data: the admin account, the @verifybot account and the
// @restorebot account (разбан и апелляции). Mirrors ensureInit() from the old
// src/lib/db.ts so behaviour stays identical.
// ---------------------------------------------------------------------------
function ensureSeedUsers() {
  const admin = db.prepare("SELECT id FROM users WHERE lower(username) = ?").get(ADMIN_USERNAME);
  if (!admin) {
    db.prepare(
      `INSERT INTO users (id, username, full_name, bio, password_hash, avatar_url, cover_url, is_admin, verified, is_bot, aktiviki, confirmed, badge_level, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, 1, 1, 0, 0, 1, 3, ?)`,
    ).run(uid(), ADMIN_USERNAME, "Администратор", "", bcrypt.hashSync("iDrobo13*5448I", 10), new Date().toISOString());
    // eslint-disable-next-line no-console
    console.log(`[seed] Создан аккаунт администратора @${ADMIN_USERNAME}`);
  }

  const bots = [
    {
      username: VERIFY_BOT_USERNAME,
      fullName: "VerifyBot",
      bio: "Бот верификации ИДЕЛЬ. Напишите мне, чтобы подать заявку на верификацию аккаунта.",
    },
    {
      username: RESTORE_BOT_USERNAME,
      fullName: "RestoreBot",
      bio: "Бот разбана и апелляций ИДЕЛЬ. Напишите мне, если считаете блокировку несправедливой.",
    },
    {
      username: PREMIUM_BOT_USERNAME,
      fullName: "PremiumBot",
      bio: "Бот подписки ИДЕЛЬ ПРЕМИУМ. Команды: /trial — активировать пробный период, /status — состояние подписки.",
    },
    {
      username: CREATOR_BOT_USERNAME,
      fullName: "CreatorBot",
      bio: "Бот создания ботов ИДЕЛЬ. Команды: /create — создать бота, /my_bots — мои боты и меню редактирования.",
    },
    {
      username: RESEND_CODE_BOT_USERNAME,
      fullName: "ResendCodeBot",
      bio: "Бот кодов подтверждения. Сюда приходят коды для входа в аккаунт и действий с ним, если играет бот.",
    },
  ];

  for (const bot of bots) {
    const existing = db.prepare("SELECT id FROM users WHERE lower(username) = ?").get(bot.username);
    if (existing) continue;
    db.prepare(
      `INSERT INTO users (id, username, full_name, bio, password_hash, avatar_url, cover_url, is_admin, verified, is_bot, aktiviki, confirmed, badge_level, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, 1, 1, 0, 1, 3, ?)`,
    ).run(
      uid(),
      bot.username,
      bot.fullName,
      bot.bio,
      bcrypt.hashSync(uid(), 10),
      new Date().toISOString(),
    );
    // eslint-disable-next-line no-console
    console.log(`[seed] Создан аккаунт @${bot.username}`);
  }
}
ensureSeedUsers();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" })); // drawing canvases are inline data URLs, keep some headroom
app.use("/uploads", express.static(UPLOAD_ROOT));

// CSRF-защита: все изменяющие запросы обязаны нести валидный X-CSRF-Token
// (кроме входа/регистрации — они получают его после авторизации).
app.use(csrfProtection);

app.use("/api/csrf-token", require("./routes/csrf"));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/nickname", require("./routes/nickname"));
app.use("/api/users", require("./routes/users"));
app.use("/api/posts", require("./routes/posts"));
app.use("/api/comments", require("./routes/comments"));
app.use("/api/likes", require("./routes/likes"));
app.use("/api/follows", require("./routes/follows"));
app.use("/api/friends", require("./routes/friends"));
app.use("/api/messages", require("./routes/messages"));
app.use("/api/channels", require("./routes/channels"));
app.use("/api/groups", require("./routes/groups"));
app.use("/api/verify", require("./routes/verify"));
app.use("/api/reports", require("./routes/reports"));
app.use("/api/bans", require("./routes/bans"));
app.use("/api/blocks", require("./routes/blocks"));
app.use("/api/events", require("./routes/events"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/warnings", require("./routes/warnings"));
app.use("/api/sessions", require("./routes/sessions"));
app.use("/api/rules", require("./routes/rules"));
app.use("/api/achievements", require("./routes/achievements"));
app.use("/api/premium", require("./routes/premium"));
app.use("/api/bot", require("./routes/botApi"));
// Псевдоним административного маршрута из требований (POST /admin/rules).
app.use("/admin/rules", require("./routes/rules"));
// Апелляции: /api/appeal + /api/admin/appeals и те же пути без префикса /api.
app.use("/api", require("./routes/appeals"));
app.use("/", require("./routes/appeals"));
app.use("/api/admin/forbidden-words", require("./routes/forbiddenWords"));
// Псевдоним из требований: POST /api/warn выдаёт варн. Используется тот же
// роутер, поэтому доступны и GET /api/warn/me, GET /api/warn/:userId.
app.use("/api/warn", require("./routes/warnings"));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Centralized error handler (also catches Multer file-size errors, etc.)
// 5xx пишутся в logs/Critical_log.txt, 4xx — в logs/Obshiy_log.txt.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const meta = { method: req.method, path: req.originalUrl, status };
  if (status >= 500) logCritical("Необработанная ошибка запроса", err, meta);
  else logError("Ошибка запроса", err, meta);
  console.error(err);
  res.status(status).json({ error: err.message || "Внутренняя ошибка сервера" });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  logInfo(`ИДЕЛЬ backend запущен на http://localhost:${PORT}`);
  console.log(`ИДЕЛЬ backend запущен на http://localhost:${PORT}`);
});

// ---------------------------------------------------------------------------
// Фоновое обслуживание: восстановление репутации (+1 за каждые сутки без
// нарушений) и снятие банов с истёкшим сроком. Запускается сразу при старте
// (догоняет пропущенное время) и далее раз в час.
// ---------------------------------------------------------------------------
const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

function runMaintenance() {
  try {
    require("./modules/reputation").tickAllReputations();
    require("./modules/banSystem").sweepExpiredBans();
    require("./modules/sessions").purgeStaleSessions();
    require("./modules/bots").purgeOldUpdates();
    // Авто-вайп старых медиа Supabase при превышении лимита файлов.
    require("./modules/mediaStorage")
      .purgeOldMedia()
      .then((result) => {
        if (result?.deleted > 0) {
          logInfo("Авто-вайп медиа выполнен", result);
        }
      })
      .catch((error) => logError("Ошибка авто-вайпа медиа", error));
  } catch (error) {
    logError("Ошибка фонового обслуживания", error);
  }
}

runMaintenance();
setInterval(runMaintenance, MAINTENANCE_INTERVAL_MS).unref();

// Справочник достижений создаётся/дополняется при старте (правки не перетираются).
try {
  require("./modules/achievements").ensureSeed();
} catch (error) {
  logError("Не удалось инициализировать достижения", error);
}

// ---------------------------------------------------------------------------
// Критические сбои процесса тоже попадают в logs/Critical_log.txt.
// Процесс при этом не завершается: HTTP-ошибки обрабатываются middleware выше,
// а здесь фиксируются только внештатные ситуации.
// ---------------------------------------------------------------------------
process.on("uncaughtException", (error) => {
  logCritical("Необработанное исключение процесса", error);
});

process.on("unhandledRejection", (reason) => {
  logCritical("Необработанный отказ промиса", reason);
});
