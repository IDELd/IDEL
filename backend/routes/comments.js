const express = require("express");
const db = require("../db");
const { uid } = require("../utils/uid");
const { censorText } = require("../utils/censor");
const { serializeComment } = require("../utils/serialize");
const { requireAuth } = require("../middleware/auth");
const { uploadVoice, fileUrl } = require("../middleware/upload");
const banSystem = require("../modules/banSystem");
const automators = require("../modules/ruleAutomators");
const mediaStorage = require("../modules/mediaStorage");
const premium = require("../modules/premium");

const router = express.Router();

function isCensorEnabled() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'censorEnabled'").get();
  return !row || row.value === "1";
}

router.get("/post/:postId", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC")
    .all(req.params.postId);
  res.json({ comments: rows.map(serializeComment) });
});

router.post("/", requireAuth, async (req, res) => {
  const { postId, content, voiceUrl, duration, transcript } = req.body || {};
  if (banSystem.isBanned(req.userId)) {
    return res.status(403).json({ error: "Вы заблокированы и не можете писать комментарии", code: "banned" });
  }
  if (!postId) return res.status(400).json({ error: "postId обязателен" });
  const parentPost = db.prepare("SELECT id FROM posts WHERE id = ?").get(postId);
  if (!parentPost) return res.status(404).json({ error: "Пост не найден" });
  if (!String(content || "").trim() && !voiceUrl) {
    return res.status(400).json({ error: "Пустой комментарий" });
  }
  // Голосовые уходят в Supabase Storage (если настроен), в БД — ссылка.
  const storedVoice = await mediaStorage.storeMediaUrl(voiceUrl, { folder: "voice" });

  const censorEnabled = isCensorEnabled();
  const { text, changed, matches } = censorEnabled
    ? censorText(String(content || ""))
    : { text: String(content || ""), changed: false, matches: [] };

  // Расшифровка голосового — функция ИДЕЛЬ ПРЕМИУМ. Приходит с клиента, где
  // распознаётся браузером во время записи; для остальных сохраняется пустой.
  const premiumActive = premium.isPremium(req.user);
  const cleanTranscript =
    storedVoice && premiumActive && String(transcript || "").trim()
      ? String(transcript).trim().slice(0, 2000)
      : null;

  const id = uid();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO comments (id, post_id, user_id, content, voice_url, duration, transcript, censored, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    postId,
    req.userId,
    text.trim() || null,
    storedVoice || null,
    duration || null,
    cleanTranscript,
    changed ? 1 : 0,
    createdAt,
  );

  // Автоматоры правил: оскорбления, мат, реклама, угрозы и т.д. в комментарии.
  const violation = automators.applyAutomators({
    userId: req.userId,
    context: "comment",
    text: String(content || ""),
    source: "comment",
    sourceId: id,
  });

  if (violation?.removed) {
    return res.status(201).json({
      comment: { id, removed: true },
      removed: true,
      ruleNumber: violation.rule.number,
      ruleTitle: violation.rule.title,
    });
  }

  const row = db.prepare("SELECT * FROM comments WHERE id = ?").get(id);
  try {
    require("../modules/achievements").syncUser(req.userId);
  } catch {
    /* достижения не должны ломать комментарии */
  }
  res.status(201).json({ comment: serializeComment(row) });
});

router.delete("/:id", requireAuth, (req, res) => {
  const comment = db.prepare("SELECT * FROM comments WHERE id = ?").get(req.params.id);
  if (!comment) return res.status(404).json({ error: "Комментарий не найден" });
  if (comment.user_id !== req.userId && !req.user.is_admin) {
    return res.status(403).json({ error: "Нет доступа" });
  }
  db.prepare("DELETE FROM comments WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.post("/upload/voice", requireAuth, uploadVoice.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл не получен" });
  res.json({ url: fileUrl(req, "voice", req.file.filename) });
});

module.exports = router;
