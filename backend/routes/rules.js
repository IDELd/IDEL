// Правила соцсети и автоматоры нарушений.
//
// GET  /api/rules              — публичный список.
// GET  /api/rules/detectors    — библиотека автоматоров (для админ-панели).
// GET  /api/rules/:number      — пункт по номеру.
// POST/PUT/DELETE (админ)      — управление правилами и их автоматорами.
//
// Этот же роутер смонтирован и по пути /api/admin/rules.

const express = require("express");
const db = require("../db");
const { uid } = require("../utils/uid");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { serializeRule } = require("../utils/serialize");
const { logInfo, logWarn } = require("../utils/logger");
const { listDetectors, detectorInfo } = require("../modules/ruleAutomators");

const router = express.Router();

/** Где автоматор может искать нарушение. */
const ALLOWED_CONTEXTS = [
  "post",
  "comment",
  "message",
  "channel_post",
  "group_message",
  "profile",
  "nickname",
  "bot_create",
];

const ACTIONS = ["warn", "ban"];

function validateRuleInput(body) {
  const number = Number(body?.number);
  const title = String(body?.title || "").trim();
  const description = String(body?.description || "").trim();
  if (!Number.isInteger(number) || number < 1) {
    return { ok: false, error: "Номер пункта должен быть целым числом больше нуля" };
  }
  if (!title) return { ok: false, error: "Укажите название пункта" };
  if (!description) return { ok: false, error: "Укажите описание пункта" };
  return { ok: true, number, title, description };
}

/**
 * Разбирает поля автоматора. Если их нет в теле запроса — возвращает
 * undefined, чтобы правка названия не сбрасывала настройки детектора.
 */
function parseAutomator(body) {
  const result = {};
  if (body?.detector !== undefined) {
    if (body.detector !== null && body.detector !== "") {
      const info = detectorInfo(String(body.detector));
      if (!info) return { ok: false, error: "Неизвестный автоматор" };
      result.detector = info.key;
    } else {
      result.detector = null;
    }
  }
  if (body?.contexts !== undefined) {
    const contexts = Array.isArray(body.contexts)
      ? body.contexts.map((c) => String(c)).filter((c) => ALLOWED_CONTEXTS.includes(c))
      : [];
    result.contexts = contexts;
  }
  if (body?.action !== undefined) {
    if (!ACTIONS.includes(body.action)) return { ok: false, error: "Действие: warn или ban" };
    result.action = body.action;
  }
  if (body?.banDays !== undefined) {
    if (body.banDays === null || body.banDays === "") {
      result.banDays = null;
    } else {
      const days = Number(body.banDays);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return { ok: false, error: "Срок бана: целое число дней от 1 до 365" };
      }
      result.banDays = days;
    }
  }
  if (body?.enabled !== undefined) {
    result.enabled = !!body.enabled;
  }
  if (body?.deleteContent !== undefined) {
    result.deleteContent = !!body.deleteContent;
  }
  return { ok: true, ...result };
}

// Библиотека автоматоров — должна идти раньше /:number.
router.get("/detectors", (_req, res) => {
  res.json({ detectors: listDetectors(), contexts: ALLOWED_CONTEXTS });
});

// Публичный список правил.
router.get("/", (_req, res) => {
  const rows = db.prepare("SELECT * FROM rules ORDER BY number ASC").all();
  res.json({ rules: rows.map(serializeRule) });
});

// Пункт правил по номеру.
router.get("/:number", (req, res) => {
  const row = db.prepare("SELECT * FROM rules WHERE number = ?").get(Number(req.params.number));
  if (!row) return res.status(404).json({ error: "Пункт правил не найден" });
  res.json({ rule: serializeRule(row) });
});

// Добавить пункт правил (админ).
router.post("/", requireAuth, requireAdmin, (req, res) => {
  const validation = validateRuleInput(req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.error });
  const automator = parseAutomator(req.body || {});
  if (!automator.ok) return res.status(400).json({ error: automator.error });

  const exists = db.prepare("SELECT id FROM rules WHERE number = ?").get(validation.number);
  if (exists) return res.status(409).json({ error: "Пункт с таким номером уже существует" });

  const id = uid();
  const now = new Date().toISOString();
  const config = JSON.stringify({ contexts: automator.contexts || [] });
  db.prepare(
    `INSERT INTO rules (id, number, title, description, updated_at, detector, detector_config, enabled, action, ban_days, delete_content)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    validation.number,
    validation.title,
    validation.description,
    now,
    automator.detector || null,
    config,
    automator.enabled === false ? 0 : 1,
    automator.action || "warn",
    automator.banDays ?? null,
    automator.deleteContent === false ? 0 : 1,
  );

  logInfo("Добавлен пункт правил", { number: validation.number, detector: automator.detector || null, by: req.userId });
  const row = db.prepare("SELECT * FROM rules WHERE id = ?").get(id);
  res.status(201).json({ rule: serializeRule(row) });
});

// Изменить пункт правил и его автоматор (админ).
router.put("/:id", requireAuth, requireAdmin, (req, res) => {
  const existing = db.prepare("SELECT * FROM rules WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Пункт правил не найден" });

  const validation = validateRuleInput(req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.error });
  const automator = parseAutomator(req.body || {});
  if (!automator.ok) return res.status(400).json({ error: automator.error });

  const clash = db
    .prepare("SELECT id FROM rules WHERE number = ? AND id != ?")
    .get(validation.number, req.params.id);
  if (clash) return res.status(409).json({ error: "Пункт с таким номером уже существует" });

  let config = existing.detector_config;
  if (automator.contexts !== undefined) {
    let previous = {};
    try {
      previous = existing.detector_config ? JSON.parse(existing.detector_config) : {};
    } catch {
      previous = {};
    }
    config = JSON.stringify({ ...previous, contexts: automator.contexts });
  }

  db.prepare(
    `UPDATE rules SET number = ?, title = ?, description = ?, detector = ?, detector_config = ?,
       enabled = ?, action = ?, ban_days = ?, delete_content = ?, updated_at = ? WHERE id = ?`,
  ).run(
    validation.number,
    validation.title,
    validation.description,
    automator.detector !== undefined ? automator.detector : existing.detector,
    config,
    automator.enabled !== undefined ? (automator.enabled ? 1 : 0) : existing.enabled,
    automator.action !== undefined ? automator.action : existing.action,
    automator.banDays !== undefined ? automator.banDays : existing.ban_days,
    automator.deleteContent !== undefined ? (automator.deleteContent ? 1 : 0) : existing.delete_content,
    new Date().toISOString(),
    req.params.id,
  );

  logInfo("Изменён пункт правил", { number: validation.number, by: req.userId });
  const row = db.prepare("SELECT * FROM rules WHERE id = ?").get(req.params.id);
  res.json({ rule: serializeRule(row) });
});

// Удалить пункт правил (админ).
router.delete("/:id", requireAuth, requireAdmin, (req, res) => {
  const existing = db.prepare("SELECT * FROM rules WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Пункт правил не найден" });

  const bans = db.prepare("SELECT COUNT(*) AS c FROM bans WHERE rule_number = ?").get(existing.number);
  if (bans && bans.c > 0) {
    logWarn("Пункт правил удалён, хотя на него ссылаются баны", { number: existing.number, bans: bans.c });
  }

  db.prepare("DELETE FROM rules WHERE id = ?").run(req.params.id);
  logInfo("Удалён пункт правил", { number: existing.number, by: req.userId });
  res.json({ ok: true });
});

module.exports = router;
