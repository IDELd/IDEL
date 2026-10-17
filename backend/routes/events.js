const express = require("express");
const db = require("../db");
const { uid } = require("../utils/uid");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { serializeEvent, serializeSubmission } = require("../utils/serialize");

const router = express.Router();

function addAktiviki(userId, amount) {
  db.prepare("UPDATE users SET aktiviki = aktiviki + ? WHERE id = ?").run(amount, userId);
}

function getUserPoints(userId) {
  const followers = db
    .prepare("SELECT COUNT(*) AS c FROM follows WHERE following_id = ?")
    .get(userId).c;
  const likesReceived = db
    .prepare(
      `SELECT COUNT(*) AS c FROM likes l JOIN posts p ON p.id = l.post_id WHERE p.user_id = ?`,
    )
    .get(userId).c;
  return followers + likesReceived;
}

router.get("/", (_req, res) => {
  const rows = db.prepare("SELECT * FROM events ORDER BY created_at DESC").all();
  res.json({ events: rows.map(serializeEvent) });
});

router.get("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Событие не найдено" });
  res.json({ event: serializeEvent(row) });
});

router.post("/", requireAuth, requireAdmin, (req, res) => {
  const { type, title, description, theme, questions, reward, participationReward, startAt, endAt, active } =
    req.body || {};
  if (!type || !title || !startAt || !endAt) {
    return res.status(400).json({ error: "Заполните обязательные поля" });
  }
  const id = uid();
  db.prepare(
    `INSERT INTO events (id, type, title, description, theme, questions, reward, participation_reward, start_at, end_at, active, finalized, winner_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)`,
  ).run(
    id,
    type,
    String(title).trim(),
    String(description || "").trim(),
    theme || null,
    JSON.stringify(questions || []),
    reward || 0,
    participationReward || 0,
    startAt,
    endAt,
    active ? 1 : 0,
    new Date().toISOString(),
  );
  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(id);
  res.status(201).json({ event: serializeEvent(row) });
});

router.put("/:id/active", requireAuth, requireAdmin, (req, res) => {
  db.prepare("UPDATE events SET active = ? WHERE id = ?").run(req.body?.active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.delete("/:id", requireAuth, requireAdmin, (req, res) => {
  db.prepare("DELETE FROM events WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.get("/:id/submissions", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM event_submissions WHERE event_id = ?").all(req.params.id);
  res.json({ submissions: rows.map(serializeSubmission) });
});

router.get("/:id/submissions/mine", requireAuth, (req, res) => {
  const row = db
    .prepare("SELECT * FROM event_submissions WHERE event_id = ? AND user_id = ?")
    .get(req.params.id, req.userId);
  res.json({ submission: row ? serializeSubmission(row) : null });
});

router.post("/:id/submit/pixelwar", requireAuth, (req, res) => {
  const { drawingUrl } = req.body || {};
  if (!drawingUrl) return res.status(400).json({ error: "drawingUrl обязателен" });
  upsertSubmission(req.params.id, req.userId, { drawingUrl, answers: null, score: null });
  res.json({ ok: true });
});

router.post("/:id/submit/wordwar", requireAuth, (req, res) => {
  const { answers } = req.body || {};
  const event = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
  if (!event) return res.status(404).json({ error: "Событие не найдено" });
  const questions = JSON.parse(event.questions || "[]");
  const score = questions.reduce((acc, q, i) => acc + (answers?.[i] === q.correctIndex ? 1 : 0), 0);
  upsertSubmission(req.params.id, req.userId, { drawingUrl: null, answers, score });
  res.json({ ok: true, score });
});

function upsertSubmission(eventId, userId, { drawingUrl, answers, score }) {
  const existing = db
    .prepare("SELECT * FROM event_submissions WHERE event_id = ? AND user_id = ?")
    .get(eventId, userId);
  if (existing) {
    db.prepare(
      "UPDATE event_submissions SET drawing_url = ?, answers = ?, score = ? WHERE id = ?",
    ).run(drawingUrl, answers ? JSON.stringify(answers) : null, score, existing.id);
  } else {
    db.prepare(
      `INSERT INTO event_submissions (id, event_id, user_id, drawing_url, answers, score, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(uid(), eventId, userId, drawingUrl, answers ? JSON.stringify(answers) : null, score, new Date().toISOString());
  }
}

router.put("/:id/winner", requireAuth, requireAdmin, (req, res) => {
  db.prepare("UPDATE events SET winner_id = ? WHERE id = ?").run(req.body?.winnerId, req.params.id);
  res.json({ ok: true });
});

router.post("/:id/finalize", requireAuth, requireAdmin, (req, res) => {
  const event = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
  if (!event) return res.status(404).json({ error: "Событие не найдено" });
  if (event.finalized) return res.json({ event: serializeEvent(event) });

  const submissions = db.prepare("SELECT * FROM event_submissions WHERE event_id = ?").all(req.params.id);
  let winnerId = event.winner_id;

  if (event.type === "pixelwar") {
    if (winnerId) {
      addAktiviki(winnerId, event.reward);
      submissions.filter((s) => s.user_id !== winnerId).forEach((s) => addAktiviki(s.user_id, event.participation_reward));
    }
  } else if (event.type === "wordwar") {
    const ranked = submissions.filter((s) => s.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    if (ranked.length > 0) {
      winnerId = ranked[0].user_id;
      addAktiviki(winnerId, event.reward);
      ranked.slice(1).forEach((s) => addAktiviki(s.user_id, event.participation_reward));
    }
  } else {
    const users = db.prepare("SELECT id FROM users").all();
    const ranked = users
      .map((u) => ({ userId: u.id, points: getUserPoints(u.id) }))
      .filter((r) => r.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 3);
    if (ranked.length > 0) {
      winnerId = ranked[0].userId;
      addAktiviki(winnerId, event.reward);
      ranked.slice(1).forEach((r) => addAktiviki(r.userId, event.participation_reward));
    }
  }

  db.prepare("UPDATE events SET finalized = 1, winner_id = ? WHERE id = ?").run(winnerId, req.params.id);
  const updated = db.prepare("SELECT * FROM events WHERE id = ?").get(req.params.id);
  res.json({ event: serializeEvent(updated) });
});

router.get("/leaderboard/points", (_req, res) => {
  const users = db.prepare("SELECT id, username FROM users").all();
  const ranked = users
    .map((u) => ({ userId: u.id, username: u.username, points: getUserPoints(u.id) }))
    .filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, 5);
  res.json({ leaderboard: ranked });
});

module.exports = router;
