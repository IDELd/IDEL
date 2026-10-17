const express = require("express");
const db = require("../db");
const { uid } = require("../utils/uid");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/toggle", requireAuth, (req, res) => {
  const { postId } = req.body || {};
  if (!postId) return res.status(400).json({ error: "postId обязателен" });

  const existing = db
    .prepare("SELECT id FROM likes WHERE post_id = ? AND user_id = ?")
    .get(postId, req.userId);

  let liked;
  if (existing) {
    db.prepare("DELETE FROM likes WHERE id = ?").run(existing.id);
    liked = false;
  } else {
    db.prepare("INSERT INTO likes (id, post_id, user_id, created_at) VALUES (?, ?, ?, ?)").run(
      uid(),
      postId,
      req.userId,
      new Date().toISOString(),
    );
    liked = true;
  }
  const count = db.prepare("SELECT COUNT(*) AS c FROM likes WHERE post_id = ?").get(postId).c;
  // Лайки влияют на достижения автора поста — сразу синхронизируем.
  const post = db.prepare("SELECT user_id FROM posts WHERE id = ?").get(postId);
  if (post?.user_id) {
    try {
      require("../modules/achievements").syncUser(post.user_id);
    } catch {
      /* достижения не должны ломать лайки */
    }
  }
  res.json({ liked, count });
});

router.get("/post/:postId", requireAuth, (req, res) => {
  const liked = !!db
    .prepare("SELECT id FROM likes WHERE post_id = ? AND user_id = ?")
    .get(req.params.postId, req.userId);
  const count = db.prepare("SELECT COUNT(*) AS c FROM likes WHERE post_id = ?").get(req.params.postId).c;
  res.json({ liked, count });
});

module.exports = router;
