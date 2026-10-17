const express = require("express");
const db = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { setBadgeLevel } = require("../modules/badges");
const { deleteAccount } = require("../modules/accountDelete");
const { serializeUser, serializeChannel, serializeWarning } = require("../utils/serialize");
const { VERIFY_BOT_USERNAME, RESTORE_BOT_USERNAME, PREMIUM_BOT_USERNAME, CREATOR_BOT_USERNAME, RESEND_CODE_BOT_USERNAME } = require("../utils/validation");
const premium = require("../modules/premium");
const { logInfo, logWarn } = require("../utils/logger");

const router = express.Router();

// Системные аккаунты удалять нельзя: на них держатся верификация, разбан,
// подписка и создание ботов.
const PROTECTED_USERNAMES = [
  VERIFY_BOT_USERNAME,
  RESTORE_BOT_USERNAME,
  PREMIUM_BOT_USERNAME,
  CREATOR_BOT_USERNAME,
  RESEND_CODE_BOT_USERNAME,
];

router.get("/stats", requireAuth, requireAdmin, (_req, res) => {
  const count = (sql) => db.prepare(sql).get().c;
  res.json({
    stats: {
      users: count("SELECT COUNT(*) AS c FROM users"),
      posts: count("SELECT COUNT(*) AS c FROM posts"),
      comments: count("SELECT COUNT(*) AS c FROM comments"),
      channels: count("SELECT COUNT(*) AS c FROM channels"),
      events: count("SELECT COUNT(*) AS c FROM events"),
      aktiviki: db.prepare("SELECT COALESCE(SUM(aktiviki),0) AS c FROM users").get().c,
    },
  });
});

router.get("/censor", (_req, res) => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'censorEnabled'").get();
  res.json({ enabled: !row || row.value === "1" });
});

router.put("/censor", requireAuth, requireAdmin, (req, res) => {
  const enabled = !!req.body?.enabled;
  db.prepare("UPDATE settings SET value = ? WHERE key = 'censorEnabled'").run(enabled ? "1" : "0");
  res.json({ enabled });
});

// ---------------------------------------------------------------------------
// Галочки: список целей (пользователи + боты + каналы) и выдача уровня 0–3.
// Бот — это тоже запись в users (is_bot = 1), поэтому попадает в общий список.
// ---------------------------------------------------------------------------
router.get("/badges", requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare("SELECT * FROM users ORDER BY created_at ASC").all();
  const channels = db.prepare("SELECT * FROM channels ORDER BY created_at DESC").all();

  // Один агрегат вместо COUNT на каждого пользователя.
  const counts = db.prepare("SELECT user_id, COUNT(*) AS c FROM warnings GROUP BY user_id").all();
  const warningsByUser = new Map(counts.map((row) => [row.user_id, row.c]));

  res.json({
    users: users.map((row) =>
      serializeUser(row, {
        includeModeration: true,
        warningsCount: warningsByUser.get(row.id) || 0,
      }),
    ),
    channels: channels.map(serializeChannel),
  });
});

// Выдать/сменить уровень галочки пользователю или каналу.
// Администратор вправе выдать галочку вручную (в том числе при ограничении).
router.put("/badge", requireAuth, requireAdmin, (req, res) => {
  const { targetType, targetId, level } = req.body || {};
  if (!targetId) return res.status(400).json({ error: "targetId обязателен" });
  if (targetType && targetType !== "user" && targetType !== "channel") {
    return res.status(400).json({ error: "targetType должен быть user или channel" });
  }

  const result = setBadgeLevel({
    targetType: targetType || "user",
    targetId,
    level,
    by: req.userId,
  });
  if (!result.ok) return res.status(400).json({ error: result.error, code: result.code });
  res.json({ badge: result });
});

// Последние варны по всем пользователям — одним запросом (для админ-панели).
router.get("/warnings", requireAuth, requireAdmin, (req, res) => {
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.trunc(rawLimit))) : 50;

  const rows = db.prepare("SELECT * FROM warnings ORDER BY created_at DESC LIMIT ?").all(limit);
  const userIds = Array.from(new Set(rows.map((row) => row.user_id)));
  const users = userIds.length
    ? db
        .prepare(`SELECT id, username FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`)
        .all(...userIds)
    : [];
  const usernameById = new Map(users.map((u) => [u.id, u.username]));

  res.json({
    warnings: rows.map((row) => ({
      ...serializeWarning(row),
      username: usernameById.get(row.user_id) || null,
    })),
  });
});

// Апелляции: сколько ждёт решения (для бейджа на вкладке).
router.get("/appeals/count", requireAuth, requireAdmin, (_req, res) => {
  const row = db.prepare("SELECT COUNT(*) AS c FROM appeals WHERE status = 'pending'").get();
  res.json({ pending: row ? row.c : 0 });
});

// ---------------------------------------------------------------------------
// Удаление аккаунта администратором.
//
// Удаление жёсткое: строка users уходит, а все связанные таблицы чистятся
// каскадом. Слепок и журнал deleted_accounts пишет модуль accountDelete —
// он же используется ботом с подтверждённым входом.
// ---------------------------------------------------------------------------

function safeParse(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

router.post("/users/:id/delete", requireAuth, requireAdmin, (req, res) => {
  const reason = String(req.body?.reason || "").trim();
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });
  if (target.is_admin) return res.status(400).json({ error: "Нельзя удалить администратора" });
  if (PROTECTED_USERNAMES.includes(String(target.username).toLowerCase())) {
    logWarn("Попытка удалить системный аккаунт", { username: target.username, by: req.userId });
    return res.status(400).json({ error: "Системный аккаунт удалить нельзя" });
  }

  // Общая точка удаления: слепок, журнал deleted_accounts, каскад.
  const result = deleteAccount({ targetId: target.id, reason: reason || null, deletedBy: req.userId });
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error });

  logInfo("Аккаунт удалён администратором", {
    userId: target.id,
    username: target.username,
    by: req.userId,
    reason: reason || null,
    snapshot: result.deleted.snapshot,
  });

  res.json({ ok: true, deleted: result.deleted });
});

// Журнал удалённых аккаунтов (последние 50).
router.get("/deleted-accounts", requireAuth, requireAdmin, (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM deleted_accounts ORDER BY created_at DESC LIMIT 50")
    .all();
  res.json({
    deleted: rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      username: row.username,
      reason: row.reason,
      deletedBy: row.deleted_by,
      snapshot: safeParse(row.snapshot),
      createdAt: row.created_at,
    })),
  });
});

// ---------------------------------------------------------------------------
// ИДЕЛЬ ПРЕМИУМ: выдача и снятие подписки (только администратор).
// ---------------------------------------------------------------------------
router.post("/users/:id/premium", requireAuth, requireAdmin, (req, res) => {
  const { days, permanent } = req.body || {};
  const target = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });

  const result = premium.grant({
    userId: target.id,
    days,
    permanent: !!permanent,
    by: req.userId,
  });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, premium: premium.getState(target.id) });
});

router.delete("/users/:id/premium", requireAuth, requireAdmin, (req, res) => {
  const result = premium.revoke(req.params.id, { by: req.userId });
  if (!result.ok) return res.status(404).json({ error: result.error });
  res.json({ ok: true, premium: premium.getState(req.params.id) });
});

module.exports = router;
