const express = require("express");
const db = require("../db");
const { uid } = require("../utils/uid");
const { requireAuth } = require("../middleware/auth");
const { serializeUser, serializeFriendRequest } = require("../utils/serialize");
const { isBlockedEitherWay } = require("../utils/blockCheck");

const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  const accepted = db
    .prepare(
      `SELECT * FROM friend_requests WHERE (from_user_id = ? OR to_user_id = ?) AND status = 'accepted'`,
    )
    .all(req.userId, req.userId);
  const friendIds = accepted.map((r) => (r.from_user_id === req.userId ? r.to_user_id : r.from_user_id));
  if (friendIds.length === 0) return res.json({ users: [] });
  const placeholders = friendIds.map(() => "?").join(",");
  const rows = db.prepare(`SELECT * FROM users WHERE id IN (${placeholders})`).all(...friendIds);
  res.json({ users: rows.map((r) => serializeUser(r)) });
});

router.get("/requests", requireAuth, (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM friend_requests WHERE to_user_id = ? AND status = 'pending'`)
    .all(req.userId);
  res.json({ requests: rows.map(serializeFriendRequest) });
});

router.get("/status/:userId", requireAuth, (req, res) => {
  const otherId = req.params.userId;
  if (otherId === req.userId) return res.json({ status: "none" });
  const found = db
    .prepare(
      `SELECT * FROM friend_requests
       WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)`,
    )
    .get(req.userId, otherId, otherId, req.userId);
  res.json({ status: found ? found.status : "none" });
});

router.post("/request", requireAuth, (req, res) => {
  const { toUserId } = req.body || {};
  if (!toUserId || toUserId === req.userId) {
    return res.status(400).json({ error: "Нельзя добавить себя" });
  }
  if (isBlockedEitherWay(db, req.userId, toUserId)) {
    return res.status(403).json({ error: "Пользователь недоступен" });
  }
  const existing = db
    .prepare(
      `SELECT * FROM friend_requests
       WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)`,
    )
    .get(req.userId, toUserId, toUserId, req.userId);
  if (existing) return res.status(409).json({ error: "Заявка уже отправлена" });

  const id = uid();
  db.prepare(
    "INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
  ).run(id, req.userId, toUserId, new Date().toISOString());
  const row = db.prepare("SELECT * FROM friend_requests WHERE id = ?").get(id);
  res.status(201).json({ request: serializeFriendRequest(row) });
});

router.put("/request/:id/accept", requireAuth, (req, res) => {
  const request = db.prepare("SELECT * FROM friend_requests WHERE id = ?").get(req.params.id);
  if (!request) return res.status(404).json({ error: "Заявка не найдена" });
  if (request.to_user_id !== req.userId) return res.status(403).json({ error: "Нет доступа" });
  db.prepare("UPDATE friend_requests SET status = 'accepted' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.put("/request/:id/reject", requireAuth, (req, res) => {
  const request = db.prepare("SELECT * FROM friend_requests WHERE id = ?").get(req.params.id);
  if (!request) return res.status(404).json({ error: "Заявка не найдена" });
  if (request.to_user_id !== req.userId) return res.status(403).json({ error: "Нет доступа" });
  db.prepare("UPDATE friend_requests SET status = 'rejected' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
