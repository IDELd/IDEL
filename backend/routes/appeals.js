// Апелляции на блокировку.
//
// Пользовательские маршруты:
//   POST /api/appeal                      — подать апелляцию (и /appeal как в ТЗ)
// Административные:
//   GET  /api/admin/appeals               — список апелляций
//   POST /api/admin/appeals/:id/decide    — решение (одобрить/отклонить)
//
// Роутер смонтирован и с префиксом /api, и в корне — чтобы работали оба
// варианта путей из требований.

const express = require("express");
const db = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { serializeAppeal } = require("../utils/serialize");
const banSystem = require("../modules/banSystem");
const restoreBot = require("../modules/restoreBot");
const { logInfo } = require("../utils/logger");

const router = express.Router();

// Подать апелляцию на текущую блокировку.
router.post("/appeal", requireAuth, (req, res) => {
  const text = String(req.body?.appealText || "").trim();
  if (!text) return res.status(400).json({ error: "Опишите, почему блокировку нужно пересмотреть" });
  if (text.length > 2000) return res.status(400).json({ error: "Текст апелляции слишком длинный" });

  const state = banSystem.getBanState(req.userId);
  if (!state.banned) {
    return res.status(400).json({ error: "Аккаунт не заблокирован — апелляция не требуется" });
  }

  const pending = restoreBot.findPendingAppeal(req.userId);
  if (pending) {
    return res.status(409).json({ error: "Апелляция уже на рассмотрении", appeal: serializeAppeal(pending) });
  }

  const appeal = restoreBot.createAppeal({
    userId: req.userId,
    banReason: state.reason || null,
    appealText: text,
  });
  res.status(201).json({ appeal: serializeAppeal(appeal) });
});

// Список апелляций (админ). По умолчанию — только ожидающие решения.
router.get("/admin/appeals", requireAuth, requireAdmin, (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "pending";
  const rows =
    status === "all"
      ? db.prepare("SELECT * FROM appeals ORDER BY created_at DESC").all()
      : db.prepare("SELECT * FROM appeals WHERE status = ? ORDER BY created_at DESC").all(status);

  const userIds = Array.from(new Set(rows.map((row) => row.user_id)));
  const users = userIds.length
    ? db
        .prepare(`SELECT id, username, full_name, is_bot FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`)
        .all(...userIds)
    : [];
  const usersById = new Map(users.map((u) => [u.id, u]));

  res.json({
    appeals: rows.map((row) => ({
      ...serializeAppeal(row),
      user: usersById.get(row.user_id)
        ? {
            id: usersById.get(row.user_id).id,
            username: usersById.get(row.user_id).username,
            fullName: usersById.get(row.user_id).full_name,
            isBot: !!usersById.get(row.user_id).is_bot,
          }
        : null,
    })),
  });
});

// Решение по апелляции (админ).
router.post("/admin/appeals/:id/decide", requireAuth, requireAdmin, (req, res) => {
  const { approve, comment } = req.body || {};
  const appeal = db.prepare("SELECT * FROM appeals WHERE id = ?").get(req.params.id);
  if (!appeal) return res.status(404).json({ error: "Апелляция не найдена" });
  if (appeal.status !== "pending") {
    return res.status(409).json({ error: "По этой апелляции уже принято решение" });
  }

  const status = approve ? "approved" : "rejected";
  db.prepare(
    "UPDATE appeals SET status = ?, decided_by = ?, decision_comment = ?, decided_at = ? WHERE id = ?",
  ).run(status, req.userId, comment ? String(comment).trim() : null, new Date().toISOString(), appeal.id);

  if (approve) {
    banSystem.unban(appeal.user_id, { by: req.userId, reason: "appeal approved" });
  }

  // Решение сообщает пользователю @restorebot.
  restoreBot.notifyAppealDecision(appeal.user_id, !!approve, comment);
  logInfo("Решение по апелляции", { appealId: appeal.id, userId: appeal.user_id, status, by: req.userId });

  const updated = db.prepare("SELECT * FROM appeals WHERE id = ?").get(appeal.id);
  res.json({ appeal: serializeAppeal(updated), unbanned: !!approve });
});

module.exports = router;
