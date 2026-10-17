const express = require("express");
const db = require("../db");
const { uid } = require("../utils/uid");
const { censorText } = require("../utils/censor");
const { encrypt } = require("../modules/messageCrypto");
const { requireAuth } = require("../middleware/auth");
const {
  serializeGroup,
  serializeGroupMember,
  serializeGroupMessage,
} = require("../utils/serialize");
const banSystem = require("../modules/banSystem");
const automators = require("../modules/ruleAutomators");
const mediaStorage = require("../modules/mediaStorage");
const { logInfo } = require("../utils/logger");

const router = express.Router();

const VISIBILITIES = ["public", "private"];
const ROLES = ["owner", "moderator", "member"];

function isCensorEnabled() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'censorEnabled'").get();
  return !row || row.value === "1";
}

/** Группа с ролью и флагом бана текущего зрителя + числом участников. */
function getGroupRow(id, viewer) {
  return (
    db
      .prepare(
        `SELECT g.*,
          m.role AS my_role,
          m.banned AS is_banned,
          (SELECT COUNT(*) FROM chat_group_members cm WHERE cm.group_id = g.id) AS member_count
         FROM chat_groups g
         LEFT JOIN chat_group_members m ON m.group_id = g.id AND m.user_id = ?
         WHERE g.id = ?`,
      )
      .get(viewer?.id || "", id) || null
  );
}

function memberRow(groupId, userId) {
  return db
    .prepare("SELECT * FROM chat_group_members WHERE group_id = ? AND user_id = ?")
    .get(groupId, userId);
}

/** Группа видна: публичная — всем, приватная — участникам и админу. */
function canSee(group, viewer) {
  if (!group) return false;
  if ((group.visibility || "public") !== "private") return true;
  if (!viewer) return false;
  return !!viewer.is_admin || !!group.my_role;
}

/** Доступ к переписке: участник группы и не забанен в ней. */
function canRead(group, viewer) {
  return !!viewer && !!group.my_role && !group.is_banned;
}

function canModerate(group, viewer) {
  if (!viewer) return false;
  return !!viewer.is_admin || group.my_role === "owner" || group.my_role === "moderator";
}

function canManage(group, viewer) {
  if (!viewer) return false;
  return !!viewer.is_admin || group.my_role === "owner";
}

function serializeWithViewer(group, viewer) {
  return serializeGroup(group, viewer);
}

/** Список участников с данными пользователей. */
function membersOf(groupId) {
  return db
    .prepare(
      `SELECT m.*, u.username, u.full_name, u.avatar_url, u.badge_level
       FROM chat_group_members m JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ?
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END, m.created_at ASC`,
    )
    .all(groupId);
}

// ---------------------------------------------------------------------------
// Список и создание
// ---------------------------------------------------------------------------

router.get("/", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT g.*,
        m.role AS my_role,
        m.banned AS is_banned,
        (SELECT COUNT(*) FROM chat_group_members cm WHERE cm.group_id = g.id) AS member_count
       FROM chat_groups g
       LEFT JOIN chat_group_members m ON m.group_id = g.id AND m.user_id = ?
       ORDER BY g.created_at DESC`,
    )
    .all(req.userId);
  const visible = rows.filter((row) => canSee(row, req.user));
  res.json({ groups: visible.map((row) => serializeWithViewer(row, req.user)) });
});

router.post("/", requireAuth, (req, res) => {
  if (banSystem.isBanned(req.userId)) {
    return res.status(403).json({ error: "Вы заблокированы и не можете создавать группы", code: "banned" });
  }
  const { name, description, avatarUrl, visibility } = req.body || {};
  if (!String(name || "").trim()) return res.status(400).json({ error: "Введите название группы" });
  const desiredVisibility = VISIBILITIES.includes(visibility) ? visibility : "public";

  const id = uid();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO chat_groups (id, name, description, avatar_url, visibility, owner_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    String(name).trim(),
    String(description || "").trim(),
    avatarUrl || null,
    desiredVisibility,
    req.userId,
    now,
  );
  db.prepare(
    "INSERT INTO chat_group_members (group_id, user_id, role, banned, created_at) VALUES (?, ?, 'owner', 0, ?)",
  ).run(id, req.userId, now);
  logInfo("Создана группа", { groupId: id, ownerId: req.userId });

  res.status(201).json({ group: serializeWithViewer(getGroupRow(id, req.user), req.user) });
});

// ---------------------------------------------------------------------------
// Одна группа
// ---------------------------------------------------------------------------

router.get("/:id", requireAuth, (req, res) => {
  const group = getGroupRow(req.params.id, req.user);
  if (!group) return res.status(404).json({ error: "Группа не найдена" });
  if (!canSee(group, req.user)) {
    return res.status(403).json({ error: "Группа приватная", code: "private_group" });
  }
  res.json({ group: serializeWithViewer(group, req.user) });
});

router.put("/:id", requireAuth, (req, res) => {
  const group = getGroupRow(req.params.id, req.user);
  if (!group) return res.status(404).json({ error: "Группа не найдена" });
  if (!canManage(group, req.user)) {
    return res.status(403).json({ error: "Менять настройки может только владелец" });
  }
  const { name, description, avatarUrl, visibility } = req.body || {};
  const nextName = name === undefined ? group.name : String(name).trim();
  if (!nextName) return res.status(400).json({ error: "Название не может быть пустым" });
  const nextVisibility = visibility === undefined ? group.visibility : visibility;
  if (!VISIBILITIES.includes(nextVisibility)) {
    return res.status(400).json({ error: "Приватность: public или private" });
  }
  db.prepare(
    "UPDATE chat_groups SET name = ?, description = ?, avatar_url = ?, visibility = ? WHERE id = ?",
  ).run(
    nextName,
    description === undefined ? group.description : String(description || "").trim(),
    avatarUrl === undefined ? group.avatar_url : avatarUrl || null,
    nextVisibility,
    group.id,
  );
  res.json({ group: serializeWithViewer(getGroupRow(group.id, req.user), req.user) });
});

router.delete("/:id", requireAuth, (req, res) => {
  const group = getGroupRow(req.params.id, req.user);
  if (!group) return res.status(404).json({ error: "Группа не найдена" });
  if (!canManage(group, req.user)) {
    return res.status(403).json({ error: "Удалить группу может только владелец" });
  }
  db.prepare("DELETE FROM chat_groups WHERE id = ?").run(group.id);
  logInfo("Удалена группа", { groupId: group.id, by: req.userId });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Вступление и выход
// ---------------------------------------------------------------------------

router.post("/:id/join", requireAuth, (req, res) => {
  const group = getGroupRow(req.params.id, req.user);
  if (!group) return res.status(404).json({ error: "Группа не найдена" });
  if (banSystem.isBanned(req.userId)) {
    return res.status(403).json({ error: "Вы заблокированы", code: "banned" });
  }
  if (group.is_banned) {
    return res.status(403).json({ error: "Вы заблокированы в этой группе", code: "group_banned" });
  }
  if (group.my_role) return res.status(409).json({ error: "Вы уже участник группы" });
  if (group.visibility === "private") {
    return res.status(403).json({ error: "В приватную группу может добавить только владелец", code: "private_group" });
  }
  db.prepare(
    "INSERT INTO chat_group_members (group_id, user_id, role, banned, created_at) VALUES (?, ?, 'member', 0, ?)",
  ).run(group.id, req.userId, new Date().toISOString());
  res.status(201).json({ group: serializeWithViewer(getGroupRow(group.id, req.user), req.user) });
});

router.post("/:id/leave", requireAuth, (req, res) => {
  const group = getGroupRow(req.params.id, req.user);
  if (!group) return res.status(404).json({ error: "Группа не найдена" });
  if (!group.my_role) return res.status(400).json({ error: "Вы не участник группы" });
  if (group.my_role === "owner") {
    return res.status(400).json({ error: "Владелец не может выйти: удалите группу или передайте её другому", code: "owner_cannot_leave" });
  }
  db.prepare("DELETE FROM chat_group_members WHERE group_id = ? AND user_id = ?").run(group.id, req.userId);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Участники и роли
// ---------------------------------------------------------------------------

router.get("/:id/members", requireAuth, (req, res) => {
  const group = getGroupRow(req.params.id, req.user);
  if (!group) return res.status(404).json({ error: "Группа не найдена" });
  if (!canRead(group, req.user)) {
    return res.status(403).json({ error: "Нет доступа к участникам группы", code: "no_access" });
  }
  res.json({ members: membersOf(group.id).map(serializeGroupMember) });
});

router.post("/:id/members", requireAuth, (req, res) => {
  const group = getGroupRow(req.params.id, req.user);
  if (!group) return res.status(404).json({ error: "Группа не найдена" });
  if (!canModerate(group, req.user)) {
    return res.status(403).json({ error: "Добавлять участников могут владелец и модераторы" });
  }
  const username = String(req.body?.username || "").trim().replace(/^@/, "").toLowerCase();
  if (!username) return res.status(400).json({ error: "Укажите ник пользователя" });

  const target = db.prepare("SELECT * FROM users WHERE lower(username) = ?").get(username);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });

  const existing = memberRow(group.id, target.id);
  if (existing) {
    if (existing.banned) {
      db.prepare("UPDATE chat_group_members SET banned = 0 WHERE group_id = ? AND user_id = ?").run(group.id, target.id);
      return res.json({ members: membersOf(group.id).map(serializeGroupMember), unbanned: true });
    }
    return res.status(409).json({ error: "Этот пользователь уже участник" });
  }
  db.prepare(
    "INSERT INTO chat_group_members (group_id, user_id, role, banned, created_at) VALUES (?, ?, 'member', 0, ?)",
  ).run(group.id, target.id, new Date().toISOString());
  res.status(201).json({ members: membersOf(group.id).map(serializeGroupMember) });
});

router.delete("/:id/members/:userId", requireAuth, (req, res) => {
  const group = getGroupRow(req.params.id, req.user);
  if (!group) return res.status(404).json({ error: "Группа не найдена" });
  if (!canModerate(group, req.user)) {
    return res.status(403).json({ error: "Удалять участников могут владелец и модераторы" });
  }
  const target = memberRow(group.id, req.params.userId);
  if (!target) return res.status(404).json({ error: "Участник не найден" });
  if (target.role === "owner") return res.status(400).json({ error: "Владельца удалить нельзя" });
  // Модератор не может снять другого модератора или владельца.
  if (group.my_role === "moderator" && target.role === "moderator" && !req.user.is_admin) {
    return res.status(403).json({ error: "Модератор не может удалить другого модератора" });
  }
  db.prepare("DELETE FROM chat_group_members WHERE group_id = ? AND user_id = ?").run(group.id, target.user_id);
  res.json({ ok: true });
});

router.post("/:id/members/:userId/role", requireAuth, (req, res) => {
  const group = getGroupRow(req.params.id, req.user);
  if (!group) return res.status(404).json({ error: "Группа не найдена" });
  if (!canManage(group, req.user)) {
    return res.status(403).json({ error: "Назначать роли может только владелец" });
  }
  const role = req.body?.role;
  if (!["moderator", "member"].includes(role)) {
    return res.status(400).json({ error: "Роль: moderator или member" });
  }
  const target = memberRow(group.id, req.params.userId);
  if (!target) return res.status(404).json({ error: "Участник не найден" });
  if (target.role === "owner" || group.owner_id === target.user_id) {
    return res.status(400).json({ error: "Роль владельца изменить нельзя" });
  }
  db.prepare("UPDATE chat_group_members SET role = ? WHERE group_id = ? AND user_id = ?").run(
    role,
    group.id,
    target.user_id,
  );
  res.json({ members: membersOf(group.id).map(serializeGroupMember) });
});

router.post("/:id/members/:userId/ban", requireAuth, (req, res) => {
  const group = getGroupRow(req.params.id, req.user);
  if (!group) return res.status(404).json({ error: "Группа не найдена" });
  if (!canModerate(group, req.user)) {
    return res.status(403).json({ error: "Блокировать могут владелец и модераторы" });
  }
  const target = memberRow(group.id, req.params.userId);
  if (!target) return res.status(404).json({ error: "Участник не найден" });
  if (target.role === "owner" || group.owner_id === target.user_id) {
    return res.status(400).json({ error: "Владельца заблокировать нельзя" });
  }
  if (group.my_role === "moderator" && target.role === "moderator" && !req.user.is_admin) {
    return res.status(403).json({ error: "Модератор не может заблокировать другого модератора" });
  }
  db.prepare("UPDATE chat_group_members SET banned = 1 WHERE group_id = ? AND user_id = ?").run(
    group.id,
    target.user_id,
  );
  res.json({ members: membersOf(group.id).map(serializeGroupMember) });
});

router.post("/:id/members/:userId/unban", requireAuth, (req, res) => {
  const group = getGroupRow(req.params.id, req.user);
  if (!group) return res.status(404).json({ error: "Группа не найдена" });
  if (!canModerate(group, req.user)) {
    return res.status(403).json({ error: "Разблокировать могут владелец и модераторы" });
  }
  const target = memberRow(group.id, req.params.userId);
  if (!target) return res.status(404).json({ error: "Участник не найден" });
  db.prepare("UPDATE chat_group_members SET banned = 0 WHERE group_id = ? AND user_id = ?").run(
    group.id,
    target.user_id,
  );
  res.json({ members: membersOf(group.id).map(serializeGroupMember) });
});

// ---------------------------------------------------------------------------
// Сообщения группы
// ---------------------------------------------------------------------------

router.get("/:id/messages", requireAuth, (req, res) => {
  const group = getGroupRow(req.params.id, req.user);
  if (!group) return res.status(404).json({ error: "Группа не найдена" });
  if (!canRead(group, req.user)) {
    return res.status(403).json({ error: "Нет доступа к переписке группы", code: "no_access" });
  }
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const rows = db
    .prepare(
      `SELECT gm.*, u.username AS author_username, u.full_name AS author_full_name,
              u.avatar_url AS author_avatar_url, u.badge_level AS author_badge_level
       FROM chat_group_messages gm JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?
       ORDER BY gm.created_at ASC
       LIMIT ?`,
    )
    .all(group.id, limit);
  res.json({ messages: rows.map(serializeGroupMessage) });
});

router.post("/:id/messages", requireAuth, async (req, res) => {
  const group = getGroupRow(req.params.id, req.user);
  if (!group) return res.status(404).json({ error: "Группа не найдена" });
  if (!canRead(group, req.user)) {
    return res.status(403).json({ error: "Писать могут только участники группы", code: "no_access" });
  }
  if (banSystem.isBanned(req.userId)) {
    return res.status(403).json({ error: "Вы заблокированы", code: "banned" });
  }
  const { text, imageUrl } = req.body || {};
  if (!String(text || "").trim() && !imageUrl) {
    return res.status(400).json({ error: "Нужен текст или картинка" });
  }
  // Картинки группы — в Supabase Storage, если он настроен.
  const storedImage = await mediaStorage.storeMediaUrl(imageUrl, { folder: "groups" });
  const censorEnabled = isCensorEnabled();
  const censored = censorEnabled
    ? censorText(String(text || ""))
    : { text: String(text || ""), changed: false, matches: [] };

  const id = uid();
  db.prepare(
    "INSERT INTO chat_group_messages (id, group_id, user_id, text, image_url, censored, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    group.id,
    req.userId,
    encrypt(censored.text),
    storedImage || null,
    censored.changed ? 1 : 0,
    new Date().toISOString(),
  );

  // Автоматоры правил: мат, оскорбления, реклама и т.д. в сообщении группы.
  const violation = automators.applyAutomators({
    userId: req.userId,
    context: "group_message",
    text: String(text || ""),
    source: "group_message",
    sourceId: id,
    imageUrl: imageUrl || null,
  });

  if (violation?.removed) {
    return res.status(201).json({
      message: { id, removed: true },
      removed: true,
      ruleNumber: violation.rule.number,
      ruleTitle: violation.rule.title,
    });
  }

  const row = db
    .prepare(
      `SELECT gm.*, u.username AS author_username, u.full_name AS author_full_name,
              u.avatar_url AS author_avatar_url, u.badge_level AS author_badge_level
       FROM chat_group_messages gm JOIN users u ON u.id = gm.user_id WHERE gm.id = ?`,
    )
    .get(id);
  res.status(201).json({ message: serializeGroupMessage(row) });
});

router.delete("/:id/messages/:messageId", requireAuth, (req, res) => {
  const group = getGroupRow(req.params.id, req.user);
  if (!group) return res.status(404).json({ error: "Группа не найдена" });
  const message = db
    .prepare("SELECT * FROM chat_group_messages WHERE id = ? AND group_id = ?")
    .get(req.params.messageId, group.id);
  if (!message) return res.status(404).json({ error: "Сообщение не найдено" });
  const allowed = message.user_id === req.userId || canModerate(group, req.user);
  if (!allowed) return res.status(403).json({ error: "Нет доступа" });
  db.prepare("DELETE FROM chat_group_messages WHERE id = ?").run(message.id);
  if (group.pinned_message_id === message.id) {
    db.prepare("UPDATE chat_groups SET pinned_message_id = NULL WHERE id = ?").run(group.id);
  }
  res.json({ ok: true });
});

/** Закреплённое сообщение (владелец/модератор). */
router.put("/:id/pin", requireAuth, (req, res) => {
  const group = getGroupRow(req.params.id, req.user);
  if (!group) return res.status(404).json({ error: "Группа не найдена" });
  if (!canModerate(group, req.user)) {
    return res.status(403).json({ error: "Закреплять сообщения могут владелец и модераторы" });
  }
  const messageId = req.body?.messageId ?? null;
  if (messageId) {
    const message = db
      .prepare("SELECT id FROM chat_group_messages WHERE id = ? AND group_id = ?")
      .get(messageId, group.id);
    if (!message) return res.status(404).json({ error: "Сообщение не найдено" });
  }
  db.prepare("UPDATE chat_groups SET pinned_message_id = ? WHERE id = ?").run(messageId, group.id);
  res.json({ group: serializeWithViewer(getGroupRow(group.id, req.user), req.user) });
});

module.exports = router;
