const express = require("express");
const db = require("../db");
const { uid } = require("../utils/uid");
const { censorText } = require("../utils/censor");
const { requireAuth, optionalAuth, requireAdmin } = require("../middleware/auth");
const { serializeChannel, serializeChannelPost, serializeChannelMember } = require("../utils/serialize");
const banSystem = require("../modules/banSystem");
const automators = require("../modules/ruleAutomators");
const mediaStorage = require("../modules/mediaStorage");
const { setBadgeLevel } = require("../modules/badges");

const router = express.Router();

const VISIBILITIES = ["public", "private"];
const POST_POLICIES = ["owner", "members", "anyone"];

function isCensorEnabled() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'censorEnabled'").get();
  return !row || row.value === "1";
}

/** Канал вместе с флагом членства текущего зрителя. */
function getChannelRow(id, viewer) {
  const row = db
    .prepare(
      `SELECT c.*,
        EXISTS(SELECT 1 FROM channel_members m WHERE m.channel_id = c.id AND m.user_id = ?) AS is_member
       FROM channels c WHERE c.id = ?`,
    )
    .get(viewer?.id || "", id);
  return row || null;
}

function getChannelRowByName(name) {
  return db.prepare("SELECT * FROM channels WHERE lower(name) = ?").get(String(name).toLowerCase()) || null;
}

/** Виден ли канал зрителю: публичные — всем, приватные — владельцу, участникам и админу. */
function canSee(channel, viewer) {
  if (!channel) return false;
  if ((channel.visibility || "public") !== "private") return true;
  if (!viewer) return false;
  return !!viewer.is_admin || channel.owner_id === viewer.id || !!channel.is_member;
}

function isMember(channelId, userId) {
  return !!db
    .prepare("SELECT 1 FROM channel_members WHERE channel_id = ? AND user_id = ?")
    .get(channelId, userId);
}

/** Право публикации с учётом post_policy, владельца, админа и блокировки. */
function canPost(channel, viewer) {
  if (!channel || !viewer) return false;
  if (banSystem.isBanned(viewer.id)) return false;
  if (viewer.is_admin || channel.owner_id === viewer.id) return true;
  const policy = channel.post_policy || "owner";
  if (policy === "anyone") return true;
  if (policy === "members") return isMember(channel.id, viewer.id);
  return false;
}

/** Сериализация с контекстом зрителя (isOwner/isMember/canPost). */
function serialize(channel, viewer) {
  if (!channel) return null;
  channel.viewer_banned = viewer && banSystem.isBanned(viewer.id) ? 1 : 0;
  return serializeChannel(channel, viewer);
}

router.get("/", optionalAuth, (req, res) => {
  const viewer = req.user || null;
  const rows = db
    .prepare(
      `SELECT c.*,
        EXISTS(SELECT 1 FROM channel_members m WHERE m.channel_id = c.id AND m.user_id = ?) AS is_member
       FROM channels c ORDER BY c.created_at DESC`,
    )
    .all(viewer?.id || "");
  const visible = rows.filter((row) => canSee(row, viewer));
  res.json({ channels: visible.map((row) => serialize(row, viewer)) });
});

router.post("/", requireAuth, (req, res) => {
  const { name, description, visibility, postPolicy } = req.body || {};
  if (banSystem.isBanned(req.userId)) {
    return res.status(403).json({ error: "Вы заблокированы и не можете создавать каналы", code: "banned" });
  }
  if (!String(name || "").trim()) return res.status(400).json({ error: "Введите название канала" });

  const desiredVisibility = VISIBILITIES.includes(visibility) ? visibility : "public";
  const desiredPolicy = POST_POLICIES.includes(postPolicy) ? postPolicy : "owner";
  const id = uid();
  db.prepare(
    `INSERT INTO channels (id, name, description, owner_id, visibility, post_policy, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    String(name).trim(),
    String(description || "").trim(),
    req.userId,
    desiredVisibility,
    desiredPolicy,
    new Date().toISOString(),
  );
  const row = getChannelRow(id, req.user);
  res.status(201).json({ channel: serialize(row, req.user) });
});

router.get("/:id", optionalAuth, (req, res) => {
  const viewer = req.user || null;
  const channel = getChannelRow(req.params.id, viewer);
  if (!channel) return res.status(404).json({ error: "Канал не найден" });
  if (!canSee(channel, viewer)) {
    return res.status(403).json({ error: "Канал приватный", code: "private_channel" });
  }
  const posts = db
    .prepare("SELECT * FROM channel_posts WHERE channel_id = ? ORDER BY created_at DESC")
    .all(req.params.id);
  res.json({ channel: serialize(channel, viewer), posts: posts.map(serializeChannelPost) });
});

/** Настройки канала: владелец или администратор. */
router.put("/:id", requireAuth, (req, res) => {
  const channel = getChannelRow(req.params.id, req.user);
  if (!channel) return res.status(404).json({ error: "Канал не найден" });
  if (channel.owner_id !== req.userId && !req.user.is_admin) {
    return res.status(403).json({ error: "Только владелец может менять настройки канала" });
  }

  const { name, description, visibility, postPolicy } = req.body || {};
  const nextName = name === undefined ? channel.name : String(name).trim();
  if (!nextName) return res.status(400).json({ error: "Название не может быть пустым" });
  const nextVisibility = visibility === undefined ? channel.visibility : visibility;
  if (!VISIBILITIES.includes(nextVisibility)) {
    return res.status(400).json({ error: "Приватность: public или private" });
  }
  const nextPolicy = postPolicy === undefined ? channel.post_policy : postPolicy;
  if (!POST_POLICIES.includes(nextPolicy)) {
    return res.status(400).json({ error: "Право публикации: owner, members или anyone" });
  }

  db.prepare(
    "UPDATE channels SET name = ?, description = ?, visibility = ?, post_policy = ? WHERE id = ?",
  ).run(
    nextName,
    description === undefined ? channel.description : String(description || "").trim(),
    nextVisibility,
    nextPolicy,
    channel.id,
  );
  const fresh = getChannelRow(channel.id, req.user);
  res.json({ channel: serialize(fresh, req.user) });
});

/** Участники канала: владелец или администратор. */
router.get("/:id/members", requireAuth, (req, res) => {
  const channel = getChannelRow(req.params.id, req.user);
  if (!channel) return res.status(404).json({ error: "Канал не найден" });
  if (channel.owner_id !== req.userId && !req.user.is_admin) {
    return res.status(403).json({ error: "Участников видит только владелец" });
  }
  const rows = db
    .prepare(
      `SELECT m.*, u.username, u.full_name, u.avatar_url, u.badge_level
       FROM channel_members m JOIN users u ON u.id = m.user_id
       WHERE m.channel_id = ? ORDER BY m.created_at ASC`,
    )
    .all(channel.id);
  res.json({ members: rows.map(serializeChannelMember) });
});

router.post("/:id/members", requireAuth, (req, res) => {
  const channel = getChannelRow(req.params.id, req.user);
  if (!channel) return res.status(404).json({ error: "Канал не найден" });
  if (channel.owner_id !== req.userId && !req.user.is_admin) {
    return res.status(403).json({ error: "Добавлять участников может только владелец" });
  }

  const username = String(req.body?.username || "").trim().replace(/^@/, "").toLowerCase();
  if (!username) return res.status(400).json({ error: "Укажите ник пользователя" });

  const target = db.prepare("SELECT * FROM users WHERE lower(username) = ?").get(username);
  if (!target) return res.status(404).json({ error: "Пользователь не найден" });
  if (target.id === channel.owner_id) {
    return res.status(400).json({ error: "Владелец уже может писать в канал" });
  }
  if (isMember(channel.id, target.id)) {
    return res.status(409).json({ error: "Этот пользователь уже участник" });
  }

  db.prepare(
    "INSERT INTO channel_members (channel_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)",
  ).run(channel.id, target.id, new Date().toISOString());

  const rows = db
    .prepare(
      `SELECT m.*, u.username, u.full_name, u.avatar_url, u.badge_level
       FROM channel_members m JOIN users u ON u.id = m.user_id
       WHERE m.channel_id = ? ORDER BY m.created_at ASC`,
    )
    .all(channel.id);
  res.status(201).json({ members: rows.map(serializeChannelMember) });
});

router.delete("/:id/members/:userId", requireAuth, (req, res) => {
  const channel = getChannelRow(req.params.id, req.user);
  if (!channel) return res.status(404).json({ error: "Канал не найден" });
  if (channel.owner_id !== req.userId && !req.user.is_admin) {
    return res.status(403).json({ error: "Удалять участников может только владелец" });
  }
  const result = db
    .prepare("DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?")
    .run(channel.id, req.params.userId);
  if (result.changes === 0) return res.status(404).json({ error: "Участник не найден" });
  res.json({ ok: true });
});

router.post("/:id/posts", requireAuth, async (req, res) => {
  const channel = getChannelRow(req.params.id, req.user);
  if (!channel) return res.status(404).json({ error: "Канал не найден" });
  if (banSystem.isBanned(req.userId)) {
    return res.status(403).json({ error: "Вы заблокированы и не можете публиковать в канале", code: "banned" });
  }
  if (!canPost(channel, req.user)) {
    const policy = channel.post_policy || "owner";
    const error =
      policy === "members"
        ? "Публиковать в этом канале могут только участники"
        : "Публиковать в этом канале может только владелец";
    return res.status(403).json({ error, code: "post_forbidden" });
  }

  const { content, imageUrl, drawingUrl } = req.body || {};
  if (!String(content || "").trim() && !imageUrl && !drawingUrl) {
    return res.status(400).json({ error: "Введите текст или приложите файл" });
  }
  // Медиа канала — в Supabase Storage, если он настроен.
  const storedImage = await mediaStorage.storeMediaUrl(imageUrl, { folder: "channels" });
  const storedDrawing = await mediaStorage.storeMediaUrl(drawingUrl, { folder: "channels" });
  const censorEnabled = isCensorEnabled();
  const { text, changed, matches } = censorEnabled
    ? censorText(String(content || ""))
    : { text: String(content || ""), changed: false, matches: [] };

  const id = uid();
  db.prepare(
    `INSERT INTO channel_posts (id, channel_id, user_id, content, image_url, drawing_url, censored, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, req.params.id, req.userId, text.trim(), storedImage || null, storedDrawing || null, changed ? 1 : 0, new Date().toISOString());

  // Автоматоры правил: мат, оскорбления, реклама, спам-ссылки в посте канала.
  const violation = automators.applyAutomators({
    userId: req.userId,
    context: "channel_post",
    text: String(content || ""),
    source: "channel_post",
    sourceId: id,
    imageUrl: imageUrl || null,
  });

  if (violation?.removed) {
    return res.status(201).json({
      post: { id, removed: true },
      removed: true,
      ruleNumber: violation.rule.number,
      ruleTitle: violation.rule.title,
    });
  }

  const row = db.prepare("SELECT * FROM channel_posts WHERE id = ?").get(id);
  res.status(201).json({ post: serializeChannelPost(row) });
});

// Уровень галочки канала (0–3). Выдаёт только администратор.
router.put("/:id/badge", requireAuth, requireAdmin, (req, res) => {
  const result = setBadgeLevel({
    targetType: "channel",
    targetId: req.params.id,
    level: req.body?.level,
    by: req.userId,
  });
  if (!result.ok) return res.status(400).json({ error: result.error, code: result.code });
  const channel = getChannelRow(req.params.id, req.user);
  res.json({ badge: result, channel: serialize(channel, req.user) });
});

router.delete("/posts/:id", requireAuth, (req, res) => {
  const post = db.prepare("SELECT * FROM channel_posts WHERE id = ?").get(req.params.id);
  if (!post) return res.status(404).json({ error: "Пост не найден" });
  const channel = db.prepare("SELECT * FROM channels WHERE id = ?").get(post.channel_id);
  const canDelete = post.user_id === req.userId || channel?.owner_id === req.userId || req.user.is_admin;
  if (!canDelete) return res.status(403).json({ error: "Нет доступа" });
  db.prepare("DELETE FROM channel_posts WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
