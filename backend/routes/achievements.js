// Достижения: API.
//
// GET /api/achievements/me          — свои достижения с прогрессом
// GET /api/achievements/:username   — публичные достижения пользователя
//
// Открытие считается на месте (syncUser), поэтому список всегда актуален.

const express = require("express");
const db = require("../db");
const { requireAuth, optionalAuth } = require("../middleware/auth");
const achievements = require("../modules/achievements");

const router = express.Router();

router.get("/me", requireAuth, (req, res) => {
  res.json(achievements.listForUser(req.userId));
});

router.get("/:username", optionalAuth, (req, res) => {
  const username = req.params.username.trim().replace(/^@/, "").toLowerCase();
  const user = db.prepare("SELECT id FROM users WHERE lower(username) = ?").get(username);
  if (!user) return res.status(404).json({ error: "Пользователь не найден" });
  res.json(achievements.listForUser(user.id));
});

module.exports = router;