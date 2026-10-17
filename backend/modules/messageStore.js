// Единая точка записи личных сообщений.
//
// Текст шифруется перед вставкой (AES-256-GCM) и расшифровывается при чтении,
// поэтому создавать сообщения нужно только через saveMessage(), а отдавать
// клиенту — через readText()/serializeMessage(). Одно забытое место = либо
// открытый текст в БД, либо «кракозябры» в интерфейсе.

const db = require("../db");
const { uid } = require("../utils/uid");
const { encrypt, decrypt, isEncrypted } = require("./messageCrypto");

/**
 * Сохраняет сообщение с зашифрованным текстом и возвращает строку из БД.
 * imageUrl — картинка (data-URL или ссылка); текст может быть пустым.
 */
function saveMessage({ chatId, fromUserId, toUserId, text, imageUrl = null, createdAt }) {
  const id = uid();
  db.prepare(
    "INSERT INTO messages (id, chat_id, from_user_id, to_user_id, text, image_url, read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
  ).run(
    id,
    chatId,
    fromUserId,
    toUserId,
    encrypt(String(text ?? "")),
    imageUrl || null,
    createdAt || new Date().toISOString(),
  );
  return db.prepare("SELECT * FROM messages WHERE id = ?").get(id);
}

/** Текст сообщения для отдачи клиенту: расшифровка либо исходное значение. */
function readText(stored) {
  if (!isEncrypted(stored)) return stored;
  const plain = decrypt(stored);
  return plain === null ? stored : plain;
}

module.exports = { saveMessage, readText };
