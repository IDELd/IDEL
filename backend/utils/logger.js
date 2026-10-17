// Единый логгер проекта ИДЕЛЬ.
// Обычные события пишутся в logs/Obshiy_log.txt, критические — в
// logs/Critical_log.txt и дополнительно дублируются в общий лог, чтобы
// хронология событий не терялась.
//
// Логгер намеренно никогда не бросает исключений: сбой записи в файл не
// должен ломать запрос пользователя.

const fs = require("fs");
const path = require("path");

const LOG_DIR = path.join(__dirname, "..", "..", "logs");
const GENERAL_LOG = path.join(LOG_DIR, "Obshiy_log.txt");
const CRITICAL_LOG = path.join(LOG_DIR, "Critical_log.txt");

// Файл больше 5 МБ — переименовываем в <имя>.1 и начинаем заново.
const MAX_LOG_BYTES = 5 * 1024 * 1024;

let dirReady = false;

function ensureDir() {
  if (dirReady) return true;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    dirReady = true;
    return true;
  } catch {
    return false;
  }
}

function rotateIfNeeded(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_LOG_BYTES) fs.renameSync(file, `${file}.1`);
  } catch {
    // файла ещё нет — ротация не нужна
  }
}

function writeLine(file, level, message, meta) {
  if (!ensureDir()) return;
  rotateIfNeeded(file);
  const stamp = new Date().toISOString();
  let tail = "";
  if (meta !== undefined && meta !== null) {
    try {
      tail = ` ${typeof meta === "string" ? meta : JSON.stringify(meta)}`;
    } catch {
      tail = " [meta не сериализуется]";
    }
  }
  try {
    fs.appendFileSync(file, `[${stamp}] ${level} ${message}${tail}\n`, "utf8");
  } catch {
    // диск недоступен/нет прав — молча пропускаем
  }
}

/** Разворачивает Error/что угодно в пригодную для лога строку. */
function describeError(error) {
  if (!error) return "неизвестная ошибка";
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`;
  }
  try {
    return typeof error === "string" ? error : JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Обычное событие (вход, бан, выдача варна и т.п.). */
function logInfo(message, meta) {
  writeLine(GENERAL_LOG, "INFO", message, meta);
}

/** Предупреждение: подозрительная, но не сломавшая систему ситуация. */
function logWarn(message, meta) {
  writeLine(GENERAL_LOG, "WARN", message, meta);
}

/** Ошибка запроса/операции — общий лог. */
function logError(message, error, meta) {
  const payload = meta ? { ...meta, error: describeError(error) } : { error: describeError(error) };
  writeLine(GENERAL_LOG, "ERROR", message, payload);
}

/** Критическая ошибка — отдельный файл Critical_log.txt + общий лог. */
function logCritical(message, error, meta) {
  const payload = meta ? { ...meta, error: describeError(error) } : { error: describeError(error) };
  writeLine(CRITICAL_LOG, "CRITICAL", message, payload);
  writeLine(GENERAL_LOG, "CRITICAL", message, payload);
}

module.exports = {
  LOG_DIR,
  GENERAL_LOG,
  CRITICAL_LOG,
  logInfo,
  logWarn,
  logError,
  logCritical,
  describeError,
};
