const express = require("express");
const db = require("../db");
const { uid } = require("../utils/uid");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { serializeForbiddenWord } = require("../utils/serialize");
const { invalidateForbiddenWordsCache } = require("../modules/nicknameFilter");
const { logInfo } = require("../utils/logger");

const router = express.Router();

// Список запрещённых слов (админ).
router.get("/", requireAuth, requireAdmin, (_req, res) => {
  const rows = db.prepare("SELECT * FROM forbidden_words ORDER BY word ASC").all();
  res.json({ words: rows.map(serializeForbiddenWord) });
});

// Добавить слово. Слово хранится уже нормализованным (только буквы, нижний регистр).
router.post("/", requireAuth, requireAdmin, (req, res) => {
  const { word, category } = req.body || {};
  const raw = String(word || "").trim().toLowerCase();
  if (!raw) return res.status(400).json({ error: "Укажите слово" });
  if (raw.length > 50) return res.status(400).json({ error: "Слово слишком длинное" });

  const exists = db.prepare("SELECT id FROM forbidden_words WHERE word = ?").get(raw);
  if (exists) return res.status(409).json({ error: "Такое слово уже добавлено" });

  const id = uid();
  db.prepare("INSERT INTO forbidden_words (id, word, category, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    raw,
    String(category || "other").trim() || "other",
    new Date().toISOString(),
  );
  invalidateForbiddenWordsCache();
  logInfo("Добавлено запрещённое слово", { word: raw, by: req.userId });

  const row = db.prepare("SELECT * FROM forbidden_words WHERE id = ?").get(id);
  res.status(201).json({ word: serializeForbiddenWord(row) });
});

// Удалить слово.
router.delete("/:id", requireAuth, requireAdmin, (req, res) => {
  const row = db.prepare("SELECT * FROM forbidden_words WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Слово не найдено" });

  db.prepare("DELETE FROM forbidden_words WHERE id = ?").run(req.params.id);
  invalidateForbiddenWordsCache();
  logInfo("Удалено запрещённое слово", { word: row.word, by: req.userId });
  res.json({ ok: true });
});

module.exports = router;
