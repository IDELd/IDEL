const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { issueToken, TOKEN_TTL_MS } = require("../middleware/csrf");

const router = express.Router();

// Клиент запрашивает токен один раз и переиспользует его до истечения срока.
router.get("/", requireAuth, (req, res) => {
  res.json({ token: issueToken(req.userId), expiresInMs: TOKEN_TTL_MS });
});

module.exports = router;
