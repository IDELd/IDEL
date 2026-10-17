// Ported 1:1 from src/lib/db.ts so validation rules stay identical between
// the (legacy) client-side data layer and the real server.

const { normalizeUsernameLetters, matchesForbiddenWord } = require("./nicknameNormalize");

/** Usernames: letters (latin or cyrillic), digits, underscore. 3-20 chars. */
const USERNAME_RE = /^[a-zа-яё0-9_]{3,20}$/i;

/** Usernames that are not allowed (country names and similar). */
const BLOCKED_USERNAMES = [
  "россия", "рф", "russia", "сша", "usa", "украина", "ukraine", "беларусь",
  "belarus", "казахстан", "kazakhstan", "германия", "germany", "франция",
  "france", "англия", "england", "великобритания", "unitedkingdom", "uk",
  "япония", "japan", "китай", "china", "индия", "india", "бразилия", "brazil",
  "испания", "spain", "италия", "italy", "польша", "poland", "латвия",
  "latvia", "литва", "lithuania", "эстония", "estonia", "грузия", "georgia",
  "армения", "armenia", "азербайджан", "azerbaijan", "турция", "turkey",
  "израиль", "israel", "египет", "egypt", "канада", "canada", "мексика",
  "mexico", "австралия", "australia", "швейцария", "switzerland", "швеция",
  "sweden", "норвегия", "norway", "финляндия", "finland", "нидерланды",
  "netherlands", "бельгия", "belgium", "австрия", "austria", "чехия",
  "czechia", "сербия", "serbia", "болгария", "bulgaria", "румыния",
  "romania", "венгрия", "hungary", "греция", "greece", "португалия",
  "portugal", "ирландия", "ireland", "дания", "denmark", "кипр", "cyprus",
  "исландия", "iceland", "монголия", "mongolia", "корея", "korea",
  "таиланд", "thailand", "вьетнам", "vietnam", "индонезия", "indonesia",
  "иран", "iran", "ирак", "iraq", "пакистан", "pakistan", "афганистан",
  "afghanistan", "аргентина", "argentina", "чили", "chile", "колумбия",
  "colombia", "перу", "peru",
];

const ADMIN_USERNAME = "drobovikov";
const VERIFY_BOT_USERNAME = "verifybot";
const RESTORE_BOT_USERNAME = "restorebot";
const PREMIUM_BOT_USERNAME = "premiumbot";
const CREATOR_BOT_USERNAME = "creatorbot";
/** Системный бот для кодов подтверждения входа в аккаунт. */
const RESEND_CODE_BOT_USERNAME = "resendcode_bot";

// Нормализованные варианты статического списка — считаются один раз при старте.
const NORMALIZED_BLOCKED = BLOCKED_USERNAMES
  .map((word) => ({ word, normalized: normalizeUsernameLetters(word) }))
  .filter((entry) => entry.normalized.length > 0);

/**
 * Проверяет ник: формат и статический список запрещённых слов.
 * Полную проверку (вместе с таблицей forbidden_words) делает
 * modules/nicknameFilter.js — здесь остаётся базовый уровень.
 */
function validateUsername(rawUsername) {
  const username = String(rawUsername || "").trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: "Недопустимое имя пользователя", code: "nickname_invalid" };
  }
  const normalized = normalizeUsernameLetters(username);
  const blocked = NORMALIZED_BLOCKED.find((entry) => matchesForbiddenWord(normalized, entry.normalized));
  if (blocked) {
    return {
      ok: false,
      error: "Данный юзернейм запрещён",
      code: "nickname_forbidden",
      blocked: true,
      matched: blocked.word,
    };
  }
  return { ok: true, username };
}

module.exports = {
  USERNAME_RE,
  BLOCKED_USERNAMES,
  ADMIN_USERNAME,
  VERIFY_BOT_USERNAME,
  RESTORE_BOT_USERNAME,
  PREMIUM_BOT_USERNAME,
  CREATOR_BOT_USERNAME,
  RESEND_CODE_BOT_USERNAME,
  validateUsername,
  normalizeUsernameLetters,
  matchesForbiddenWord,
};
