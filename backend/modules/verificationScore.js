// Оценка заявки на верификацию (0–100 «процентов» доверия).
//
// Это не внешний AI и не случайное число: оценка считается по фактическим
// данным аккаунта из базы. Каждый фактор даёт вклад в общий процент, а
// расшифровка сохраняется рядом с оценкой, чтобы администратор видел, из чего
// она сложилась.

const db = require("../db");

const DAY_MS = 24 * 60 * 60 * 1000;

/** Веса факторов (в сумме 100). */
const WEIGHTS = {
  age: 20,
  posts: 20,
  comments: 10,
  profile: 20,
  reputation: 20,
  clean: 10,
};

function clampPoints(value, max) {
  return Math.max(0, Math.min(max, Math.round(value)));
}

function countRows(sql, params) {
  const row = db.prepare(sql).get(...params);
  return row ? row.c : 0;
}

/**
 * Считает оценку заявки.
 * @returns {{score: number, details: Array<{key: string, label: string, points: number, max: number, note: string}>}}
 */
function scoreAccount(userId) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return { score: 0, details: [] };

  const details = [];

  // 1. Возраст аккаунта: 2 балла за день, максимум 20 (10 дней).
  const created = new Date(user.created_at).getTime();
  const ageDays = Number.isFinite(created) ? Math.floor((Date.now() - created) / DAY_MS) : 0;
  const agePoints = clampPoints(ageDays * 2, WEIGHTS.age);
  details.push({
    key: "age",
    label: "Возраст аккаунта",
    points: agePoints,
    max: WEIGHTS.age,
    note: `${ageDays} дн. с регистрации`,
  });

  // 2. Публикации: 4 балла за пост, максимум 20 (5 постов).
  const posts = countRows("SELECT COUNT(*) AS c FROM posts WHERE user_id = ?", [userId]);
  const postPoints = clampPoints(posts * 4, WEIGHTS.posts);
  details.push({
    key: "posts",
    label: "Публикации",
    points: postPoints,
    max: WEIGHTS.posts,
    note: `${posts} пост(ов)`,
  });

  // 3. Комментарии: 1 балл за комментарий, максимум 10.
  const comments = countRows("SELECT COUNT(*) AS c FROM comments WHERE user_id = ?", [userId]);
  const commentPoints = clampPoints(comments, WEIGHTS.comments);
  details.push({
    key: "comments",
    label: "Комментарии",
    points: commentPoints,
    max: WEIGHTS.comments,
    note: `${comments} комментари(ев)`,
  });

  // 4. Заполненность профиля: 5 баллов за каждое поле.
  const filled = [
    { label: "Имя", ok: !!String(user.full_name || "").trim() },
    { label: "Описание", ok: String(user.bio || "").trim().length >= 20 },
    { label: "Аватар", ok: !!user.avatar_url },
    { label: "Обложка", ok: !!user.cover_url },
  ];
  const profilePoints = clampPoints(filled.filter((f) => f.ok).length * 5, WEIGHTS.profile);
  details.push({
    key: "profile",
    label: "Заполненность профиля",
    points: profilePoints,
    max: WEIGHTS.profile,
    note: filled.map((f) => `${f.ok ? "+" : "−"}${f.label}`).join(" "),
  });

  // 5. Репутация: пропорционально текущему рангу.
  const reputation = typeof user.reputation === "number" ? user.reputation : 100;
  const reputationPoints = clampPoints((reputation / 100) * WEIGHTS.reputation, WEIGHTS.reputation);
  details.push({
    key: "reputation",
    label: "Репутация",
    points: reputationPoints,
    max: WEIGHTS.reputation,
    note: `ранг ${reputation}/100`,
  });

  // 6. Чистая история: без варнов и без банов.
  const warnings = countRows("SELECT COUNT(*) AS c FROM warnings WHERE user_id = ?", [userId]);
  const bans = countRows("SELECT COUNT(*) AS c FROM bans WHERE user_id = ?", [userId]);
  const cleanPoints = clampPoints(
    (warnings === 0 ? WEIGHTS.clean / 2 : 0) + (bans === 0 ? WEIGHTS.clean / 2 : 0),
    WEIGHTS.clean,
  );
  details.push({
    key: "clean",
    label: "История нарушений",
    points: cleanPoints,
    max: WEIGHTS.clean,
    note: `варнов: ${warnings}, банов: ${bans}`,
  });

  const score = clampPoints(
    details.reduce((sum, item) => sum + item.points, 0),
    100,
  );
  return { score, details };
}

/** Считает и сохраняет оценку в заявке. */
function scoreVerificationRequest(requestId) {
  const request = db.prepare("SELECT * FROM verification_requests WHERE id = ?").get(requestId);
  if (!request) return null;

  const { score, details } = scoreAccount(request.user_id);
  db.prepare("UPDATE verification_requests SET ai_score = ?, ai_details = ? WHERE id = ?").run(
    score,
    JSON.stringify(details),
    requestId,
  );
  return { score, details };
}

/** Разбор сохранённой расшифровки (или пересчёт, если её нет). */
function getRequestScore(request) {
  if (!request) return null;
  if (typeof request.ai_score === "number") {
    let details = [];
    try {
      details = JSON.parse(request.ai_details || "[]");
    } catch {
      details = [];
    }
    return { score: request.ai_score, details };
  }
  return scoreAccount(request.user_id);
}

module.exports = { WEIGHTS, scoreAccount, scoreVerificationRequest, getRequestScore };
