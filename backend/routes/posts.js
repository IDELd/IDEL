const express = require("express");
const db = require("../db");
const { uid } = require("../utils/uid");
const { censorText } = require("../utils/censor");
const { serializePost, serializeVideo } = require("../utils/serialize");
const { requireAuth, optionalAuth } = require("../middleware/auth");
const { uploadPostImage, uploadVideo, fileUrl } = require("../middleware/upload");
const { isBlockedEitherWay } = require("../utils/blockCheck");
const banSystem = require("../modules/banSystem");
const automators = require("../modules/ruleAutomators");
const mediaStorage = require("../modules/mediaStorage");

const router = express.Router();

function isCensorEnabled() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'censorEnabled'").get();
  return !row || row.value === "1";
}

function attachVideo(post) {
  const row = db.prepare("SELECT * FROM posts WHERE id = ? AND video_url IS NOT NULL").get(post.id);
  if (row && row.video_url) {
    return { ...post, video: { ...serializeVideo(row), postId: post.id } };
  }
  return post;
}

router.get("/", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM posts ORDER BY created_at DESC").all();
  const visible = rows.filter((r) => {
    if (isBlockedEitherWay(db, req.userId, r.user_id)) return false;
    // Посты забаненных скрыты от остальных: «для вашей безопасности мы скрыли
    // его чаты и его посты от вас». Автор и администратор видят их как раньше.
    if (r.user_id !== req.userId && !req.user.is_admin && banSystem.isBanned(r.user_id)) return false;
    return true;
  });
  res.json({ posts: visible.map((r) => attachVideo(serializePost(r))) });
});

router.get("/user/:userId", optionalAuth, (req, res) => {
  const isSelfOrAdmin = !!req.user && (req.userId === req.params.userId || !!req.user.is_admin);
  if (!isSelfOrAdmin && banSystem.isBanned(req.params.userId)) {
    return res.json({ posts: [], banned: true });
  }
  const rows = db
    .prepare("SELECT * FROM posts WHERE user_id = ? ORDER BY created_at DESC")
    .all(req.params.userId);
  res.json({ posts: rows.map((r) => attachVideo(serializePost(r))) });
});

router.post("/", requireAuth, async (req, res) => {
  const { content, imageUrl, drawingUrl, videoUrl, videoThumbnailUrl, videoDuration } = req.body || {};
  // Забаненный пользователь не может создавать посты (старые остаются на месте).
  if (banSystem.isBanned(req.userId)) {
    return res.status(403).json({ error: "Вы заблокированы и не можете публиковать посты", code: "banned" });
  }
  if (!String(content || "").trim() && !imageUrl && !drawingUrl && !videoUrl) {
    return res.status(400).json({ error: "Введите текст или приложите файл" });
  }
  const censorEnabled = isCensorEnabled();
  const { text, changed, matches } = censorEnabled ? censorText(String(content || "")) : { text: String(content || ""), changed: false, matches: [] };

  // Крупные медиа уходят в Supabase Storage (если настроен), в БД — ссылка.
  const storedImage = await mediaStorage.storeMediaUrl(imageUrl, { folder: "posts" });
  const storedDrawing = await mediaStorage.storeMediaUrl(drawingUrl, { folder: "drawings" });
  const storedVideo = await mediaStorage.storeMediaUrl(videoUrl, { folder: "video" });
  const storedThumb = await mediaStorage.storeMediaUrl(videoThumbnailUrl, { folder: "video" });

  const id = uid();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO posts (id, user_id, content, image_url, drawing_url, video_url, video_thumbnail_url, video_duration, censored, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    req.userId,
    text.trim(),
    storedImage || null,
    storedDrawing || null,
    storedVideo || null,
    storedThumb || null,
    videoDuration || null,
    changed ? 1 : 0,
    createdAt,
  );

  // Автоматоры правил: мат, оскорбления, спам, капс и прочие нарушения.
  // Проверяем исходный текст (до цензурирования) и применяем первое
  // подходящее правило — один варн за одно действие.
  const violation = automators.applyAutomators({
    userId: req.userId,
    context: "post",
    text: String(content || ""),
    source: "post",
    sourceId: id,
    imageUrl: imageUrl || null,
  });

  // Нарушающий пост удалён автоматором — клиенту сообщаем, чтобы он обновил ленту.
  if (violation?.removed) {
    return res.status(201).json({
      post: { id, removed: true },
      removed: true,
      ruleNumber: violation.rule.number,
      ruleTitle: violation.rule.title,
    });
  }

  const row = db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
  try {
    require("../modules/achievements").syncUser(req.userId);
  } catch {
    /* достижения не должны ломать публикацию */
  }
  res.status(201).json({ post: attachVideo(serializePost(row)) });
});

router.delete("/:id", requireAuth, (req, res) => {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id);
  if (!post) return res.status(404).json({ error: "Пост не найден" });
  if (post.user_id !== req.userId && !req.user.is_admin) {
    return res.status(403).json({ error: "Нет доступа" });
  }
  db.prepare("DELETE FROM posts WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.post("/upload/image", requireAuth, uploadPostImage.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл не получен" });
  res.json({ url: fileUrl(req, "posts", req.file.filename) });
});

router.post("/upload/video", requireAuth, uploadVideo.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл не получен" });
  res.json({ url: fileUrl(req, "video", req.file.filename) });
});

module.exports = router;
