const express = require("express");
const { isNicknameAllowed } = require("../modules/nicknameFilter");

const router = express.Router();

// Публичная проверка ника для форм регистрации и смены имени.
// Только чтение: под CSRF-защиту не попадает.
router.get("/check", (req, res) => {
  res.json(isNicknameAllowed(req.query.username));
});

module.exports = router;
