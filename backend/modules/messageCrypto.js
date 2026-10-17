// Шифрование текста личных сообщений.
//
// Ключ берётся из MESSAGE_ENC_KEY; если переменной нет — используется
// SESSION_ENC_KEY, затем JWT_SECRET, чтобы существующая установка не падала.

const { createCipher } = require("./crypto");
const { logWarn } = require("../utils/logger");

if (!process.env.MESSAGE_ENC_KEY) {
  // Без своего ключа сообщения шифруются ключом сессий: работать будет, но
  // ротация одного ключа затронет и сообщения, и сессии.
  logWarn("MESSAGE_ENC_KEY не задан — для сообщений используется SESSION_ENC_KEY/JWT_SECRET");
}

const KEY_SOURCE =
  process.env.MESSAGE_ENC_KEY ||
  process.env.SESSION_ENC_KEY ||
  process.env.JWT_SECRET ||
  "idel_dev_message_key";

const cipher = createCipher(KEY_SOURCE);

module.exports = cipher;
