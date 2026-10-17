// Единая точка удаления аккаунта с журналом.
//
// Используется администратором (панель) и ботом с подтверждённым входом.
// Удаление жёсткое: строка users уходит, связанные таблицы чистятся каскадом,
// но перед удалением снимается слепок и остаётся запись в deleted_accounts.

const db = require("../db");
const { uid } = require("../utils/uid");
const { logInfo } = require("../utils/logger");
const { deleteUploadedFile } = require("./banSystem");

function countRows(sql, ...params) {
  const row = db.prepare(sql).get(...params);
  return row ? row.c : 0;
}

/**
 * Удаляет аккаунт и пишет запись в журнал.
 * @param {{targetId: string, reason?: string|null, deletedBy?: string|null}} input
 */
function deleteAccount({ targetId, reason = null, deletedBy = null }) {
  const target = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId);
  if (!target) return { ok: false, status: 404, error: "Пользователь не найден" };
  if (target.is_admin) return { ok: false, status: 400, error: "Нельзя удалить администратора" };

  const snapshot = {
    posts: countRows("SELECT COUNT(*) AS c FROM posts WHERE user_id = ?", target.id),
    comments: countRows("SELECT COUNT(*) AS c FROM comments WHERE user_id = ?", target.id),
    messages: countRows(
      "SELECT COUNT(*) AS c FROM messages WHERE from_user_id = ? OR to_user_id = ?",
      target.id,
      target.id,
    ),
    channels: countRows("SELECT COUNT(*) AS c FROM channels WHERE owner_id = ?", target.id),
    warnings: countRows("SELECT COUNT(*) AS c FROM warnings WHERE user_id = ?", target.id),
    wasBanned: !!db.prepare("SELECT 1 FROM bans WHERE user_id = ?").get(target.id),
    badgeLevel: target.badge_level ?? 0,
    reputation: target.reputation ?? 100,
    createdAt: target.created_at,
  };

  // Локально загруженные файлы профиля больше не нужны.
  deleteUploadedFile(target.avatar_url);
  deleteUploadedFile(target.cover_url);

  db.prepare(
    `INSERT INTO deleted_accounts (id, user_id, username, reason, deleted_by, snapshot, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    uid(),
    target.id,
    target.username,
    reason ? String(reason).slice(0, 500) : null,
    deletedBy,
    JSON.stringify(snapshot),
    new Date().toISOString(),
  );

  // Одна строка — и каскад чистит всё остальное.
  db.prepare("DELETE FROM users WHERE id = ?").run(target.id);

  logInfo("Аккаунт удалён", {
    userId: target.id,
    username: target.username,
    by: deletedBy,
    reason: reason || null,
    snapshot,
  });

  return { ok: true, deleted: { id: target.id, username: target.username, snapshot } };
}

module.exports = { deleteAccount };