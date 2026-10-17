const express = require("express");
const db = require("../db");
const { serializeUser } = require("../utils/serialize");
const { requireAuth, requireAdmin, optionalAuth } = require("../middleware/auth");
const { checkNickname } = require("../modules/nicknameFilter");
const { setBadgeLevel, LEVEL_BLUE, LEVEL_NONE } = require("../modules/badges");
const automators = require("../modules/ruleAutomators");
const { uploadAvatar, uploadCover, fileUrl } = require("../middleware/upload");

const router = express.Router();

router.get("/", optionalAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM users ORDER BY created_at ASC").all();
  // Поля модерации (ранг, варны, ограничения) отдаём только по себе.
  res.json({
    users: rows.map((r) =>
      serializeUser(r, { includeModeration: !!req.userId && req.userId === r.id }),
    ),
  });
});

router.get("/:username", optionalAuth, (req, res) => {
  const username = req.params.username.trim().replace(/^@/, "").toLowerCase();
  const row = db.prepare("SELECT * FROM users WHERE lower(username) = ?").get(username);
  if (!row) return res.status(404).json({ error: "Пользователь не найден" });
  const includeModeration = !!req.user && (req.userId === row.id || !!req.user.is_admin);
  res.json({ user: serializeUser(row, { includeModeration }) });
});

router.put("/profile", requireAuth, (req, res) => {
  const { fullName, bio, avatarUrl, coverUrl } = req.body || {};
  db.prepare(
    "UPDATE users SET full_name = ?, bio = ?, avatar_url = ?, cover_url = ? WHERE id = ?",
  ).run(
    String(fullName ?? req.user.full_name).trim(),
    String(bio ?? req.user.bio).trim(),
    avatarUrl === undefined ? req.user.avatar_url : avatarUrl,
    coverUrl === undefined ? req.user.cover_url : coverUrl,
    req.userId,
  );
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);

  // Автоматоры правил для профиля: реклама/контакты/мат в описании и имени.
  automators.applyAutomators({
    userId: req.userId,
    context: "profile",
    text: `${String(updated.full_name || "")}\n${String(updated.bio || "")}`,
    source: null,
    sourceId: null,
  });

  // Копия описания профиля в Supabase (best-effort, ответ не ждёт).
  try {
    require("../modules/cloudMirror").mirrorProfile(updated).catch(() => {});
  } catch {
    /* зеркало не должно ломать сохранение профиля */
  }

  res.json({ user: serializeUser(updated) });
});

router.put("/username", requireAuth, (req, res) => {
  // Формат + запрещённые слова (таблица forbidden_words).
  const validation = checkNickname(req.body?.username);
  if (!validation.ok) {
    // Попытка взять запрещённый ник — это нарушение: варн и отказ.
    const violated = validation.code === "nickname_forbidden" || !!validation.matched;
    if (violated) {
      // Автоматоры правил: запрещённые ники, подделка ников, обход бана.
      automators.applyAutomators({
        userId: req.userId,
        context: "nickname",
        text: String(req.body?.username || "").trim(),
        source: null,
        sourceId: null,
      });
    }
    return res.status(400).json({
      error: validation.error,
      code: validation.code,
      matched: validation.matched,
      warned: violated,
    });
  }

  if (validation.username !== req.user.username.toLowerCase()) {
    const taken = db
      .prepare("SELECT id FROM users WHERE lower(username) = ? AND id != ?")
      .get(validation.username, req.userId);
    if (taken) return res.status(409).json({ error: "Username уже занят" });
  }

  // The immutability trigger only blocks no-op updates; a real change goes through.
  db.prepare("UPDATE users SET username = ? WHERE id = ?").run(validation.username, req.userId);
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  res.json({ user: serializeUser(updated) });
});

router.delete("/account", requireAuth, (req, res) => {
  // ON DELETE CASCADE on every foreign key handles posts, comments, likes,
  // follows, channels, friend requests, messages, verification requests,
  // reports, bans and blocks automatically.
  db.prepare("DELETE FROM users WHERE id = ?").run(req.userId);
  res.json({ ok: true });
});

router.put("/:id/verified", requireAuth, requireAdmin, (req, res) => {
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });
  if (target.is_admin) return res.status(400).json({ error: "Нельзя изменить администратора" });
  // Старая кнопка «выдать/снять» теперь управляет крайними уровнями галочки:
  // выдать — синяя (3), снять — 0. Промежуточные уровни — в админ-панели.
  const result = setBadgeLevel({
    targetId: req.params.id,
    level: req.body?.verified ? LEVEL_BLUE : LEVEL_NONE,
    by: req.userId,
  });
  if (!result.ok) return res.status(400).json({ error: result.error, code: result.code });
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  res.json({ user: serializeUser(updated, { includeModeration: true }), badge: result });
});

router.post("/avatar", requireAuth, uploadAvatar.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл не получен" });
  const url = fileUrl(req, "avatars", req.file.filename);
  res.json({ url });
});

router.post("/cover", requireAuth, uploadCover.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл не получен" });
  const url = fileUrl(req, "covers", req.file.filename);
  res.json({ url });
});

module.exports = router;
