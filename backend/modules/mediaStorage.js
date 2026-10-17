// Хранилище медиа: крупные файлы (картинки постов, дич-графика, видео,
// голосовые) уходят в Supabase Storage, а в SQLite остаётся только ссылка.
// Аватарки и обложки остаются локальными (middleware/upload.js).
//
// Если Supabase не настроен, всё работает как раньше: data-URL остаётся в
// SQLite, локальные файлы — в uploads/.
//
// Авто-вайп: когда количество медиа превышает MAX_MEDIA_FILES, удаляются
// самые старые файлы (старше MEDIA_TTL_DAYS дней), а ссылки в БД обнуляются.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("../db");
const supabase = require("./supabase");
const { logInfo, logWarn } = require("../utils/logger");

const UPLOAD_ROOT = path.join(__dirname, "..", "uploads");

/** Где в БД лежат ссылки на файлы. */
const MEDIA_COLUMNS = [
  { table: "posts", idCol: "id", columns: ["image_url", "drawing_url", "video_url", "video_thumbnail_url"], dateCol: "created_at" },
  { table: "comments", idCol: "id", columns: ["voice_url"], dateCol: "created_at" },
  { table: "channel_posts", idCol: "id", columns: ["image_url", "drawing_url"], dateCol: "created_at" },
  { table: "chat_group_messages", idCol: "id", columns: ["image_url"], dateCol: "created_at" },
];

const MIME_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
};

function maxFiles() {
  return Math.max(1, Number(process.env.MAX_MEDIA_FILES) || 2000);
}

function ttlDays() {
  return Math.max(1, Number(process.env.MEDIA_TTL_DAYS) || 30);
}

/** Разбирает data-URL вида data:image/png;base64,AAAA… */
function parseDataUrl(value) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(String(value || ""));
  if (!match) return null;
  try {
    return { contentType: match[1], buffer: Buffer.from(match[2], "base64") };
  } catch {
    return null;
  }
}

/** Локальный URL вида /uploads/posts/xxx.png → абсолютный путь на диске. */
function localPathFromUrl(url) {
  const value = String(url || "");
  const marker = "/uploads/";
  const index = value.indexOf(marker);
  if (index === -1) return null;
  const relative = value.slice(index + marker.length).split("?")[0];
  const absolute = path.join(UPLOAD_ROOT, relative);
  // Защита от выхода из папки uploads.
  if (!absolute.startsWith(UPLOAD_ROOT)) return null;
  return absolute;
}

function contentTypeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase().replace(".", "");
  const map = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    ogg: "audio/ogg",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
  };
  return map[ext] || "application/octet-stream";
}

function objectPath(folder) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${folder}/${year}/${month}/${crypto.randomUUID()}`;
}

function isSupabaseUrl(url) {
  const { url: base } = supabase.config();
  return Boolean(base) && String(url || "").startsWith(`${base}/storage/v1/object/public/`);
}

/** Путь объекта Storage из публичного URL. */
function storagePathFromUrl(url) {
  const { url: base, bucket } = supabase.config();
  const prefix = `${base}/storage/v1/object/public/${bucket}/`;
  if (!String(url || "").startsWith(prefix)) return null;
  return String(url).slice(prefix.length);
}

/**
 * Переносит медиа в Supabase Storage и возвращает новый URL.
 * data-URL и локальные /uploads/… загружаются в бакет; http(s)-ссылки
 * остаются как есть; без Supabase возвращается исходное значение.
 */
async function storeMediaUrl(url, { folder = "posts" } = {}) {
  if (!url || !supabase.isConfigured()) return url || null;

  const data = parseDataUrl(url);
  if (data) {
    try {
      const ext = MIME_EXT[data.contentType] || "bin";
      const uploaded = await supabase.uploadObject(`${objectPath(folder)}.${ext}`, data.buffer, data.contentType);
      logInfo("Медиа загружено в Supabase", { folder, bytes: data.buffer.length });
      return uploaded;
    } catch (error) {
      logWarn("Не удалось загрузить медиа в Supabase, остаётся data-URL", { error: String(error) });
      return url;
    }
  }

  const localPath = localPathFromUrl(url);
  if (localPath) {
    try {
      if (!fs.existsSync(localPath)) return url;
      const buffer = fs.readFileSync(localPath);
      const contentType = contentTypeFromPath(localPath);
      const ext = path.extname(localPath).replace(".", "") || MIME_EXT[contentType] || "bin";
      const uploaded = await supabase.uploadObject(`${objectPath(folder)}.${ext}`, buffer, contentType);
      logInfo("Локальный файл перенесён в Supabase", { folder, bytes: buffer.length });
      return uploaded;
    } catch (error) {
      logWarn("Не удалось перенести локальный файл в Supabase", { error: String(error) });
      return url;
    }
  }

  return url;
}

/** Все медиа-ссылки Supabase из БД (для авто-вайпа). */
function collectSupabaseMedia() {
  const entries = [];
  for (const spec of MEDIA_COLUMNS) {
    const select = [spec.idCol, spec.dateCol, ...spec.columns].join(", ");
    let rows = [];
    try {
      rows = db.prepare(`SELECT ${select} FROM ${spec.table}`).all();
    } catch {
      continue; // таблицы может не быть в старых базах
    }
    for (const row of rows) {
      for (const column of spec.columns) {
        const url = row[column];
        if (isSupabaseUrl(url)) {
          entries.push({ table: spec.table, id: row[spec.idCol], column, url, createdAt: row[spec.dateCol] });
        }
      }
    }
  }
  return entries;
}

/**
 * Авто-вайп: если медиа больше MAX_MEDIA_FILES, удаляем самые старые файлы
 * (сначала опубликованные раньше MEDIA_TTL_DAYS), обнуляя ссылки в БД.
 */
async function purgeOldMedia() {
  if (!supabase.isConfigured()) return { deleted: 0, total: 0 };
  const entries = collectSupabaseMedia();
  const total = entries.length;
  const limit = maxFiles();
  if (total <= limit) return { deleted: 0, total };

  const ttlMs = ttlDays() * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - ttlMs;
  const sorted = [...entries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const need = total - limit;
  const oldOnes = sorted.filter((entry) => new Date(entry.createdAt).getTime() < cutoff);
  const victims = [...oldOnes.slice(0, need)];
  if (victims.length < need) {
    // Старых не хватает — добиваем кап самыми древними из оставшихся.
    const rest = sorted.filter((entry) => !victims.includes(entry));
    victims.push(...rest.slice(0, need - victims.length));
  }
  if (victims.length === 0) return { deleted: 0, total };

  const paths = [];
  const byRow = new Map();
  for (const victim of victims) {
    const storagePath = storagePathFromUrl(victim.url);
    if (storagePath) paths.push(storagePath);
    const key = `${victim.table}:${victim.id}`;
    if (!byRow.has(key)) byRow.set(key, { table: victim.table, id: victim.id, columns: [] });
    byRow.get(key).columns.push(victim.column);
  }

  await supabase.removeObjects(paths);
  for (const { table, id, columns } of byRow.values()) {
    const setClause = columns.map((column) => `${column} = NULL`).join(", ");
    try {
      db.prepare(`UPDATE ${table} SET ${setClause} WHERE id = ?`).run(id);
    } catch (error) {
      logWarn("Авто-вайп: не удалось обнулить ссылку", { table, id, error: String(error) });
    }
  }

  logInfo("Авто-вайп медиа Supabase", { total, limit, deleted: victims.length, ttlDays: ttlDays() });
  return { deleted: victims.length, total };
}

module.exports = {
  isConfigured: () => supabase.isConfigured(),
  storeMediaUrl,
  purgeOldMedia,
  collectSupabaseMedia,
  parseDataUrl,
  localPathFromUrl,
  MEDIA_COLUMNS,
  maxFiles,
  ttlDays,
};