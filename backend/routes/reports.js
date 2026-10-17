const express = require("express");
const db = require("../db");
const { uid } = require("../utils/uid");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { serializeReport } = require("../utils/serialize");

const router = express.Router();

router.post("/", requireAuth, (req, res) => {
  const { reportedUserId, reason } = req.body || {};
  if (!reportedUserId || !String(reason || "").trim()) {
    return res.status(400).json({ error: "reportedUserId и reason обязательны" });
  }
  const id = uid();
  db.prepare(
    `INSERT INTO reports (id, reporter_user_id, reported_user_id, reason, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
  ).run(id, req.userId, reportedUserId, String(reason).trim(), new Date().toISOString());
  const row = db.prepare("SELECT * FROM reports WHERE id = ?").get(id);
  res.status(201).json({ report: serializeReport(row) });
});

router.get("/", requireAuth, requireAdmin, (_req, res) => {
  const rows = db.prepare("SELECT * FROM reports ORDER BY created_at DESC").all();
  res.json({ reports: rows.map(serializeReport) });
});

router.put("/:id", requireAuth, requireAdmin, (req, res) => {
  const { action } = req.body || {}; // 'resolve' | 'dismiss'
  const report = db.prepare("SELECT * FROM reports WHERE id = ?").get(req.params.id);
  if (!report) return res.status(404).json({ error: "Жалоба не найдена" });
  db.prepare("UPDATE reports SET status = ? WHERE id = ?").run(
    action === "resolve" ? "resolved" : "dismissed",
    req.params.id,
  );
  res.json({ ok: true });
});

module.exports = router;
