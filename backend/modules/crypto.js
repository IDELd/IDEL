// Общий AES-256-GCM для шифрования данных в БД.
//
// Формат конверта: v1:iv:tag:data (все части в base64url). Ключ выводится
// через sha256 из переданного секрета, поэтому ключи сессий и сообщений
// независимы — каждому модулю передаётся свой секрет.

const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;

/**
 * Создаёт шифровальщик с собственным ключом.
 * @param {string} keySource любой секрет (обычно значение из .env)
 */
function createCipher(keySource) {
  const key = crypto.createHash("sha256").update(String(keySource || "")).digest();

  /**
   * Шифрует значение. Пустая строка шифруется как обычно (в таблицах есть
   * NOT NULL), null/undefined остаются null.
   */
  function encrypt(plain) {
    if (plain === undefined || plain === null) return null;
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString("base64url"),
      tag.toString("base64url"),
      encrypted.toString("base64url"),
    ].join(":");
  }

  /** Расшифровывает значение. null — если данных нет, ключ сменился или запись битая. */
  function decrypt(payload) {
    if (!payload || typeof payload !== "string") return null;
    const parts = payload.split(":");
    if (parts.length !== 4 || parts[0] !== VERSION) return null;
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(parts[1], "base64url"));
      decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(parts[3], "base64url")),
        decipher.final(),
      ]);
      return decrypted.toString("utf8");
    } catch {
      return null;
    }
  }

  function isEncrypted(value) {
    return typeof value === "string" && value.startsWith(`${VERSION}:`);
  }

  return { encrypt, decrypt, isEncrypted };
}

module.exports = { createCipher, ALGORITHM, VERSION, IV_BYTES };
