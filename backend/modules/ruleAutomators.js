// Автоматоры правил: каждый пункт правил может иметь детектор, который сам
// находит нарушение в контенте и выдаёт варн (или бан, если так настроено).
//
// Правила хранятся в таблице rules: detector — ключ детектора, detector_config —
// JSON с контекстами и порогами, enabled — включён ли автоматор, action —
// 'warn' (по умолчанию) или 'ban' + ban_days.
//
// За одно действие выдаётся ОДНО наказание: движок берёт первое подходящее
// правило по возрастанию номера, чтобы матерное сообщение не превращалось в
// пять варнов сразу.
//
// Контексты (где ищем нарушение):
//   post, comment, message, channel_post, group_message — текст контента;
//   profile — биография/имя профиля; nickname — ник; register — регистрация;
//   bot_create — создание бота через @creatorbot.

const db = require("../db");
const { logWarn, logInfo } = require("../utils/logger");
const { censorText } = require("../utils/censor");
const { isNicknameAllowed } = require("./nicknameFilter");
const { registerViolation } = require("./warnings");
const banSystem = require("./banSystem");

const CONTENT_CONTEXTS = ["post", "comment", "message", "channel_post", "group_message"];

/** Категория варна по детектору (для журнала и отображения). */
const CATEGORY_BY_DETECTOR = {
  profanity: "profanity",
  masked_profanity: "profanity",
  insults: "toxicity",
  threats: "toxicity",
  discrimination: "toxicity",
  nsfw: "other",
  forbidden_nickname: "nickname",
  impersonation: "nickname",
  ban_evasion: "other",
};

/** Экранирование для регулярных выражений. */
function reEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Поиск слова как отдельного слова (кириллица/латиница — границы слова). */
function hasWord(text, word) {
  const pattern = new RegExp(`(^|[^a-zа-яё0-9_])${reEscape(word)}([^a-zа-яё0-9_]|$)`, "i");
  return pattern.test(text);
}

/** Сколько раз в тексте встретилось любое из слов. */
function countWords(text, words) {
  let hits = 0;
  for (const word of words) {
    if (hasWord(text, word)) hits += 1;
  }
  return hits;
}

function countMatches(text, pattern) {
  const matches = String(text).match(pattern);
  return matches ? matches.length : 0;
}

/** Расстояние Левенштейна — для поиска похожих ников (подделки, обход бана). */
function levenshtein(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left === right) return 0;
  const rows = left.length + 1;
  const cols = right.length + 1;
  const matrix = Array.from({ length: rows }, (_, i) => [i, ...Array(cols - 1).fill(0)]);
  for (let j = 1; j < cols; j += 1) matrix[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[rows - 1][cols - 1];
}

// ---------------------------------------------------------------------------
// Библиотека детекторов
// ---------------------------------------------------------------------------

const INSULTS = [
  "дурак",
  "дура",
  "идиот",
  "идиотка",
  "тупой",
  "тупая",
  "дебил",
  "дебилка",
  "кретин",
  "кретинка",
  "урод",
  "уродина",
  "мразь",
  "лох",
  "лохушка",
  "придурок",
  "придурошный",
  "недоумок",
  "чмо",
  "ничтожество",
  "отброс",
  "быдло",
  "хамло",
  "idiot",
  "moron",
  "retard",
];

const THREATS = [
  "убью",
  "убить",
  "прикончу",
  "покалечу",
  "изобью",
  "изуродую",
  "сожгу",
  "найду тебя",
  "тебе не жить",
  "зарежу",
  "отвечаю за базар",
  "кишки выпущу",
];

const DISCRIMINATION = [
  "хач",
  "чурка",
  "чурбан",
  "жид",
  "хохол",
  "москаль",
  "кацап",
  "дагестанец воняет",
  "нацист",
  "фашист",
  "зигхайль",
];

const NSFW = [
  "порно",
  "порнуха",
  "секс",
  "обнажен",
  "обнажён",
  "голый",
  "голая",
  "интим",
  "педофил",
  "изнасил",
];

const VIOLENCE = [
  "расчленен",
  "расчленён",
  "убийство",
  "убивать",
  "насилие",
  "кровь",
  "суицид",
  "самоубийств",
  "избиение",
  "убийца",
  "зарезать",
];

const SPAM_KEYWORDS = [
  "заработок",
  "заработать",
  "зарабатывай",
  "промокод",
  "переходи по ссылке",
  "подписывайся",
  "розыгрыш",
  "бесплатные подписчики",
  "накрутка",
  "скидка",
  "акция",
  "буст",
  "реклама в лс",
  "предложение по рекламе",
];

const GAMBLING = ["казино", "ставки", "букмекер", "рулетка", "джекпот", "1xbet", "авиатор", "беттинг"];

const CRYPTO_SCAM = [
  "криптовалюта",
  "биткоин",
  "usdt",
  "инвестируй",
  "пассивный доход",
  "удвоим",
  "удвоение",
  "крипто-кошелёк",
  "криптокошелёк",
  "иксы",
];

const SCAM_MONEY = [
  "переведи",
  "переведите",
  "реквизиты",
  "номер карты",
  "перевод на карту",
  "предоплата",
  "сбербанк",
  "тинькофф",
  "криптокошелёк",
];

const EXTERNAL_CONTACTS = [
  "telegram",
  "телеграм",
  "t.me/",
  "whatsapp",
  "ватсап",
  "vk.com",
  "вконтакте",
  "instagram",
  "инстаграм",
  "discord.gg",
];

const ACCOUNT_SALE = ["продам аккаунт", "куплю аккаунт", "продажа аккаунтов", "обмен аккаунтов", "продам профиль"];

const FAKE_VERIFIED = [
  "я верифицирован",
  "у меня галочка",
  "я официальный аккаунт",
  "я администратор идель",
  "я админ идель",
  "я представитель идель",
];

const PERSONAL_DATA = [
  "паспорт",
  "снилс",
  "номер карты",
  "cvv",
  "код из смс",
  "идентификационный номер",
];

/**
 * Заранее собранные шаблоны «мат с разделителями»: б*я, бл*ть, п3здец, х**й.
 * Плейнтекст-мат ловит цензор (детектор profanity), здесь — только маскировка.
 */
const MASKED_PATTERNS = [
  { stem: "хуй", pattern: /(^|[^а-яё])ху[йяеё]([^а-яё]|$)/i },
  { stem: "пизд", pattern: /(^|[^а-яё])п[и3][зz][дd][а-яё]*/i },
  { stem: "бля", pattern: /(^|[^а-яё])бл[яа]([^а-яё]|$)/i },
  { stem: "бля", pattern: /(^|[^а-яё])б[^а-яё0-9]{1,3}[яа]([^а-яё0-9]|$)/i },
  { stem: "ебать", pattern: /(^|[^а-яё])[еe][б6][аa][лнт][а-яё]*/i },
  { stem: "сука", pattern: /(^|[^а-яё])с[уy][кk][аa]([^а-яё]|$)/i },
  { stem: "мразь", pattern: /(^|[^а-яё])м[рp][аa][зz][ьb]?([^а-яё]|$)/i },
];

function urlsIn(text) {
  return countMatches(text, /(https?:\/\/|www\.)[^\s]+/gi);
}

const DETECTORS = {
  profanity: {
    label: "Мат и нецензурная лексика",
    contexts: CONTENT_CONTEXTS,
    run({ text }) {
      const result = censorText(String(text || ""));
      if (!result.changed) return { matched: false };
      return { matched: true, note: result.matches.join(", ") || "мат" };
    },
  },

  masked_profanity: {
    label: "Замаскированный мат",
    contexts: CONTENT_CONTEXTS,
    run({ text }) {
      const value = String(text || "");
      // Обычный мат ловит цензор: иначе это правило срабатывало бы на каждый
      // плейнтекстный мат и мешало правилам «Мат в …».
      if (censorText(value).changed) return { matched: false };
      const lower = value.toLowerCase();
      for (const { stem, pattern } of MASKED_PATTERNS) {
        if (pattern.test(lower)) return { matched: true, note: stem };
      }
      return { matched: false };
    },
  },

  insults: {
    label: "Оскорбления",
    contexts: [...CONTENT_CONTEXTS, "profile"],
    run({ text }) {
      const value = String(text || "").toLowerCase();
      for (const word of INSULTS) {
        if (hasWord(value, word)) return { matched: true, note: word };
      }
      return { matched: false };
    },
  },

  threats: {
    label: "Угрозы",
    contexts: CONTENT_CONTEXTS,
    run({ text }) {
      const value = String(text || "").toLowerCase();
      for (const word of THREATS) {
        if (hasWord(value, word)) return { matched: true, note: word };
      }
      return { matched: false };
    },
  },

  discrimination: {
    label: "Разжигание ненависти",
    contexts: CONTENT_CONTEXTS,
    run({ text }) {
      const value = String(text || "").toLowerCase();
      for (const word of DISCRIMINATION) {
        if (hasWord(value, word)) return { matched: true, note: word };
      }
      return { matched: false };
    },
  },

  nsfw: {
    label: "Взрослый контент",
    contexts: CONTENT_CONTEXTS,
    run({ text }) {
      const value = String(text || "").toLowerCase();
      for (const word of NSFW) {
        if (hasWord(value, word)) return { matched: true, note: word };
      }
      return { matched: false };
    },
  },

  violence: {
    label: "Пропаганда насилия и жестокости",
    contexts: CONTENT_CONTEXTS,
    run({ text }) {
      const value = String(text || "").toLowerCase();
      for (const word of VIOLENCE) {
        if (hasWord(value, word)) return { matched: true, note: word };
      }
      return { matched: false };
    },
  },

  spam_keywords: {
    label: "Реклама и спам-слова",
    contexts: CONTENT_CONTEXTS,
    run({ text, config }) {
      const minHits = Number(config?.minHits) || 1;
      const value = String(text || "").toLowerCase();
      const hits = countWords(value, SPAM_KEYWORDS);
      return hits >= minHits ? { matched: true, note: `слов: ${hits}` } : { matched: false };
    },
  },

  spam_links: {
    label: "Много ссылок в сообщении",
    contexts: CONTENT_CONTEXTS,
    run({ text, config }) {
      const links = urlsIn(text);
      const threshold = Number(config?.links) || 3;
      return links >= threshold ? { matched: true, note: `ссылок: ${links}` } : { matched: false };
    },
  },

  link_only: {
    label: "Сообщение только из ссылки",
    contexts: ["message", "group_message"],
    run({ text }) {
      const value = String(text || "");
      if (urlsIn(value) === 0) return { matched: false };
      const rest = value.replace(/(https?:\/\/|www\.)[^\s]+/gi, "").replace(/[^a-zа-яё]/gi, "");
      return rest.length < 3 ? { matched: true, note: "только ссылка" } : { matched: false };
    },
  },

  gambling: {
    label: "Казино и ставки",
    contexts: CONTENT_CONTEXTS,
    run({ text }) {
      const value = String(text || "").toLowerCase();
      for (const word of GAMBLING) {
        if (hasWord(value, word)) return { matched: true, note: word };
      }
      return { matched: false };
    },
  },

  crypto_scam: {
    label: "Крипто-мошенничество",
    contexts: CONTENT_CONTEXTS,
    run({ text, config }) {
      const minHits = Number(config?.minHits) || 2;
      const value = String(text || "").toLowerCase();
      const hits = countWords(value, CRYPTO_SCAM);
      return hits >= minHits ? { matched: true, note: `слов: ${hits}` } : { matched: false };
    },
  },

  scam_money: {
    label: "Просьбы о переводе денег",
    contexts: CONTENT_CONTEXTS,
    run({ text, config }) {
      const minHits = Number(config?.minHits) || 2;
      const value = String(text || "").toLowerCase();
      const hits = countWords(value, SCAM_MONEY);
      return hits >= minHits ? { matched: true, note: `слов: ${hits}` } : { matched: false };
    },
  },

  phone_numbers: {
    label: "Телефонные номера",
    contexts: CONTENT_CONTEXTS,
    run({ text }) {
      const matches = String(text || "").match(/(\+?\d[\d\s\-()]{8,}\d)/g) || [];
      for (const candidate of matches) {
        const digits = candidate.replace(/\D/g, "");
        if (digits.length >= 10) return { matched: true, note: candidate.trim() };
      }
      return { matched: false };
    },
  },

  mass_mentions: {
    label: "Массовые упоминания",
    contexts: CONTENT_CONTEXTS,
    run({ text, config }) {
      const mentions = countMatches(text, /@[a-z0-9_]{2,}/gi);
      const threshold = Number(config?.mentions) || 6;
      return mentions >= threshold ? { matched: true, note: `упоминаний: ${mentions}` } : { matched: false };
    },
  },

  hashtag_flood: {
    label: "Хештег-спам",
    contexts: ["post", "channel_post"],
    run({ text, config }) {
      const tags = countMatches(text, /#[a-zа-яё0-9_]{2,}/gi);
      const threshold = Number(config?.hashtags) || 10;
      return tags >= threshold ? { matched: true, note: `хештегов: ${tags}` } : { matched: false };
    },
  },

  emoji_flood: {
    label: "Эмодзи-флуд",
    contexts: CONTENT_CONTEXTS,
    run({ text, config }) {
      const emojis = countMatches(text, /\p{Extended_Pictographic}/gu);
      const threshold = Number(config?.emojis) || 20;
      return emojis >= threshold ? { matched: true, note: `эмодзи: ${emojis}` } : { matched: false };
    },
  },

  external_contacts: {
    label: "Контакты сторонних сервисов",
    contexts: [...CONTENT_CONTEXTS, "profile"],
    run({ text }) {
      const value = String(text || "").toLowerCase();
      for (const word of EXTERNAL_CONTACTS) {
        if (value.includes(word)) return { matched: true, note: word };
      }
      return { matched: false };
    },
  },

  account_sale: {
    label: "Продажа аккаунтов",
    contexts: CONTENT_CONTEXTS,
    run({ text }) {
      const value = String(text || "").toLowerCase();
      for (const phrase of ACCOUNT_SALE) {
        if (value.includes(phrase)) return { matched: true, note: phrase };
      }
      return { matched: false };
    },
  },

  fake_verified: {
    label: "Ложное заявление о верификации",
    contexts: CONTENT_CONTEXTS,
    run({ text }) {
      const value = String(text || "").toLowerCase();
      for (const phrase of FAKE_VERIFIED) {
        if (value.includes(phrase)) return { matched: true, note: phrase };
      }
      return { matched: false };
    },
  },

  personal_data: {
    label: "Публикация личных данных",
    contexts: CONTENT_CONTEXTS,
    run({ text }) {
      const value = String(text || "").toLowerCase();
      for (const word of PERSONAL_DATA) {
        if (hasWord(value, word)) return { matched: true, note: word };
      }
      return { matched: false };
    },
  },

  caps_lock: {
    label: "Кричащий капс",
    contexts: CONTENT_CONTEXTS,
    run({ text }) {
      const value = String(text || "");
      const letters = value.replace(/[^a-zа-яё]/gi, "");
      if (letters.length < 20) return { matched: false };
      const upper = value.replace(/[^A-ZА-ЯЁ]/g, "").length;
      const ratio = upper / letters.length;
      return ratio > 0.7 ? { matched: true, note: `капс ${Math.round(ratio * 100)}%` } : { matched: false };
    },
  },

  repeated_chars: {
    label: "Повторы символов",
    contexts: CONTENT_CONTEXTS,
    run({ text }) {
      const match = /([a-zа-яё0-9])\1{5,}/i.exec(String(text || ""));
      return match ? { matched: true, note: match[0].slice(0, 8) } : { matched: false };
    },
  },

  forbidden_nickname: {
    label: "Запрещённые слова в нике",
    contexts: ["nickname"],
    run({ text }) {
      const result = isNicknameAllowed(String(text || ""));
      return result.allowed ? { matched: false } : { matched: true, note: result.matched };
    },
  },

  impersonation: {
    label: "Подделка ников администрации",
    contexts: ["nickname"],
    run({ text }) {
      const username = String(text || "").toLowerCase().trim();
      if (!username) return { matched: false };
      const admins = db.prepare("SELECT username FROM users WHERE is_admin = 1 OR verified = 1").all();
      for (const admin of admins) {
        const target = String(admin.username || "").toLowerCase();
        if (!target || target === username) continue;
        if (levenshtein(username, target) <= 2) {
          return { matched: true, note: `похоже на @${target}` };
        }
      }
      return { matched: false };
    },
  },

  ban_evasion: {
    label: "Обход блокировки новым аккаунтом",
    contexts: ["nickname"],
    run({ text }) {
      const username = String(text || "").toLowerCase().trim();
      if (!username) return { matched: false };
      const banned = db
        .prepare(
          `SELECT u.username FROM bans b JOIN users u ON u.id = b.user_id WHERE u.username IS NOT NULL`,
        )
        .all();
      for (const row of banned) {
        const target = String(row.username || "").toLowerCase();
        if (!target) continue;
        if (levenshtein(username, target) <= 2) return { matched: true, note: `похоже на забаненный @${target}` };
      }
      return { matched: false };
    },
  },

  post_rate: {
    label: "Слишком частые посты",
    contexts: ["post"],
    run({ userId, config }) {
      const minutes = Number(config?.minutes) || 10;
      const limit = Number(config?.limit) || 5;
      const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
      const row = db
        .prepare("SELECT COUNT(*) AS c FROM posts WHERE user_id = ? AND created_at >= ?")
        .get(userId, since);
      return row.c >= limit ? { matched: true, note: `постов за ${minutes} мин: ${row.c}` } : { matched: false };
    },
  },

  comment_rate: {
    label: "Слишком частые комментарии",
    contexts: ["comment"],
    run({ userId, config }) {
      const minutes = Number(config?.minutes) || 10;
      const limit = Number(config?.limit) || 10;
      const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
      const row = db
        .prepare("SELECT COUNT(*) AS c FROM comments WHERE user_id = ? AND created_at >= ?")
        .get(userId, since);
      return row.c >= limit ? { matched: true, note: `комментариев за ${minutes} мин: ${row.c}` } : { matched: false };
    },
  },

  message_rate: {
    label: "Слишком частые сообщения",
    contexts: ["message", "group_message"],
    run({ userId, config }) {
      const minutes = Number(config?.minutes) || 5;
      const limit = Number(config?.limit) || 30;
      const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
      const row = db
        .prepare("SELECT COUNT(*) AS c FROM messages WHERE from_user_id = ? AND created_at >= ?")
        .get(userId, since);
      return row.c >= limit ? { matched: true, note: `сообщений за ${minutes} мин: ${row.c}` } : { matched: false };
    },
  },

  duplicate_content: {
    label: "Дубликаты постов",
    contexts: ["post"],
    run({ userId, text, sourceId }) {
      const value = String(text || "").trim().toLowerCase();
      if (value.length < 12) return { matched: false };
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      // Исключаем сам новый пост: он уже вставлен в таблицу до проверки,
      // иначе детектор находил бы «дубликат» самого себя.
      const rows = db
        .prepare(
          "SELECT content FROM posts WHERE user_id = ? AND created_at >= ? AND id != ? ORDER BY created_at DESC LIMIT 5",
        )
        .all(userId, since, sourceId || "");
      const duplicate = rows.some((row) => String(row.content || "").trim().toLowerCase() === value);
      return duplicate ? { matched: true, note: "повтор поста" } : { matched: false };
    },
  },

  bot_mass_create: {
    label: "Массовое создание ботов",
    contexts: ["bot_create"],
    run({ userId, config }) {
      const limit = Number(config?.limit) || 4;
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const row = db.prepare("SELECT COUNT(*) AS c FROM bots WHERE user_id = ? AND created_at >= ?").get(userId, since);
      return row.c >= limit ? { matched: true, note: `ботов за сутки: ${row.c}` } : { matched: false };
    },
  },

  bio_links: {
    label: "Ссылки в описании профиля",
    contexts: ["profile"],
    run({ text }) {
      return urlsIn(text) > 0 ? { matched: true, note: "ссылка в профиле" } : { matched: false };
    },
  },

  bio_contacts: {
    label: "Контакты в описании профиля",
    contexts: ["profile"],
    run({ text }) {
      const value = String(text || "");
      if (/(\+?\d[\d\s\-()]{8,}\d)/.test(value)) return { matched: true, note: "телефон" };
      if (/@[a-z0-9_]{3,}/i.test(value)) return { matched: true, note: "упоминание" };
      return { matched: false };
    },
  },
};

function detectorInfo(key) {
  const detector = DETECTORS[key];
  if (!detector) return null;
  return {
    key,
    label: detector.label,
    category: CATEGORY_BY_DETECTOR[key] || "other",
    contexts: detector.contexts,
  };
}

/** Список доступных автоматоров для админ-панели. */
function listDetectors() {
  return Object.keys(DETECTORS).map(detectorInfo);
}

function parseConfig(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Таблицы контента для удаления нарушающих записей. */
const CONTENT_TABLES = {
  post: "posts",
  comment: "comments",
  message: "messages",
  channel_post: "channel_posts",
  group_message: "chat_group_messages",
};

/** Удаляет нарушающий контент (пост, комментарий, сообщение). */
function deleteViolatingContent(source, sourceId) {
  const table = CONTENT_TABLES[source];
  if (!table || !sourceId) return false;
  try {
    // Имя таблицы — константа из карты выше, id подставляется параметром.
    const result = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(sourceId);
    return result.changes > 0;
  } catch (error) {
    logWarn("Не удалось удалить нарушающий контент", { source, sourceId, error: String(error) });
    return false;
  }
}

/**
 * Проверяет контент по включённым автоматорам и применяет наказание по
 * первому сработавшему правилу (по возрастанию номера).
 *
 * @param {{userId: string, context: string, text?: string, imageUrl?: string|null,
 *   source?: string|null, sourceId?: string|null}} input
 * @returns {{rule: object, note: string, warning?: object, banned?: boolean, removed?: boolean}|null}
 */
function applyAutomators({ userId, context, text = "", imageUrl = null, source = null, sourceId = null }) {
  if (!userId || !context) return null;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user || user.is_admin) return null;
  // Ботов автоматорами не наказываем: у них нет репутации и галочек.
  if (user.is_bot) return null;

  const rules = db
    .prepare("SELECT * FROM rules WHERE enabled = 1 AND detector IS NOT NULL ORDER BY number ASC")
    .all();

  for (const rule of rules) {
    const detector = DETECTORS[rule.detector];
    if (!detector) continue;
    const config = parseConfig(rule.detector_config);
    const contexts = Array.isArray(config.contexts) && config.contexts.length > 0 ? config.contexts : detector.contexts;
    if (!contexts.includes(context)) continue;

    let result;
    try {
      result = detector.run({
        userId,
        text: String(text || ""),
        context,
        config,
        rule,
        user,
        imageUrl,
        sourceId,
      });
    } catch (error) {
      logWarn("Ошибка автоматора правила", { ruleNumber: rule.number, detector: rule.detector, error: String(error) });
      continue;
    }
    if (!result?.matched) continue;

    const category = CATEGORY_BY_DETECTOR[rule.detector] || "other";
    const note = result.note ? ` (${result.note})` : "";
    const violation = registerViolation({
      userId,
      reason: `Нарушение правила ${rule.number}: ${rule.title}${note}`,
      category,
      source,
      sourceId,
      matched: result.note || null,
      ruleNumber: rule.number,
    });

    let banned = violation.banned;
    // Правило с action = 'ban' банит сразу, не дожидаясь трёх варнов.
    if (!banned && rule.action === "ban") {
      const ban = banSystem.applyBan({
        userId,
        reason: `Автоматический бан: нарушение правила ${rule.number} — ${rule.title}`,
        ruleNumber: rule.number,
        mode: banSystem.MODE_NORMAL,
        durationDays: rule.ban_days ? Number(rule.ban_days) : null,
        bannedBy: null,
        isAuto: true,
      });
      banned = !!ban.ok;
    }

    // Правило с delete_content убирает нарушающий пост/комментарий/сообщение.
    let removed = false;
    if (rule.delete_content && CONTENT_TABLES[source]) {
      removed = deleteViolatingContent(source, sourceId);
      if (removed) {
        logInfo("Удалён нарушающий контент", {
          userId,
          ruleNumber: rule.number,
          source,
          sourceId,
        });
      }
    }

    return { rule, note: result.note || "", warning: violation.warning, banned, removed };
  }

  return null;
}

module.exports = {
  DETECTORS,
  CONTENT_CONTEXTS,
  CATEGORY_BY_DETECTOR,
  listDetectors,
  detectorInfo,
  applyAutomators,
  levenshtein,
};
