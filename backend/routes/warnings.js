const express = require("express");
const db = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { serializeWarning } = require("../utils/serialize");
const { registerViolation, listWarnings, countWarnings } = require("../modules/warnings");
const { getReputation } = require("../modules/reputation");

const router = express.Router();

// Выдать варн. Доступно администратору; системные модули вызывают тот же
// registerViolation() напрямую, без HTTP.
router.post("/", requireAuth, requireAdmin, (req, res) => {
  const { userId, reason, category, ruleNumber } = req.body || {};
  if (!userId || !String(reason || "").trim()) {
    return res.status(400).json({ error: "userId и reason обязательны" });
  }
  const target = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });

  const result = registerViolation({
    userId,
    reason: String(reason).trim(),
    category: category || "other",
    issuedBy: req.userId,
    ruleNumber: Number.isInteger(ruleNumber) ? ruleNumber : null,
  });
  if (!result.ok) return res.status(400).json({ error: result.error });

  res.status(201).json({
    warning: serializeWarning(result.warning),
    warningsCount: result.warningsCount,
    reputation: result.reputation,
    banned: result.banned,
  });
});

// Своё количество варнов и ранг.
router.get("/me", requireAuth, (req, res) => {
  res.json({
    warnings: listWarnings(req.userId).map(serializeWarning),
    count: countWarnings(req.userId),
    reputation: getReputation(req.userId),
  });
});

// Варны конкретного пользователя — себе или администратору.
router.get("/:userId", requireAuth, (req, res) => {
  if (req.userId !== req.params.userId && !req.user.is_admin) {
    return res.status(403).json({ error: "Нет доступа" });
  }
  res.json({
    warnings: listWarnings(req.params.userId).map(serializeWarning),
    count: countWarnings(req.params.userId),
    reputation: getReputation(req.params.userId),
  });
});

module.exports = router;
