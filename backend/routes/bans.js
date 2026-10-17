const express = require("express");
const db = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { serializeBan } = require("../utils/serialize");
const banSystem = require("../modules/banSystem");
const reputation = require("../modules/reputation");

const router = express.Router();

// Список активных банов (админ).
router.get("/", requireAuth, requireAdmin, (_req, res) => {
  const rows = db.prepare("SELECT * FROM bans ORDER BY created_at DESC").all();
  res.json({ bans: rows.map(serializeBan) });
});

/**
 * Состояние бана. Публичный роут: владельцу профиля нужны причина, пункт
 * правил и срок, чтобы показать плашку; остальным — только факт бана.
 */
router.get("/status/:userId", (req, res) => {
  const state = banSystem.getBanState(req.params.userId);
  res.json({
    banned: !!state.banned,
    reason: state.reason || null,
    ruleNumber: state.ruleNumber ?? null,
    mode: state.mode || null,
    expiresAt: state.expiresAt || null,
    daysLeft: state.daysLeft ?? null,
    isAuto: !!state.isAuto,
  });
});

/**
 * Выдать бан.
 * body: { userId, reason, ruleNumber?, mode?: 'normal'|'serious', durationDays? }
 * mode = 'serious' — полный сброс профиля; durationDays — временный бан.
 */
router.post("/", requireAuth, requireAdmin, (req, res) => {
  const { userId, reason, ruleNumber, mode, durationDays } = req.body || {};
  if (!userId || !String(reason || "").trim()) {
    return res.status(400).json({ error: "userId и reason обязательны" });
  }
  if (mode && mode !== banSystem.MODE_NORMAL && mode !== banSystem.MODE_SERIOUS) {
    return res.status(400).json({ error: "mode должен быть normal или serious" });
  }
  const days = Number(durationDays);
  if (durationDays !== undefined && durationDays !== null && (!Number.isFinite(days) || days <= 0)) {
    return res.status(400).json({ error: "durationDays должен быть положительным числом" });
  }

  const result = banSystem.applyBan({
    userId,
    reason: String(reason).trim(),
    ruleNumber: Number.isInteger(ruleNumber) ? ruleNumber : null,
    mode: mode || banSystem.MODE_NORMAL,
    durationDays: Number.isFinite(days) && days > 0 ? days : null,
    bannedBy: req.userId,
    isAuto: false,
  });
  if (!result.ok) return res.status(400).json({ error: result.error });

  const row = db.prepare("SELECT * FROM bans WHERE user_id = ?").get(userId);
  res.status(201).json({ ok: true, ban: serializeBan(row), badge: result.badge, reset: result.reset || null });
});

// Снять бан.
router.delete("/:userId", requireAuth, requireAdmin, (req, res) => {
  const result = banSystem.unban(req.params.userId, { by: req.userId });
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true });
});

// Снять ограничение на получение бронзовой галочки (наложено @restorebot).
// Снять его может только администратор.
router.delete("/:userId/restrictions", requireAuth, requireAdmin, (req, res) => {
  const target = db.prepare("SELECT id FROM users WHERE id = ?").get(req.params.userId);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });
  const restrictions = reputation.unblockBronzeBadge(req.params.userId);
  res.json({ ok: true, restrictions });
});

module.exports = router;
