// Низкоуровневый клиент Supabase: Storage (файлы) и PostgREST (таблицы).
//
// Работает через обычный fetch, без SDK, чтобы не тянуть лишние зависимости.
// Настройка в backend/.env:
//   SUPABASE_URL=https://<project>.supabase.co
//   SUPABASE_SERVICE_KEY=<service_role key>   (server-side, не публиковать!)
//   SUPABASE_MEDIA_BUCKET=media
//
// Если SUPABASE_URL/SUPABASE_SERVICE_KEY не заданы, isConfigured() = false и
// приложение продолжает работать как раньше (медиа хранится в SQLite).

const { logWarn } = require("../utils/logger");

function config() {
  return {
    url: String(process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
    key: String(process.env.SUPABASE_SERVICE_KEY || ""),
    bucket: String(process.env.SUPABASE_MEDIA_BUCKET || "media"),
  };
}

function isConfigured() {
  const { url, key } = config();
  return Boolean(url && key);
}

function authHeaders(extra = {}) {
  const { key } = config();
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

/** Публичный URL объекта в бакете. */
function publicUrl(objectPath) {
  const { url, bucket } = config();
  return `${url}/storage/v1/object/public/${bucket}/${objectPath}`;
}

/** Загружает буфер в Storage и возвращает публичный URL. */
async function uploadObject(objectPath, buffer, contentType) {
  const { url, bucket } = config();
  const response = await fetch(`${url}/storage/v1/object/${bucket}/${objectPath}`, {
    method: "POST",
    headers: authHeaders({
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": "true",
    }),
    body: buffer,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase Storage ${response.status}: ${detail.slice(0, 200)}`);
  }
  return publicUrl(objectPath);
}

/** Удаляет объекты Storage по путям (пачкой). */
async function removeObjects(paths) {
  const list = paths.filter(Boolean);
  if (list.length === 0) return true;
  const { url, bucket } = config();
  const response = await fetch(`${url}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ prefixes: list }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    logWarn("Supabase Storage: не удалось удалить объекты", { status: response.status, detail: detail.slice(0, 200) });
    return false;
  }
  return true;
}

/** Список объектов бакета (для диагностики и авто-вайпа). */
async function listObjects(prefix = "", limit = 1000) {
  const { url, bucket } = config();
  const response = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      prefix,
      limit,
      offset: 0,
      sortBy: { column: "created_at", order: "asc" },
    }),
  });
  if (!response.ok) throw new Error(`Supabase Storage list ${response.status}`);
  return response.json();
}

/** Upsert строк в таблицу через PostgREST (создаёт/обновляет по PK). */
async function restUpsert(table, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return true;
  const { url } = config();
  const response = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: authHeaders({
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    logWarn("Supabase PostgREST: не удалось записать строки", { table, status: response.status, detail: detail.slice(0, 200) });
    return false;
  }
  return true;
}

module.exports = {
  config,
  isConfigured,
  publicUrl,
  uploadObject,
  removeObjects,
  listObjects,
  restUpsert,
};