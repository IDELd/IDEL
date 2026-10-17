// ИДЕЛЬ ПРЕМИУМ: публичная информация и настройка цвета своих сообщений.
//
// Выдача и снятие подписки — только администратор (см. routes/admin.js),
// разовый триал — команда /premium в @creatorbot.

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { serializeUser } = require("../utils/serialize");
const premium = require("../modules/premium");

const router = express.Router();

// Публично: палитра и условия, чтобы интерфейс не дублировал константы.
router.get("/", (_req, res) => {
  res.json({
    colors: premium.MESSAGE_COLORS,
    trialDays: premium.TRIAL_DAYS,
  });
});

// Своё состояние подписки.
router.get("/me", requireAuth, (req, res) => {
  res.json({ premium: premium.getState(req.userId) });
});

// Цвет текста в сообщениях, комментариях и постах.
router.put("/color", requireAuth, (req, res) => {
  const result = premium.setMessageColor(req.userId, req.body?.color ?? null);
  if (!result.ok) {
    const status = result.code === "premium_required" ? 403 : 400;
    return res.status(status).json({ error: result.error, code: result.code });
  }
  const user = require("../db").prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  res.json({ color: result.color, user: serializeUser(user, { includeModeration: true }) });
});

module.exports = router;
