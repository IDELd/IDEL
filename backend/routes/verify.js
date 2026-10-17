const express = require("express");
const db = require("../db");
const { uid } = require("../utils/uid");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { serializeVerificationRequest } = require("../utils/serialize");
const { setBadgeLevel, LEVEL_BLUE } = require("../modules/badges");
const { scoreVerificationRequest, scoreAccount } = require("../modules/verificationScore");

const router = express.Router();

router.post("/request", requireAuth, (req, res) => {
  if (req.user.verified) {
    return res.status(400).json({ error: "Аккаунт уже верифицирован" });
  }
  const pending = db
    .prepare("SELECT id FROM verification_requests WHERE user_id = ? AND status = 'pending'")
    .get(req.userId);
  if (pending) return res.status(409).json({ error: "Заявка уже отправлена" });

  const id = uid();
  db.prepare(
    "INSERT INTO verification_requests (id, user_id, status, created_at) VALUES (?, ?, 'pending', ?)",
  ).run(id, req.userId, new Date().toISOString());

  // Сразу считаем «AI-оценку» по фактическим данным аккаунта.
  const scored = scoreVerificationRequest(id);
  const row = db.prepare("SELECT * FROM verification_requests WHERE id = ?").get(id);
  res.status(201).json({ request: serializeVerificationRequest(row), score: scored?.score ?? null });
});

router.get("/", requireAuth, requireAdmin, (_req, res) => {
  const rows = db.prepare("SELECT * FROM verification_requests ORDER BY created_at DESC").all();
  res.json({
    requests: rows.map((row) => {
      // Заявки на верификацию БОТА не пересчитываем: у них в ai_details
      // лежат ответы опроса @verifybot, а не очки скоринга.
      let isBotRequest = false;
      try {
        const parsed = row.ai_details ? JSON.parse(row.ai_details) : null;
        isBotRequest = parsed && typeof parsed === "object" && parsed.type === "bot" && !Array.isArray(parsed);
      } catch {
        isBotRequest = false;
      }

      if (row.status === "pending" && !isBotRequest) {
        scoreVerificationRequest(row.id);
        const fresh = db.prepare("SELECT * FROM verification_requests WHERE id = ?").get(row.id);
        return { ...serializeVerificationRequest(fresh), score: fresh.ai_score };
      }
      return {
        ...serializeVerificationRequest(row),
        // Если заявка была создана до появления оценки — считаем на месте.
        score: row.ai_score ?? (isBotRequest ? 0 : scoreAccount(row.user_id).score),
      };
    }),
  });
});

router.put("/:id", requireAuth, requireAdmin, (req, res) => {
  const { approve, level } = req.body || {};
  const request = db.prepare("SELECT * FROM verification_requests WHERE id = ?").get(req.params.id);
  if (!request) return res.status(404).json({ error: "Заявка не найдена" });

  // Уровень галочки выбирает администратор (0–3); по умолчанию — синяя,
  // как и раньше в поведении verified.
  let badge = null;
  if (approve) {
    const desired = level === undefined || level === null ? LEVEL_BLUE : Number(level);
    badge = setBadgeLevel({
      targetId: request.user_id,
      level: desired,
      by: req.userId,
      // Ограничение «ранг < 50 или блокировка от @restorebot» не даёт выдать
      // галочку через обычную заявку. Администратор может выдать вручную
      // через PUT /api/admin/badge.
      enforceRestrictions: true,
    });
    if (!badge.ok) {
      return res.status(400).json({ error: badge.error, code: badge.code });
    }
  }

  db.prepare("UPDATE verification_requests SET status = ? WHERE id = ?").run(
    approve ? "accepted" : "rejected",
    req.params.id,
  );
  res.json({ ok: true, badge });
});

module.exports = router;
