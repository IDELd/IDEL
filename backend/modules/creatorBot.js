// Логика бота @creatorbot — создание и редактирование ботов.
//
// Диалог пошаговый (в чате нет inline-кнопок), плюс поддерживаются команды с
// параметрами:
//   /create                                   — пошаговое создание
//   /my_bots                                  — список ботов с номерами
//   /edit <номер> name|desc|avatar <значение>  — правка без диалога
//   /token <номер>                             — показать API-токен
//   /newtoken <номер>                          — перевыпустить токен
//   /delete <номер>                            — удалить бота (с подтверждением)
//   /docs <номер>                              — ссылка на документацию API
//   /cancel                                    — прервать диалог

const db = require("../db");
const { uid } = require("../utils/uid");
const { logInfo } = require("../utils/logger");
const bots = require("./bots");
const banSystem = require("./banSystem");
const { VERIFY_BOT_USERNAME } = require("../utils/validation");

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const SKIP_WORDS = ["пропустить", "пропуск", "пропусти", "skip", "нет", "-"];

function docsLink(token) {
  return `${FRONTEND_URL.replace(/\/$/, "")}/#/bot-docs/${token}`;
}

/** Ссылка на чат с @verifybot — туда @creatorbot отправляет за опросом. */
function verifyBotLink() {
  const verifyBot = db.prepare("SELECT id FROM users WHERE lower(username) = ?").get(VERIFY_BOT_USERNAME);
  return verifyBot ? `${FRONTEND_URL.replace(/\/$/, "")}/#/chat/${verifyBot.id}` : "@verifybot";
}

/**
 * Создаёт заявку на верификацию бота и отправляет владельца в @verifybot.
 * Галочку не выдаёт — только заявку; уровень выбирает администратор.
 */
function startBotVerification(userId, bot) {
  const pending = db
    .prepare("SELECT id FROM verification_requests WHERE user_id = ? AND status = 'pending'")
    .get(bot.botUserId);
  if (pending) {
    return {
      action: "already_pending",
      message:
        `Заявка на галочку для @${bot.username} уже на рассмотрении.\n\n` +
        `Напишите @verifybot и ответьте на вопросы: ${verifyBotLink()}`,
    };
  }

  const id = uid();
  db.prepare(
    "INSERT INTO verification_requests (id, user_id, status, created_at) VALUES (?, ?, 'pending', ?)",
  ).run(id, bot.botUserId, new Date().toISOString());
  db.prepare("UPDATE verification_requests SET ai_details = ? WHERE id = ?").run(
    JSON.stringify({ type: "bot" }),
    id,
  );
  logInfo("Заявка на верификацию бота", { userId, botUsername: bot.username });

  return {
    action: "verify_started",
    message:
      `Заявка на галочку для @${bot.username} создана. Галочка появится только после решения администрации.\n\n` +
      `Напишите @verifybot и ответьте на вопросы: ${verifyBotLink()}`,
  };
}

function isSkip(text) {
  return SKIP_WORDS.includes(String(text || "").trim().toLowerCase());
}

/** Состояние диалога хранится в БД, чтобы пережить перезапуск сервера. */
function getState(userId) {
  const row = db.prepare("SELECT * FROM bot_dialogs WHERE user_id = ?").get(userId);
  if (!row) return null;
  let payload = {};
  try {
    payload = row.payload ? JSON.parse(row.payload) : {};
  } catch {
    payload = {};
  }
  return { step: row.step, payload };
}

function setState(userId, step, payload = {}) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO bot_dialogs (user_id, step, payload, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET step = excluded.step, payload = excluded.payload, updated_at = excluded.updated_at`,
  ).run(userId, step, JSON.stringify(payload), now);
}

function clearState(userId) {
  db.prepare("DELETE FROM bot_dialogs WHERE user_id = ?").run(userId);
}

/** Ссылка на чат с ботом — чтобы владелец не искал его в поиске. */
function chatLink(bot) {
  return `${FRONTEND_URL.replace(/\/$/, "")}/#/chat/${bot.botUserId}`;
}

function botCard(bot, index) {
  const lines = [`${index}. @${bot.username}`];
  if (bot.description) lines.push(`   ${bot.description}`);
  lines.push(`   Чат: ${chatLink(bot)}`);
  return lines.join("\n");
}

function tokenBlock(bot, token) {
  return (
    `Токен бота @${bot.username}:\n${token}\n\n` +
    `Документация по API: ${docsLink(token)}\n` +
    "Никому не передавайте токен: он даёт полный доступ к боту."
  );
}

const HELP =
  "Привет! Я @creatorbot — создаю ботов ИДЕЛЬ.\n\n" +
  "Команды:\n" +
  "/create — создать бота (имя, описание, аватар)\n" +
  "/my_bots — мои боты и меню редактирования\n" +
  "/verify <номер или ник> — заявка на галочку бота (опрос в @verifybot)\n" +
  "/docs <номер> — документация API для бота\n" +
  "/cancel — прервать текущий диалог\n\n" +
  "Имя бота: vasyapupkin_bot, bot_vasyapupkin или vasyapupkinBot.\n" +
  "Бот работает у вас (Python), а с ИДЕЛЬ общается по API: получает сообщения " +
  "через long-polling и отвечает от своего имени.";

function listMessage(userId) {
  const list = bots.listBots(userId);
  if (list.length === 0) {
    return "У вас пока нет ботов. Создайте первого командой /create.";
  }
  return (
    `Ваши боты (${list.length} из ${bots.MAX_BOTS_PER_USER}):\n\n` +
    list.map((bot, index) => botCard(bot, index + 1)).join("\n\n") +
    "\n\nОтправьте номер бота, чтобы открыть меню редактирования."
  );
}

function menuMessage(bot) {
  return (
    `Бот @${bot.username}\n` +
    (bot.description ? `Описание: ${bot.description}\n` : "Описание не задано\n") +
    (bot.avatarUrl ? "Аватар: задан\n" : "Аватар: нет\n") +
    `Чат с ботом: ${chatLink(bot)}\n` +
    "\nЧто сделать?\n" +
    "1 — изменить имя\n" +
    "2 — изменить описание\n" +
    "3 — изменить аватар\n" +
    "4 — показать токен\n" +
    "5 — перевыпустить токен\n" +
    "6 — удалить бота\n" +
    "7 — верифицировать бота (заявка на галочку)\n" +
    "0 — вернуться к списку"
  );
}

function createdMessage(bot, token) {
  return (
    `Бот @${bot.username} создан.\n\n` +
    `Открыть чат с ботом: ${chatLink(bot)}\n\n` +
    tokenBlock(bot, token) +
    "\n\nКак запустить: сохраните токен, скачайте пример из документации и запустите Python-скрипт — " +
    "бот начнёт получать сообщения."
  );
}

/** Разбирает команду с номером бота: /token 2, /edit 2 name Вася, /verify 2. */
function parseBotCommand(text) {
  const match = /^\/(edit|token|newtoken|delete|docs|verify)\s+(\d+)\s*(.*)$/i.exec(String(text || "").trim());
  if (!match) return null;
  return { command: match[1].toLowerCase(), index: match[2], rest: match[3].trim() };
}

/**
 * Главный обработчик сообщений в @creatorbot.
 * @param {string} userId
 * @param {{text: string, imageUrl?: string|null, username?: string}} context
 * @returns {{action: string, message: string}}
 */
function handleCreatorRequest(userId, context = {}) {
  const text = String(context.text || "").trim();
  const lower = text.toLowerCase();
  const state = getState(userId);

  // Отмена диалога доступна всегда.
  if (lower === "/cancel" || lower === "отмена") {
    if (state) clearState(userId);
    return { action: "cancelled", message: "Диалог прерван. Команды: /create, /my_bots." };
  }

  // Явная команда прерывает активный диалог: иначе /docs 1 во время выбора
  // бота воспринимался бы как ответ «нет бота с таким номером».
  const parsedCommand = parseBotCommand(text);
  const simpleCommand =
    ["/start", "/help", "/create", "/my_bots", "/mybots", "начать", "старт", "создать", "мои боты"].includes(lower) ||
    lower.startsWith("/");
  if (state && (parsedCommand || simpleCommand)) {
    clearState(userId);
  } else if (state) {
    return continueDialog(userId, state, context);
  }

  // /verify <имя бота> — верификация по нику (по номеру обрабатывается ниже).
  const verifyByName = /^\/verify\s+(.+)$/i.exec(text);
  if (verifyByName && !parsedCommand) {
    const target = verifyByName[1].trim().replace(/^@/, "").toLowerCase();
    const bot = bots.listBots(userId).find((b) => b.username.toLowerCase() === target);
    if (!bot) {
      return { action: "bot_not_found", message: "У вас нет бота с таким ником. /my_bots — список." };
    }
    return startBotVerification(userId, bot);
  }
  if (lower === "/verify") {
    return { action: "verify_usage", message: "Формат: /verify <номер или ник бота> (например, /verify 1 или /verify vasyapupkin_bot)." };
  }

  // 1. Команды с параметрами.
  const parsed = parsedCommand;
  if (parsed) return handleBotCommand(userId, parsed);

  // 3. Простые команды.
  if (lower === "/start" || lower === "/help" || lower === "начать" || lower === "старт") {
    return { action: "help", message: HELP };
  }
  if (lower === "/create" || lower === "создать") {
    if (banSystem.isBanned(userId)) {
      return { action: "banned", message: "Вы заблокированы и не можете создавать ботов." };
    }
    if (bots.countBots(userId) >= bots.MAX_BOTS_PER_USER) {
      return {
        action: "limit",
        message: `Достигнут лимит: не больше ${bots.MAX_BOTS_PER_USER} ботов на аккаунт.`,
      };
    }
    setState(userId, "create_name", {});
    return {
      action: "create_name",
      message:
        "Как назовём бота? Пришлите имя одним сообщением.\n\n" +
        "Допустимые форматы:\n• vasyapupkin_bot\n• bot_vasyapupkin\n• vasyapupkinBot\n\n" +
        "Только латиница, цифры и подчёркивание. Отмена — /cancel.",
    };
  }
  if (lower === "/my_bots" || lower === "/mybots" || lower === "мои боты") {
    const list = bots.listBots(userId);
    if (list.length > 0) setState(userId, "choose_bot", { action: "menu" });
    return { action: "list", message: listMessage(userId) };
  }

  return { action: "help", message: HELP };
}

/** Продолжает диалог по текущему шагу. */
function continueDialog(userId, state, context) {
  const text = String(context.text || "").trim();
  const { step, payload } = state;

  if (step === "create_name") {
    const validation = bots.validateBotName(text);
    if (!validation.ok) {
      return { action: "name_invalid", message: `Так не получится.\n\n${validation.error}` };
    }
    // Занятое имя ловим сразу, чтобы не вести человека через два шага зря.
    if (bots.nameTaken(validation.name)) {
      return {
        action: "name_taken",
        message: `Имя @${validation.name} уже занято. Пришлите другое имя или /cancel.`,
      };
    }
    setState(userId, "create_description", { name: validation.name });
    return {
      action: "create_description",
      message:
        `Имя: @${validation.name}\n\nПришлите описание бота (до 300 символов) ` +
        "или напишите «пропустить».",
    };
  }

  if (step === "create_description") {
    if (!isSkip(text) && !text) {
      return { action: "description_empty", message: "Пришлите описание или «пропустить»." };
    }
    const description = isSkip(text) ? "" : text.slice(0, 300);
    setState(userId, "create_avatar", { name: payload.name, description });
    return {
      action: "create_avatar",
      message:
        (description ? `Описание: ${description}\n\n` : "Описание: без описания\n\n") +
        "Пришлите картинку-аватар (изображение или ссылку на него) либо напишите «пропустить».",
    };
  }

  if (step === "create_avatar") {
    let avatarUrl = null;
    if (!isSkip(text)) {
      if (context.imageUrl) avatarUrl = context.imageUrl;
      else if (/^https?:\/\/\S+$/i.test(text)) avatarUrl = text;
      else {
        return {
          action: "avatar_invalid",
          message: "Не похоже на картинку. Пришлите изображение, ссылку http(s)://… или «пропустить».",
        };
      }
    }

    const result = bots.createBot({
      ownerId: userId,
      rawName: payload.name,
      description: payload.description || "",
      avatarUrl,
    });
    if (!result.ok) {
      setState(userId, "create_name", {});
      return { action: "create_failed", message: `${result.error}\n\nПришлите другое имя или /cancel.` };
    }
    clearState(userId);
    logInfo("Бот создан через @creatorbot", { ownerId: userId, bot: result.bot.username });
    return { action: "created", message: createdMessage(result.bot, result.token) };
  }

  if (step === "choose_bot") {
    const bot = bots.getBotByIndex(userId, text);
    if (!bot) {
      return { action: "bot_not_found", message: "Нет бота с таким номером. Пришлите номер из списка или /cancel." };
    }
    setState(userId, "bot_menu", { botId: bot.id });
    return { action: "menu", message: menuMessage(bot) };
  }

  if (step === "bot_menu") {
    const bot = bots.getBotById(payload.botId);
    if (!bot) {
      clearState(userId);
      return { action: "bot_missing", message: "Этот бот больше не существует. /my_bots — список." };
    }

    if (text === "0") {
      setState(userId, "choose_bot", { action: "menu" });
      return { action: "list", message: `${listMessage(userId)}` };
    }
    if (text === "1") {
      setState(userId, "edit_value", { botId: bot.id, field: "name" });
      return { action: "edit_name", message: "Пришлите новое имя бота (в одном из допустимых форматов)." };
    }
    if (text === "2") {
      setState(userId, "edit_value", { botId: bot.id, field: "description" });
      return { action: "edit_description", message: "Пришлите новое описание (до 300 символов)." };
    }
    if (text === "3") {
      setState(userId, "edit_value", { botId: bot.id, field: "avatar" });
      return { action: "edit_avatar", message: "Пришлите картинку-аватар или ссылку http(s)://…" };
    }
    if (text === "4") {
      const token = bots.revealToken(bot.id);
      clearState(userId);
      return { action: "token", message: tokenBlock(bot, token) };
    }
    if (text === "5") {
      const token = bots.regenerateToken(bot.id);
      clearState(userId);
      return {
        action: "token_rotated",
        message: `Старый токен больше не работает.\n\n${tokenBlock(bot, token)}`,
      };
    }
    if (text === "6") {
      setState(userId, "delete_confirm", { botId: bot.id });
      return {
        action: "delete_confirm",
        message: `Удалить бота @${bot.username}? Он исчезнет вместе с перепиской. Напишите «удалить» для подтверждения.`,
      };
    }
    if (text === "7") {
      clearState(userId);
      return startBotVerification(userId, bot);
    }
    return { action: "menu_unknown", message: `${menuMessage(bot)}` };
  }

  if (step === "delete_confirm") {
    const bot = bots.getBotById(payload.botId);
    if (!bot) {
      clearState(userId);
      return { action: "bot_missing", message: "Бот уже удалён. /my_bots — список." };
    }
    if (text.toLowerCase() !== "удалить" && text.toLowerCase() !== "да") {
      clearState(userId);
      return { action: "delete_cancelled", message: "Удаление отменено. /my_bots — список ботов." };
    }
    bots.deleteBot(bot.id);
    clearState(userId);
    return { action: "deleted", message: `Бот @${bot.username} удалён. /my_bots — список.` };
  }

  if (step === "edit_value") {
    const bot = bots.getBotById(payload.botId);
    if (!bot) {
      clearState(userId);
      return { action: "bot_missing", message: "Этот бот больше не существует. /my_bots — список." };
    }

    if (payload.field === "name") {
      const result = bots.updateBot(bot.id, { name: text });
      if (!result.ok) return { action: "edit_failed", message: `${result.error}\n\nПришлите другое имя или /cancel.` };
      clearState(userId);
      return { action: "edited", message: `Готово: бот теперь @${result.bot.username}. /my_bots — список.` };
    }
    if (payload.field === "description") {
      const result = bots.updateBot(bot.id, { description: text });
      clearState(userId);
      return { action: "edited", message: `Описание бота @${result.bot.username} обновлено.` };
    }
    if (payload.field === "avatar") {
      const avatarUrl = context.imageUrl || (/^https?:\/\/\S+$/i.test(text) ? text : null);
      if (!avatarUrl) {
        return { action: "avatar_invalid", message: "Не похоже на картинку. Пришлите изображение, ссылку или /cancel." };
      }
      const result = bots.updateBot(bot.id, { avatarUrl });
      clearState(userId);
      return { action: "edited", message: `Аватар бота @${result.bot.username} обновлён.` };
    }
  }

  clearState(userId);
  return { action: "help", message: HELP };
}

/** Команды вида /token 2, /edit 2 name Вася. */
function handleBotCommand(userId, { command, index, rest }) {
  const bot = bots.getBotByIndex(userId, index);
  if (!bot) return { action: "bot_not_found", message: "Нет бота с таким номером. /my_bots — список." };

  if (command === "docs") {
    const token = bots.revealToken(bot.id);
    return {
      action: "docs",
      message: `Документация API для @${bot.username}: ${docsLink(token)}`,
    };
  }
  if (command === "token") {
    const token = bots.revealToken(bot.id);
    return { action: "token", message: tokenBlock(bot, token) };
  }
  if (command === "newtoken") {
    const token = bots.regenerateToken(bot.id);
    return { action: "token_rotated", message: `Старый токен больше не работает.\n\n${tokenBlock(bot, token)}` };
  }
  if (command === "delete") {
    setState(userId, "delete_confirm", { botId: bot.id });
    return {
      action: "delete_confirm",
      message: `Удалить бота @${bot.username}? Напишите «удалить» для подтверждения.`,
    };
  }
  if (command === "verify") {
    return startBotVerification(userId, bot);
  }
  if (command === "edit") {
    const [field, ...valueParts] = rest.split(/\s+/);
    const value = valueParts.join(" ").trim();
    const normalized = String(field || "").toLowerCase();
    if (!normalized || !value) {
      return {
        action: "edit_usage",
        message: "Формат: /edit <номер> name|desc|avatar <значение>",
      };
    }
    if (["name", "имя"].includes(normalized)) {
      const result = bots.updateBot(bot.id, { name: value });
      return result.ok
        ? { action: "edited", message: `Готово: бот теперь @${result.bot.username}.` }
        : { action: "edit_failed", message: result.error };
    }
    if (["desc", "description", "описание"].includes(normalized)) {
      const result = bots.updateBot(bot.id, { description: value });
      return { action: "edited", message: `Описание бота @${result.bot.username} обновлено.` };
    }
    if (["avatar", "аватар"].includes(normalized)) {
      const result = bots.updateBot(bot.id, { avatarUrl: value });
      return { action: "edited", message: `Аватар бота @${result.bot.username} обновлён.` };
    }
    return { action: "edit_usage", message: "Поле должно быть name, desc или avatar." };
  }

  return { action: "help", message: HELP };
}

module.exports = {
  handleCreatorRequest,
  getState,
  setState,
  clearState,
  listMessage,
  menuMessage,
  docsLink,
  HELP,
};
