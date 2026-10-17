// Порядок сопоставления ников с запрещёнными словами.
//
// Ник приводится к «буквенной» форме: убираются точки, пробелы, дефисы, цифры
// и любые другие не-буквенные символы, затем всё переводится в нижний регистр.
// Так «o.f.f.i.c.i.a.l» превращается в «official» и попадает под фильтр.
//
// Кириллица приводится к латинице в два шага:
//  1) визуальные двойники (о→o, с→c, е→e, ...) — ловят «оffiсiаl»;
//  2) фонетическая транслитерация оставшихся букв (л→l, ф→f, и→i, й→i,
//     ц→c, д→d, ы→y, з→z, б→b, г→g, ж→j, ю→u, я→a, э→e, ё→e) — ловит
//     «оффициал» и варианты вида «pickmichka_officiaл» (кириллическая «л»),
//     у которых нет похожей по начертанию латинской буквы.
//
// Правило поиска: слова длиной 4+ буквы ищутся как подстрока (ловит
// «ukrainetop», «russiatop», «xukrainex»), короткие (usa, uk, рф, сша) —
// только полным совпадением, иначе под фильтр попадали бы обычные ники
// вроде «luke» или «medusa».

const HOMOGLYPHS = {
  а: "a",
  в: "b",
  е: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
};

/** Фонетические соответствия для букв без латинского двойника по начертанию. */
const TRANSLITERATION = {
  б: "b",
  г: "g",
  д: "d",
  ж: "j",
  з: "z",
  и: "i",
  й: "i",
  л: "l",
  ф: "f",
  ц: "c",
  ы: "y",
  ю: "u",
  я: "a",
  э: "e",
  ё: "e",
};

const HOMOGLYPH_RE = new RegExp(`[${Object.keys(HOMOGLYPHS).join("")}]`, "g");
const TRANSLIT_RE = new RegExp(`[${Object.keys(TRANSLITERATION).join("")}]`, "g");

/** Убирает не-буквенные символы, приводит к нижнему регистру и сводит кириллицу к латинице. */
function normalizeUsernameLetters(raw) {
  const letters = String(raw || "")
    .toLowerCase()
    .replace(/[^\p{L}]/gu, "");
  return letters
    .replace(HOMOGLYPH_RE, (ch) => HOMOGLYPHS[ch] || ch)
    .replace(TRANSLIT_RE, (ch) => TRANSLITERATION[ch] || ch);
}

/** Сравнивает нормализованный ник с нормализованным запрещённым словом. */
function matchesForbiddenWord(normalizedUsername, normalizedWord) {
  if (!normalizedWord) return false;
  return normalizedWord.length >= 4
    ? normalizedUsername.includes(normalizedWord)
    : normalizedUsername === normalizedWord;
}

module.exports = { normalizeUsernameLetters, matchesForbiddenWord, HOMOGLYPHS };
