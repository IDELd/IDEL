// Достижения профиля.
//
// Уникальная механика ИДЕЛЬ: достижения не выдаются вручную, а автоматически
// открываются по фактическим данным аккаунта (посты, комментарии, лайки,
// друзья, подписчики, галочка, подписка, боты, группы, ночная активность,
// серия дней). У каждого достижения есть цель и прогресс — в интерфейсе видно,
// сколько осталось. За открытые достижения начисляются баллы ИДЕЛЬ.
//
// Открытие фиксируется в user_achievements (unlocked_at), поэтому «ночная
// сова» остаётся даже если пост удалить.

const db = require("../db");
const { logInfo } = require("../utils/logger");
const premium = require("./premium");

/**
 * Определения достижений. metric — что считаем, target — сколько нужно.
 * Формула прогресса описана в METRICS ниже.
 */
const DEFINITIONS = [
  { code: "first_post", title: "Первый шаг", description: "Опубликовать первый пост", category: "activity", metric: "posts", target: 1, points: 10 },
  { code: "posts_10", title: "Автор", description: "Опубликовать 10 постов", category: "activity", metric: "posts", target: 10, points: 25 },
  { code: "posts_50", title: "Летописец", description: "Опубликовать 50 постов", category: "activity", metric: "posts", target: 50, points: 100 },
  { code: "comments_10", title: "Собеседник", description: "Написать 10 комментариев", category: "activity", metric: "comments", target: 10, points: 25 },
  { code: "likes_100", title: "Любимец публики", description: "Получить 100 лайков на свои посты", category: "popularity", metric: "likesReceived", target: 100, points: 50 },
  { code: "popular_post", title: "Вирусный пост", description: "Получить 25 лайков на один пост", category: "popularity", metric: "maxPostLikes", target: 25, points: 75 },
  { code: "followers_10", title: "Интересный человек", description: "Набрать 10 подписчиков", category: "popularity", metric: "followers", target: 10, points: 50 },
  { code: "friends_5", title: "Дружелюбный", description: "Добавить 5 друзей", category: "social", metric: "friends", target: 5, points: 30 },
  { code: "verified", title: "С галочкой", description: "Получить верификацию аккаунта", category: "status", metric: "badgeLevel", target: 1, points: 100 },
  { code: "premium", title: "ИДЕЛЬ ПРЕМИУМ", description: "Активировать подписку ПРЕМИУМ", category: "status", metric: "premium", target: 1, points: 100 },
  { code: "bot_creator", title: "Создатель ботов", description: "Создать своего первого бота", category: "developers", metric: "bots", target: 1, points: 75 },
  { code: "group_owner", title: "Организатор", description: "Создать группу", category: "social", metric: "groupsOwned", target: 1, points: 40 },
  { code: "night_owl", title: "Ночная сова", description: "Опубликовать пост между полуночью и 6 утра", category: "fun", metric: "nightPosts", target: 1, points: 20 },
  { code: "streak_7", title: "Серия из 7 дней", description: "Быть активным 7 дней подряд", category: "activity", metric: "streakDays", target: 7, points: 90 },
  { code: "clean_rank", title: "Безупречная репутация", description: "Ранг 100 при пяти и более постах", category: "status", metric: "cleanRank", target: 1, points: 60 },
];

const DEFINITION_BY_CODE = Object.fromEntries(DEFINITIONS.map((d) => [d.code, d]));

/** Пишет справочник достижений в БД (INSERT OR IGNORE — правки не перетираются). */
function ensureSeed() {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO achievements (code, title, description, category, target, points) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const item of DEFINITIONS) {
    insert.run(item.code, item.title, item.description, item.category, item.target, item.points);
  }
}

function countRows(sql, ...params) {
  const row = db.prepare(sql).get(...params);
  return row ? row.c : 0;
}

/** Серия подряд идущих дней активности (посты + комментарии), максимум 400 дней. */
function computeStreak(userId) {
  const rows = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day FROM posts WHERE user_id = ?
       UNION
       SELECT substr(created_at, 1, 10) AS day FROM comments WHERE user_id = ?`,
    )
    .all(userId, userId);
  const days = new Set(rows.map((row) => row.day));
  let streak = 0;
  const cursor = new Date();
  for (let i = 0; i < 400; i += 1) {
    const key = cursor.toISOString().slice(0, 10);
    if (days.has(key)) {
      streak += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    } else if (i === 0) {
      // Сегодня ещё может не быть активности — серия считается со вчера.
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

/** Текущие значения всех метрик пользователя. */
function metricsFor(userId, user) {
  const posts = countRows("SELECT COUNT(*) AS c FROM posts WHERE user_id = ?", userId);
  const comments = countRows("SELECT COUNT(*) AS c FROM comments WHERE user_id = ?", userId);
  const likesReceived = countRows(
    "SELECT COUNT(*) AS c FROM likes l JOIN posts p ON p.id = l.post_id WHERE p.user_id = ?",
    userId,
  );
  const maxPostLikesRow = db
    .prepare(
      `SELECT MAX(cnt) AS m FROM (
         SELECT COUNT(*) AS cnt FROM likes l JOIN posts p ON p.id = l.post_id
         WHERE p.user_id = ? GROUP BY p.id
       )`,
    )
    .get(userId);
  const followers = countRows("SELECT COUNT(*) AS c FROM follows WHERE following_id = ?", userId);
  const friends = countRows(
    `SELECT COUNT(*) AS c FROM friend_requests
     WHERE status = 'accepted' AND (from_user_id = ? OR to_user_id = ?)`,
    userId,
    userId,
  );
  const bots = countRows("SELECT COUNT(*) AS c FROM bots WHERE user_id = ?", userId);
  const groupsOwned = countRows("SELECT COUNT(*) AS c FROM chat_groups WHERE owner_id = ?", userId);
  const nightPosts = countRows(
    `SELECT COUNT(*) AS c FROM posts
     WHERE user_id = ? AND CAST(substr(created_at, 12, 2) AS INTEGER) < 6`,
    userId,
  );
  const cleanRank = (user.reputation ?? 100) >= 100 && posts >= 5 ? 1 : 0;

  return {
    posts,
    comments,
    likesReceived,
    maxPostLikes: maxPostLikesRow?.m || 0,
    followers,
    friends,
    badgeLevel: user.badge_level ?? 0,
    premium: premium.isPremium(user) ? 1 : 0,
    bots,
    groupsOwned,
    nightPosts,
    streakDays: computeStreak(userId),
    cleanRank,
  };
}

function unlockedMap(userId) {
  const rows = db.prepare("SELECT code, unlocked_at FROM user_achievements WHERE user_id = ?").all(userId);
  return new Map(rows.map((row) => [row.code, row.unlocked_at]));
}

/**
 * Открывает достижения, условия которых выполнены. Возвращает новые коды.
 */
function syncUser(userId) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user || user.is_bot) return [];
  const values = metricsFor(userId, user);
  const unlocked = unlockedMap(userId);
  const fresh = [];
  const now = new Date().toISOString();
  const insert = db.prepare(
    "INSERT OR IGNORE INTO user_achievements (user_id, code, unlocked_at) VALUES (?, ?, ?)",
  );
  for (const definition of DEFINITIONS) {
    if (unlocked.has(definition.code)) continue;
    const value = values[definition.metric] ?? 0;
    if (value >= definition.target) {
      const result = insert.run(userId, definition.code, now);
      if (result.changes > 0) fresh.push(definition.code);
    }
  }
  if (fresh.length > 0) {
    logInfo("Открыты достижения", { userId, username: user.username, codes: fresh });
  }
  return fresh;
}

/** Полный список достижений с прогрессом для пользователя. */
function listForUser(userId) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return null;
  syncUser(userId);
  const values = metricsFor(userId, user);
  const unlocked = unlockedMap(userId);
  const achievements = DEFINITIONS.map((definition) => {
    const value = values[definition.metric] ?? 0;
    return {
      code: definition.code,
      title: definition.title,
      description: definition.description,
      category: definition.category,
      target: definition.target,
      points: definition.points,
      progress: Math.min(value, definition.target),
      unlocked: unlocked.has(definition.code),
      unlockedAt: unlocked.get(definition.code) || null,
    };
  });
  const unlockedAchievements = achievements.filter((item) => item.unlocked);
  return {
    achievements,
    unlocked: unlockedAchievements.length,
    total: achievements.length,
    points: unlockedAchievements.reduce((sum, item) => sum + item.points, 0),
  };
}

module.exports = {
  DEFINITIONS,
  DEFINITION_BY_CODE,
  ensureSeed,
  metricsFor,
  syncUser,
  listForUser,
};