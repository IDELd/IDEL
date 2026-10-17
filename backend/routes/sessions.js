const express = require("express");
const { requireAuth } = require("../middleware/auth");
const sessions = require("../modules/sessions");

const router = express.Router();

// Список сессий пользователя: IP, устройство, дата входа и активности.
// IP и User-Agent расшифровываются только для владельца.
router.get("/", requireAuth, (req, res) => {
  res.json({ sessions: sessions.listSessions(req.userId, req.sessionId) });
});

// Завершить все сессии, кроме текущей.
router.delete("/", requireAuth, (req, res) => {
  const revoked = sessions.revokeOtherSessions(req.userId, req.sessionId);
  res.json({ ok: true, revoked });
});

// Завершить конкретную сессию (только свою).
router.delete("/:id", requireAuth, (req, res) => {
  const result = sessions.revokeSession(req.params.id, req.userId);
  if (!result.ok) {
    const status = result.error === "Нет доступа" ? 403 : 404;
    return res.status(status).json({ error: result.error });
  }
  res.json({ ok: true, revokedCurrent: req.params.id === req.sessionId });
});

module.exports = router;
