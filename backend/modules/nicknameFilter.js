// Фильтр ников: нормализация ввода + проверка по таблице forbidden_words.
// Статический список BLOCKED_USERNAMES из utils/validation.js остаётся вторым
// рубежом — он работает, даже если таблица запрещённых слов пуста.

const db = require("../db");
const {
  validateUsername,
} = require("../utils/validation");
const { normalizeUsernameLetters, matchesForbiddenWord } = require("../utils/nicknameNormalize");

// Список слов небольшой и меняется редко — кэшируем в памяти.
// Админские правки сбрасывают кэш через invalidateForbiddenWordsCache().
let wordsCache = null;

function loadForbiddenWords() {
  if (wordsCache) return wordsCache;
  const rows = db.prepare("SELECT word, category FROM forbidden_words ORDER BY word").all();
  wordsCache = rows
    .map((row) => ({
      word: row.word,
      category: row.category,
      normalized: normalizeUsernameLetters(row.word),
    }))
    .filter((row) => row.normalized.length > 0);
  return wordsCache;
}

/** Сбрасывает кэш запрещённых слов (вызывается после правок в админке). */
function invalidateForbiddenWordsCache() {
  wordsCache = null;
}

const FORBIDDEN_ERROR = "Данный юзернейм запрещён";

/**
 * Полная проверка ника.
 *
 * Порядок важен: сначала ник нормализуется и сверяется с таблицей
 * запрещённых слов, и только потом проверяется формат. Иначе ввод вроде
 * «o.f.f.i.c.i.a.l» падал бы на недопустимых символах и пользователь видел бы
 * «Недопустимое имя пользователя» вместо «Данный юзернейм запрещён».
 *
 * @returns {{ok: true, username: string, normalized: string}
 *   | {ok: false, error: string, code: string, matched?: string, category?: string}}
 */
function checkNickname(rawUsername) {
  const normalized = normalizeUsernameLetters(rawUsername);

  // 1. Таблица forbidden_words — источник, которым управляет администратор.
  if (normalized) {
    for (const entry of loadForbiddenWords()) {
      if (matchesForbiddenWord(normalized, entry.normalized)) {
        return {
          ok: false,
          error: FORBIDDEN_ERROR,
          code: "nickname_forbidden",
          matched: entry.word,
          category: entry.category || "other",
        };
      }
    }
  }

  // 2. Формат и статический список стран (как было раньше).
  const format = validateUsername(rawUsername);
  if (!format.ok) {
    return {
      ok: false,
      error: format.code === "nickname_forbidden" ? FORBIDDEN_ERROR : format.error,
      code: format.code,
      matched: format.matched,
    };
  }

  const username = format.username;
  const finalNormalized = normalizeUsernameLetters(username);
  if (!finalNormalized) {
    return { ok: false, error: FORBIDDEN_ERROR, code: "nickname_forbidden" };
  }

  return { ok: true, username, normalized: finalNormalized };
}

/** Быстрая проверка «да/нет» без деталей — для публичного эндпоинта. */
function isNicknameAllowed(rawUsername) {
  const result = checkNickname(rawUsername);
  return result.ok
    ? { allowed: true, username: result.username }
    : { allowed: false, error: result.error, code: result.code, matched: result.matched };
}

module.exports = {
  checkNickname,
  isNicknameAllowed,
  invalidateForbiddenWordsCache,
  FORBIDDEN_ERROR,
};
