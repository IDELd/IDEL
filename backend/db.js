const path = require("path");
const Database = require("better-sqlite3");
const { uid } = require("./utils/uid");

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, "database.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  cover_url TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0,
  is_bot INTEGER NOT NULL DEFAULT 0,
  aktiviki INTEGER NOT NULL DEFAULT 0,
  confirmed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Username may never be changed via a raw UPDATE that touches the column
-- directly with a different value from outside the API's own controlled
-- changeUsername path is still allowed (the API is the gatekeeper); this
-- trigger blocks accidental/careless updates that slip the username through
-- an UPDATE ... SET * pattern without going through the dedicated flow flag.
CREATE TRIGGER IF NOT EXISTS trg_users_username_immutable_guard
BEFORE UPDATE OF username ON users
WHEN OLD.username = NEW.username
BEGIN
  SELECT RAISE(IGNORE);
END;

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  drawing_url TEXT,
  video_url TEXT,
  video_thumbnail_url TEXT,
  video_duration REAL,
  censored INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT,
  voice_url TEXT,
  duration REAL,
  censored INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);

CREATE TABLE IF NOT EXISTS likes (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);

CREATE TABLE IF NOT EXISTS follows (
  id TEXT PRIMARY KEY,
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(follower_id, following_id)
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- public — виден всем, private — только владельцу и участникам.
  visibility TEXT NOT NULL DEFAULT 'public',
  -- Кто может публиковать: owner — только владелец, members — участники,
  -- anyone — любой авторизованный пользователь.
  post_policy TEXT NOT NULL DEFAULT 'owner',
  created_at TEXT NOT NULL
);

-- Участники канала: добавляет владелец по нику. Членство даёт право
-- публиковать (при post_policy = 'members') и доступ к приватному каналу.
CREATE TABLE IF NOT EXISTS channel_members (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_members_user ON channel_members(user_id);

-- Группы: общий чат на много участников (public — можно вступить, private —
-- только по добавлению владельцем/модератором).
CREATE TABLE IF NOT EXISTS chat_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  visibility TEXT NOT NULL DEFAULT 'public',
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pinned_message_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_group_members (
  group_id TEXT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- owner — владелец (один), moderator — модератор, member — участник.
  role TEXT NOT NULL DEFAULT 'member',
  banned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_group_members_user ON chat_group_members(user_id);

CREATE TABLE IF NOT EXISTS chat_group_messages (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  censored INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_group_messages_group ON chat_group_messages(group_id, created_at);

CREATE TABLE IF NOT EXISTS channel_posts (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  drawing_url TEXT,
  censored INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_channel_posts_channel ON channel_posts(channel_id);

CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);

CREATE TABLE IF NOT EXISTS verification_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  banned_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS confirmations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL
);

-- Токены сброса пароля: в БД лежит только sha256-хеш токена из письма.
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  theme TEXT,
  questions TEXT NOT NULL DEFAULT '[]',
  reward INTEGER NOT NULL DEFAULT 0,
  participation_reward INTEGER NOT NULL DEFAULT 0,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  finalized INTEGER NOT NULL DEFAULT 0,
  winner_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_submissions (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drawing_url TEXT,
  answers TEXT,
  score INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(event_id, user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// ---------------------------------------------------------------------------
// Таблицы, добавленные системой варнов/галочек/банов/сессий/правил.
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS warnings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  -- Категория нарушения: nickname | profanity | spam | toxicity | other.
  -- Нужна, чтобы @restorebot отличал мат от остальных нарушений.
  category TEXT NOT NULL DEFAULT 'other',
  -- NULL = варн выдан автоматически системой.
  issued_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Пункт правил, который нарушен (см. таблицу rules).
  rule_number INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_warnings_user ON warnings(user_id);

-- Журнал токсичных фрагментов: источник для авто-бана «>20 за 7 дней».
CREATE TABLE IF NOT EXISTS toxic_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,          -- message | post | comment
  source_id TEXT,
  matched TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_toxic_user_created ON toxic_messages(user_id, created_at);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip TEXT,                       -- зашифровано (AES-256-GCM)
  user_agent TEXT,               -- зашифровано (AES-256-GCM)
  created_at TEXT NOT NULL,
  last_active TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);

CREATE TABLE IF NOT EXISTS appeals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ban_reason TEXT,
  appeal_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  decision_comment TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status);

CREATE TABLE IF NOT EXISTS forbidden_words (
  id TEXT PRIMARY KEY,
  word TEXT NOT NULL UNIQUE,
  category TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  -- Автоматор правила: ключ детектора из modules/ruleAutomators.js.
  -- NULL — правило без автомата, рассматривается только вручную.
  detector TEXT,
  -- JSON: {contexts: [...], links: 3, minHits: 2, limit: 5, minutes: 10, ...}
  detector_config TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  -- Что делает автоматор при срабатывании: warn (варн) или ban (сразу бан).
  action TEXT NOT NULL DEFAULT 'warn',
  ban_days INTEGER,
  -- Удалять нарушающий контент (пост/комментарий/сообщение) при срабатывании.
  delete_content INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Журнал админских удалений аккаунтов: сам аккаунт удаляется каскадом, но
-- запись о том, кого и за что удалили, остаётся.
CREATE TABLE IF NOT EXISTS deleted_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  reason TEXT,
  deleted_by TEXT,
  snapshot TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deleted_accounts_created ON deleted_accounts(created_at);

-- ---------------------------------------------------------------------------
-- Платформа ботов (@creatorbot).
-- ---------------------------------------------------------------------------

-- Зарегистрированный бот: владелец, аккаунт бота и API-токен.
-- Токен хранится зашифрованным (чтобы владелец мог посмотреть его снова) и
-- дополнительно в виде sha256-хеша — по нему идёт поиск при авторизации.
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bot_user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_enc TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bots_user ON bots(user_id);

-- Удаление владельца (или самого бота) не должно оставлять висящий аккаунт
-- бота: строка bots удаляется каскадом, а этот триггер убирает и её users.
CREATE TRIGGER IF NOT EXISTS trg_bots_cleanup_user
AFTER DELETE ON bots
BEGIN
  DELETE FROM users WHERE id = OLD.bot_user_id;
END;

-- Очередь событий для long-polling: бот забирает их через GET /api/bot/updates.
CREATE TABLE IF NOT EXISTS bot_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_updates_bot ON bot_updates(bot_id, id);

-- Своё хранилище бота (ключ-значение), чтобы он помнил состояние между запусками.
CREATE TABLE IF NOT EXISTS bot_kv (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (bot_id, key)
);

-- Состояние диалога с @creatorbot (по шагам: имя → описание → аватар и т.п.).
CREATE TABLE IF NOT EXISTS bot_dialogs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  payload TEXT,
  updated_at TEXT NOT NULL
);

-- Запросы ботов на вход в профиль пользователя с подтверждением кодом.
-- Код приходит пользователю от @resendcode_bot (почта — позже), после чего
-- бот подтверждает его и получает временное разрешение (grant) на действия.
CREATE TABLE IF NOT EXISTS bot_auth_requests (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  capabilities TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  session_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  confirmed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bot_auth_bot ON bot_auth_requests(bot_id, status);
CREATE INDEX IF NOT EXISTS idx_bot_auth_user ON bot_auth_requests(user_id, status);

-- Состояние опроса верификации бота в @verifybot.
CREATE TABLE IF NOT EXISTS verify_dialogs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  verification_id TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 0,
  answers TEXT,
  updated_at TEXT NOT NULL
);

-- Достижения: справочник открытий и прогресс пользователей.
CREATE TABLE IF NOT EXISTS achievements (
  code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'activity',
  target INTEGER NOT NULL DEFAULT 1,
  points INTEGER NOT NULL DEFAULT 10
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL REFERENCES achievements(code) ON DELETE CASCADE,
  unlocked_at TEXT NOT NULL,
  PRIMARY KEY (user_id, code)
);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id);
`);

// ---------------------------------------------------------------------------
// Идемпотентная миграция уже существующей database.db: CREATE TABLE IF NOT
// EXISTS новые колонки не добавляет, поэтому досыпаем их через ALTER TABLE.
// Имена таблиц/колонок здесь — константы кода, не пользовательский ввод.
// ---------------------------------------------------------------------------
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((c) => c.name === column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

function migrateSchema() {
  const added = [];

  // Поля пользователя: галочка, репутация, ограничения, данные бана.
  if (ensureColumn("users", "badge_level", "INTEGER NOT NULL DEFAULT 0")) added.push("users.badge_level");
  if (ensureColumn("users", "reputation", "INTEGER NOT NULL DEFAULT 100")) added.push("users.reputation");
  if (ensureColumn("users", "restrictions", "TEXT")) added.push("users.restrictions");
  if (ensureColumn("users", "ban_rule_number", "INTEGER")) added.push("users.ban_rule_number");
  if (ensureColumn("users", "ban_reason", "TEXT")) added.push("users.ban_reason");
  if (ensureColumn("users", "serious_banned", "INTEGER NOT NULL DEFAULT 0")) added.push("users.serious_banned");
  if (ensureColumn("users", "last_violation_at", "TEXT")) added.push("users.last_violation_at");
  if (ensureColumn("users", "last_reputation_tick", "TEXT")) added.push("users.last_reputation_tick");

  // Галочки есть не только у пользователей, но и у каналов.
  if (ensureColumn("channels", "badge_level", "INTEGER NOT NULL DEFAULT 0")) added.push("channels.badge_level");

  // Приватность каналов и право публикации.
  if (ensureColumn("channels", "visibility", "TEXT NOT NULL DEFAULT 'public'")) added.push("channels.visibility");
  if (ensureColumn("channels", "post_policy", "TEXT NOT NULL DEFAULT 'owner'")) added.push("channels.post_policy");

  // Расширенная система банов.
  if (ensureColumn("bans", "mode", "TEXT NOT NULL DEFAULT 'normal'")) added.push("bans.mode");
  if (ensureColumn("bans", "rule_number", "INTEGER")) added.push("bans.rule_number");
  if (ensureColumn("bans", "expires_at", "TEXT")) added.push("bans.expires_at");
  if (ensureColumn("bans", "is_auto", "INTEGER NOT NULL DEFAULT 0")) added.push("bans.is_auto");

  // AI-оценка заявок на верификацию.
  if (ensureColumn("verification_requests", "ai_score", "INTEGER")) added.push("verification_requests.ai_score");
  if (ensureColumn("verification_requests", "ai_details", "TEXT")) added.push("verification_requests.ai_details");

  // Пункт правил у варна.
  if (ensureColumn("warnings", "category", "TEXT NOT NULL DEFAULT 'other'")) added.push("warnings.category");
  if (ensureColumn("warnings", "rule_number", "INTEGER")) added.push("warnings.rule_number");

  // Почта пользователя: нужна для запросов ботов на вход (коды пока идут в
  // @resendcode_bot, доставка на почту появится позже).
  if (ensureColumn("users", "email", "TEXT")) added.push("users.email");

  // Вебхуки ботов: URL, на который сервер POSTит события, и секрет HMAC-подписи.
  if (ensureColumn("bots", "webhook_url", "TEXT")) added.push("bots.webhook_url");
  if (ensureColumn("bots", "webhook_secret", "TEXT")) added.push("bots.webhook_secret");

  // Автоматоры правил: детектор, настройки, вкл/выкл и действие.
  if (ensureColumn("rules", "detector", "TEXT")) added.push("rules.detector");
  if (ensureColumn("rules", "detector_config", "TEXT")) added.push("rules.detector_config");
  if (ensureColumn("rules", "enabled", "INTEGER NOT NULL DEFAULT 1")) added.push("rules.enabled");
  if (ensureColumn("rules", "action", "TEXT NOT NULL DEFAULT 'warn'")) added.push("rules.action");
  if (ensureColumn("rules", "ban_days", "INTEGER")) added.push("rules.ban_days");
  if (ensureColumn("rules", "delete_content", "INTEGER NOT NULL DEFAULT 0")) {
    added.push("rules.delete_content");
    // Разовая миграция: у правил, которые ищут нарушение в контенте, включаем
    // удаление нарушающего поста/комментария/сообщения.
    db.prepare(
      `UPDATE rules SET delete_content = 1
       WHERE detector IS NOT NULL AND (
         detector_config LIKE '%"post"%' OR detector_config LIKE '%"comment"%' OR
         detector_config LIKE '%"message"%' OR detector_config LIKE '%"channel_post"%' OR
         detector_config LIKE '%"group_message"%'
       )`,
    ).run();
  }

  // ИДЕЛЬ ПРЕМИУМ: срок подписки, использование разового триала, цвет сообщений.
  if (ensureColumn("users", "premium_until", "TEXT")) added.push("users.premium_until");
  if (ensureColumn("users", "premium_trial_used", "INTEGER NOT NULL DEFAULT 0")) added.push("users.premium_trial_used");
  if (ensureColumn("users", "message_color", "TEXT")) added.push("users.message_color");

  // Расшифровка голосового комментария (распознаётся в браузере при записи).
  if (ensureColumn("comments", "transcript", "TEXT")) added.push("comments.transcript");

  // Картинка в личных сообщениях (нужна, в частности, для аватара бота).
  if (ensureColumn("messages", "image_url", "TEXT")) added.push("messages.image_url");

  // Существующие verified-аккаунты получают синюю галочку (уровень 3),
  // чтобы текущее поведение интерфейса не изменилось.
  db.prepare("UPDATE users SET badge_level = 3 WHERE verified = 1 AND badge_level = 0").run();
  db.prepare("UPDATE users SET last_reputation_tick = created_at WHERE last_reputation_tick IS NULL").run();
  db.prepare("UPDATE users SET reputation = 100 WHERE reputation IS NULL").run();
  db.prepare("UPDATE users SET restrictions = '{}' WHERE restrictions IS NULL").run();

  return added;
}

try {
  const added = migrateSchema();
  if (added.length > 0) {
    console.log(`[db] Миграция схемы: добавлено колонок — ${added.length} (${added.join(", ")})`);
  }
} catch (error) {
  // Существующая база со сломанной схемой — это критично, работать нельзя.
  require("./utils/logger").logCritical("Не удалось выполнить миграцию схемы БД", error);
  throw error;
}

// ---------------------------------------------------------------------------
// Стартовые данные: запрещённые слова для фильтра ников и правила соцсети.
// INSERT OR IGNORE — чтобы повторный запуск не дублировал и не перетирал
// правки, сделанные администратором через панель.
// ---------------------------------------------------------------------------
const FORBIDDEN_WORDS_SEED = [
  ["official", "official"],
  ["ukraine", "country"],
  ["russia", "country"],
  ["kazahstan", "country"],
  ["ukrainetop", "country"],
  ["russiatop", "country"],
  ["belarus", "country"],
  ["usa", "country"],
  ["america", "country"],
  ["украина", "country"],
  ["россия", "country"],
  ["беларусь", "country"],
  ["казахстан", "country"],
  ["сша", "country"],
  ["америка", "country"],
];

// Правила соцсети. У каждого пункта есть автоматор (детектор), который сам
// находит нарушение и выдаёт варн. detector = null — правило рассматривается
// только вручную администратором (надёжного детектора нет).
// contexts: где искать нарушение (post/comment/message/channel_post/group_message/
// profile/nickname/bot_create). Дополнительные пороги — в detector_config.
const CONTENT_ALL = ["post", "comment", "message", "channel_post", "group_message"];

const RULES_SEED = [
  { number: 1, title: "Оскорбления", description: "Запрещено оскорблять других пользователей.", detector: "insults", contexts: ["post", "channel_post"] },
  { number: 2, title: "Спам", description: "Запрещена реклама и спам без согласия получателя.", detector: "spam_keywords", contexts: ["post", "channel_post"] },
  { number: 3, title: "Запрещённые ники", description: "Запрещены ники с названиями стран, словом official и подобными.", detector: "forbidden_nickname", contexts: ["nickname"] },
  { number: 4, title: "Фейковые аккаунты", description: "Запрещено выдавать себя за других людей и администрацию.", detector: "impersonation", contexts: ["nickname"] },
  { number: 5, title: "Запрещённый контент", description: "Запрещены материалы, нарушающие закон, в комментариях и сообщениях.", detector: "nsfw", contexts: ["comment", "message"] },
  { number: 6, title: "Попытка обмануть систему после блокировки аккаунта", description: "Запрещено создавать новый аккаунт с ником, похожим на забаненный.", detector: "ban_evasion", contexts: ["nickname"] },
  { number: 7, title: "Создание юзерБОТ аккаунта", description: "Запрещено выдавать бота за живого пользователя. Проверяется вручную.", detector: null, contexts: [] },
  { number: 8, title: "БОТЫ ПРАВИЛА", description: "Общие требования к ботам: без спама, без выдачи себя за человека. Проверяется вручную.", detector: null, contexts: [] },
  { number: 9, title: "Мат в постах", description: "Нецензурная лексика в публикациях ленты.", detector: "profanity", contexts: ["post"] },
  { number: 10, title: "Мат в комментариях", description: "Нецензурная лексика в комментариях.", detector: "profanity", contexts: ["comment"] },
  { number: 11, title: "Мат в личных сообщениях", description: "Нецензурная лексика в переписке.", detector: "profanity", contexts: ["message"] },
  { number: 12, title: "Мат в постах каналов", description: "Нецензурная лексика в публикациях каналов.", detector: "profanity", contexts: ["channel_post"] },
  { number: 13, title: "Мат в сообщениях групп", description: "Нецензурная лексика в групповых чатах.", detector: "profanity", contexts: ["group_message"] },
  { number: 14, title: "Замаскированный мат", description: "Мат, замаскированный символами: б*я, п3здец, х**й.", detector: "masked_profanity", contexts: CONTENT_ALL },
  { number: 15, title: "Оскорбления в комментариях", description: "Прямые оскорбления других пользователей в комментариях.", detector: "insults", contexts: ["comment"] },
  { number: 16, title: "Оскорбления в личных сообщениях", description: "Прямые оскорбления в переписке.", detector: "insults", contexts: ["message"] },
  { number: 17, title: "Угрозы расправой", description: "Угрозы физической расправы в публикациях и постах каналов.", detector: "threats", contexts: ["post", "channel_post"] },
  { number: 18, title: "Разжигание ненависти", description: "Оскорбления по национальному и религиозному признаку.", detector: "discrimination", contexts: CONTENT_ALL },
  { number: 19, title: "Пропаганда насилия и жестокости", description: "Описание насилия, расчленения, призывы к суициду.", detector: "violence", contexts: CONTENT_ALL },
  { number: 20, title: "Взрослый контент в постах", description: "Материалы 18+ в публикациях и каналах.", detector: "nsfw", contexts: ["post", "channel_post"] },
  { number: 21, title: "Реклама в сообщениях", description: "Реклама и спам-слова в переписке и группах.", detector: "spam_keywords", contexts: ["message", "group_message"] },
  { number: 22, title: "Реклама в комментариях", description: "Реклама и спам-слова в комментариях.", detector: "spam_keywords", contexts: ["comment"] },
  { number: 23, title: "Спам-ссылки", description: "Много ссылок в одном сообщении или посте.", detector: "spam_links", contexts: CONTENT_ALL },
  { number: 24, title: "Ссылки на казино и ставки", description: "Упоминание казино, ставок, букмекеров.", detector: "gambling", contexts: CONTENT_ALL },
  { number: 25, title: "Крипто-мошенничество", description: "Схемы «удвоения», инвестиции, криптокошельки.", detector: "crypto_scam", contexts: CONTENT_ALL },
  { number: 26, title: "Просьбы о переводе денег", description: "Просьбы перевести деньги на карту или кошелёк.", detector: "scam_money", contexts: CONTENT_ALL },
  { number: 27, title: "Телефонные номера", description: "Публикация телефонных номеров в контенте.", detector: "phone_numbers", contexts: CONTENT_ALL },
  { number: 28, title: "Массовые упоминания", description: "Сообщение с шестью и более упоминаниями пользователей.", detector: "mass_mentions", contexts: CONTENT_ALL },
  { number: 29, title: "Флуд в группах", description: "Слишком много сообщений в группе за короткое время.", detector: "message_rate", contexts: ["group_message"], config: { limit: 20, minutes: 3 }, noDelete: true },
  { number: 30, title: "Кричащий капс", description: "Сообщение из заглавных букв длиной больше 20 символов.", detector: "caps_lock", contexts: CONTENT_ALL },
  { number: 31, title: "Повторы символов", description: "Один и тот же символ шесть и более раз подряд.", detector: "repeated_chars", contexts: CONTENT_ALL },
  { number: 32, title: "Хештег-спам", description: "Десять и более хештегов в посте.", detector: "hashtag_flood", contexts: ["post", "channel_post"] },
  { number: 33, title: "Эмодзи-флуд", description: "Двадцать и более эмодзи в одном сообщении.", detector: "emoji_flood", contexts: CONTENT_ALL },
  { number: 34, title: "Сообщение только из ссылки", description: "Сообщение, состоящее из одной ссылки без текста.", detector: "link_only", contexts: ["message", "group_message"] },
  { number: 35, title: "Контакты сторонних сервисов", description: "Telegram, WhatsApp, Instagram и другие контакты вместо общения в ИДЕЛЬ.", detector: "external_contacts", contexts: ["message", "group_message", "comment"] },
  { number: 36, title: "Продажа аккаунтов", description: "Продажа, покупка и обмен аккаунтов ИДЕЛЬ.", detector: "account_sale", contexts: CONTENT_ALL },
  { number: 37, title: "Ложные заявления о верификации", description: "Заявления «я верифицирован», «у меня галочка» без таковой.", detector: "fake_verified", contexts: CONTENT_ALL },
  { number: 38, title: "Публикация личных данных", description: "Паспорт, СНИЛС, номер карты, коды из СМС.", detector: "personal_data", contexts: CONTENT_ALL },
  { number: 39, title: "Ложная верификация в профиле", description: "Заявления о статусе в описании профиля.", detector: "fake_verified", contexts: ["profile"] },
  { number: 40, title: "Массовая публикация постов", description: "Пять и более постов за десять минут.", detector: "post_rate", contexts: ["post"], noDelete: true },
  { number: 41, title: "Массовые комментарии", description: "Десять и более комментариев за десять минут.", detector: "comment_rate", contexts: ["comment"], noDelete: true },
  { number: 42, title: "Массовые сообщения", description: "Тридцать и более сообщений за пять минут.", detector: "message_rate", contexts: ["message"], noDelete: true },
  { number: 43, title: "Дубликаты постов", description: "Повторная публикация того же текста в течение часа.", detector: "duplicate_content", contexts: ["post"] },
  { number: 44, title: "Много ботов за сутки", description: "Четыре и более созданных бота за сутки.", detector: "bot_mass_create", contexts: ["bot_create"] },
  { number: 45, title: "Реклама в описании профиля", description: "Ссылки в описании профиля.", detector: "bio_links", contexts: ["profile"] },
  { number: 46, title: "Контакты в описании профиля", description: "Телефоны и упоминания в описании профиля.", detector: "bio_contacts", contexts: ["profile"] },
  { number: 47, title: "Мат в описании профиля", description: "Нецензурная лексика в описании профиля.", detector: "profanity", contexts: ["profile"] },
  { number: 48, title: "Оскорбления в имени профиля", description: "Оскорбительные слова в отображаемом имени.", detector: "insults", contexts: ["profile"] },
  { number: 49, title: "Угрозы в комментариях", description: "Угрозы физической расправы в комментариях.", detector: "threats", contexts: ["comment"] },
  { number: 50, title: "Угрозы в личных сообщениях", description: "Угрозы физической расправы в переписке.", detector: "threats", contexts: ["message"] },
];

function seedReferenceData() {
  const insertWord = db.prepare(
    "INSERT OR IGNORE INTO forbidden_words (id, word, category, created_at) VALUES (?, ?, ?, ?)",
  );
  const now = new Date().toISOString();
  for (const [word, category] of FORBIDDEN_WORDS_SEED) {
    insertWord.run(uid(), word, category, now);
  }

  const insertRule = db.prepare(
    `INSERT OR IGNORE INTO rules (id, number, title, description, updated_at, detector, detector_config, enabled, action, delete_content)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'warn', ?)`,
  );
  // Досыпаем детекторы существующим правилам, которые администратор уже
  // правил вручную: заголовок и описание не трогаем, ставим только автоматор.
  const fillDetector = db.prepare(
    "UPDATE rules SET detector = ?, detector_config = ?, updated_at = ? WHERE number = ? AND (detector IS NULL OR detector = '')",
  );
  for (const rule of RULES_SEED) {
    const contexts = rule.contexts || [];
    // Правила, которые ищут нарушение в контенте, по умолчанию удаляют его.
    // Исключение — правила-лимиты (noDelete): они только предупреждают,
    // иначе обычный активный пользователь терял бы свои посты.
    const deleteContent = !rule.noDelete && contexts.some((context) => CONTENT_ALL.includes(context)) ? 1 : 0;
    insertRule.run(
      uid(),
      rule.number,
      rule.title,
      rule.description,
      now,
      rule.detector || null,
      JSON.stringify({ contexts, ...(rule.config || {}) }),
      deleteContent,
    );
    if (rule.detector) {
      fillDetector.run(rule.detector, JSON.stringify({ contexts, ...(rule.config || {}) }), now, rule.number);
    }
  }
}

seedReferenceData();

// Default settings row for the censor toggle.
const censorRow = db.prepare("SELECT value FROM settings WHERE key = 'censorEnabled'").get();
if (!censorRow) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('censorEnabled', '1')").run();
}

// ---------------------------------------------------------------------------
// Разовое шифрование текста личных сообщений, сохранённых до включения
// шифрования. Здесь используется modules/messageCrypto (он не обращается к db,
// поэтому циклической зависимости не возникает).
// ---------------------------------------------------------------------------
try {
  const messageCrypto = require("./modules/messageCrypto");
  const rows = db.prepare("SELECT id, text FROM messages").all();
  const updateText = db.prepare("UPDATE messages SET text = ? WHERE id = ?");
  let encrypted = 0;
  for (const row of rows) {
    if (messageCrypto.isEncrypted(row.text)) continue;
    updateText.run(messageCrypto.encrypt(row.text), row.id);
    encrypted += 1;
  }
  if (encrypted > 0) {
    console.log(`[db] Зашифрован текст старых сообщений: ${encrypted}`);
    require("./utils/logger").logInfo("Текст сообщений зашифрован", { messages: encrypted });
  }
} catch (error) {
  require("./utils/logger").logCritical("Не удалось зашифровать текст старых сообщений", error);
  throw error;
}

module.exports = db;
