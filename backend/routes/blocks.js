const express = require("express");
const db = require("../db");
const { uid } = require("../utils/uid");
const { requireAuth } = require("../middleware/auth");
const { serializeUser } = require("../utils/serialize");

const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = ?`,
    )
    .all(req.userId);
  res.json({ users: rows.map((r) => serializeUser(r)) });
});

router.post("/:userId", requireAuth, (req, res) => {
  const blockedId = req.params.userId;
  if (blockedId === req.userId) {
    return res.status(400).json({ error: "Нельзя заблокировать самого себя" });
  }
  const existing = db
    .prepare("SELECT id FROM blocks WHERE blocker_id = ? AND blocked_id = ?")
    .get(req.userId, blockedId);
  if (!existing) {
    db.prepare(
      "INSERT INTO blocks (id, blocker_id, blocked_id, created_at) VALUES (?, ?, ?, ?)",
    ).run(uid(), req.userId, blockedId, new Date().toISOString());
  }
  // A block also ends any follow/friendship between the two users.
  db.prepare(
    "DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)",
  ).run(req.userId, blockedId, blockedId, req.userId);
  db.prepare(
    "DELETE FROM friend_requests WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)",
  ).run(req.userId, blockedId, blockedId, req.userId);
  res.json({ ok: true });
});

router.delete("/:userId", requireAuth, (req, res) => {
  db.prepare("DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?").run(
    req.userId,
    req.params.userId,
  );
  res.json({ ok: true });
});

router.get("/status/:userId", requireAuth, (req, res) => {
  const otherId = req.params.userId;
  const iBlockedThem = !!db
    .prepare("SELECT id FROM blocks WHERE blocker_id = ? AND blocked_id = ?")
    .get(req.userId, otherId);
  const theyBlockedMe = !!db
    .prepare("SELECT id FROM blocks WHERE blocker_id = ? AND blocked_id = ?")
    .get(otherId, req.userId);
  res.json({ iBlockedThem, theyBlockedMe });
});

module.exports = router;
