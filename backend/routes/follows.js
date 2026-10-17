const express = require("express");
const db = require("../db");
const { uid } = require("../utils/uid");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/toggle", requireAuth, (req, res) => {
  const { userId } = req.body || {};
  if (!userId || userId === req.userId) {
    return res.status(400).json({ error: "Некорректный userId" });
  }
  const existing = db
    .prepare("SELECT id FROM follows WHERE follower_id = ? AND following_id = ?")
    .get(req.userId, userId);

  let following;
  if (existing) {
    db.prepare("DELETE FROM follows WHERE id = ?").run(existing.id);
    following = false;
  } else {
    db.prepare(
      "INSERT INTO follows (id, follower_id, following_id, created_at) VALUES (?, ?, ?, ?)",
    ).run(uid(), req.userId, userId, new Date().toISOString());
    following = true;
    try {
      require("../modules/achievements").syncUser(userId);
    } catch {
      /* достижения не должны ломать подписки */
    }
  }
  res.json({ following });
});

router.get("/status/:userId", requireAuth, (req, res) => {
  const following = !!db
    .prepare("SELECT id FROM follows WHERE follower_id = ? AND following_id = ?")
    .get(req.userId, req.params.userId);
  res.json({ following });
});

router.get("/counts/:userId", (req, res) => {
  const followers = db
    .prepare("SELECT COUNT(*) AS c FROM follows WHERE following_id = ?")
    .get(req.params.userId).c;
  const following = db
    .prepare("SELECT COUNT(*) AS c FROM follows WHERE follower_id = ?")
    .get(req.params.userId).c;
  res.json({ followers, following });
});

module.exports = router;
