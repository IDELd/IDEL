// Логика бота @premiumbot — подписка ИДЕЛЬ ПРЕМИУМ.
//
// Команды:
//   /trial  — активировать разовый пробный период на 3 дня (один раз на аккаунт)
//   /status — показать состояние подписки
//   /start  — приветствие и список команд
//
// Подписку на срок выдаёт и снимает только администрация в админ-панели.

const premium = require("./premium");
const { logInfo } = require("../utils/logger");

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function daysLeft(iso) {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return diff > 0 ? Math.max(1, Math.ceil(diff / (24 * 60 * 60 * 1000))) : 0;
}

const WHAT_IT_GIVES =
  "Что даёт ИДЕЛЬ ПРЕМИУМ:\n" +
  "• персиковый значок перед ником и переливающийся персиковый ник;\n" +
  "• свой цвет подложки в сообщениях, комментариях и постах;\n" +
  "• расшифровка голосовых комментариев, записанных в ИДЕЛЬ.";

const HELP =
  "Привет! Я @premiumbot — отвечаю за подписку ИДЕЛЬ ПРЕМИУМ.\n\n" +
  "Команды:\n" +
  "/trial — активировать разовый пробный период на 3 дня\n" +
  "/status — показать состояние подписки\n\n" +
  "Подписку на срок выдаёт администрация.";

function describeSubscription(state) {
  if (!state?.premium) return "Подписки нет.";
  if (state.permanent) return "Подписка активна бессрочно.";
  const left = daysLeft(state.until);
  return `Подписка активна до ${formatDate(state.until)}${left ? ` (осталось ${left} дн.)` : ""}.`;
}

function statusMessage(state) {
  const lines = [describeSubscription(state)];
  if (state?.premium) {
    lines.push(state.messageColor ? `Цвет подложки: ${state.messageColor}.` : "Цвет подложки не выбран — меняется в настройках профиля.");
    lines.push("");
    lines.push(WHAT_IT_GIVES);
  } else {
    lines.push(
      state?.trialUsed
        ? "Разовый пробный период уже использован — подписку выдаёт только администрация."
        : `Доступен разовый пробный период на ${premium.TRIAL_DAYS} дня — команда /trial.`,
    );
  }
  return lines.join("\n");
}

/**
 * Обрабатывает сообщение пользователя в @premiumbot.
 * @returns {{action: string, message: string}}
 */
function handlePremiumRequest(userId, incomingText) {
  const text = String(incomingText || "").trim().toLowerCase();
  const state = premium.getState(userId);
  if (!state) return { action: "error", message: "Не удалось определить аккаунт. Попробуйте позже." };

  if (text === "/start" || text === "начать" || text === "старт") {
    return { action: "help", message: HELP };
  }

  if (text === "/status" || text.includes("статус")) {
    return { action: "status", message: statusMessage(state) };
  }

  if (text === "/trial" || text.includes("триал") || text.includes("попроб")) {
    const result = premium.grantTrial(userId);

    if (result.ok) {
      logInfo("Триал активирован через @premiumbot", { userId, until: result.until });
      return {
        action: "trial_granted",
        message:
          `Пробный период активирован на ${result.days} дня — до ${formatDate(result.until)}.\n\n` +
          WHAT_IT_GIVES,
      };
    }
    if (result.reason === "used") {
      return {
        action: "trial_used",
        message:
          "Разовый пробный период уже использован — второй раз он не выдаётся.\n\n" +
          "Подписку на срок выдаёт администрация.",
      };
    }
    if (result.reason === "already_premium") {
      return {
        action: "already_premium",
        message: `У вас уже есть подписка: ${describeSubscription(state)}`,
      };
    }
    return { action: "error", message: "Не удалось активировать пробный период. Попробуйте позже." };
  }

  // Всё остальное — приветствие вместе с текущим статусом.
  return { action: "help", message: `${HELP}\n\n${statusMessage(state)}` };
}

module.exports = { handlePremiumRequest, describeSubscription, statusMessage, HELP };
