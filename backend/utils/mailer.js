// Почта проекта: подтверждение регистрации, коды входа ботов, сброс пароля.
//
// SMTP настраивается через backend/.env: SMTP_HOST, SMTP_PORT, SMTP_USER,
// SMTP_PASS, SMTP_FROM. Если креденшелы не заданы (локальная разработка),
// письма не отправляются, а ссылка/код пишутся в консоль — так сценарий можно
// проверить полностью.

const nodemailer = require("nodemailer");
const { logInfo, logWarn } = require("./logger");

let transporter = null;

function isMailerConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (transporter) return transporter;
  if (!isMailerConfigured()) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return transporter;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

/**
 * Универсальная отправка письма. Без SMTP — пишет в консоль и возвращает
 * delivered:false, чтобы вызывающий код мог показать подсказку в dev-режиме.
 */
async function sendMail({ to, subject, text, html, consoleHint }) {
  if (!to) return { delivered: false, reason: "no_recipient" };
  const t = getTransporter();
  if (!t) {
    // eslint-disable-next-line no-console
    console.log(`\n[mailer] SMTP не настроен (см. backend/.env). Письмо для ${to}: ${subject}\n${consoleHint || text}\n`);
    return { delivered: false, reason: "smtp_not_configured" };
  }
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || "ИДЕЛЬ <no-reply@idel.app>",
      to,
      subject,
      text,
      html,
    });
    logInfo("Письмо отправлено", { to, subject });
    return { delivered: true };
  } catch (error) {
    logWarn("Не удалось отправить письмо", { to, subject, error: String(error) });
    // eslint-disable-next-line no-console
    console.log(`[mailer] Ошибка SMTP. Резервный вывод для ${to}:\n${consoleHint || text}\n`);
    return { delivered: false, reason: "send_failed" };
  }
}

/** Письмо-подтверждение регистрации. */
async function sendConfirmationEmail(to, username, confirmLink) {
  const subject = "Подтверждение регистрации в ИДЕЛЬ";
  const text = `Привет, ${username}!\n\nПерейдите по ссылке, чтобы подтвердить аккаунт:\n${confirmLink}\n\nЕсли вы не регистрировались в ИДЕЛЬ, просто проигнорируйте это письмо.`;
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Подтверждение регистрации в ИДЕЛЬ</h2>
      <p>Привет, <b>${escapeHtml(username)}</b>!</p>
      <p>Перейдите по ссылке, чтобы подтвердить аккаунт:</p>
      <p><a href="${confirmLink}" style="display:inline-block;padding:10px 18px;background:#000;color:#fff;border-radius:8px;text-decoration:none;">Подтвердить аккаунт</a></p>
      <p style="color:#666;font-size:12px;">Если кнопка не работает, скопируйте эту ссылку: ${confirmLink}</p>
    </div>`;
  return sendMail({ to, subject, text, html, consoleHint: confirmLink });
}

/** Письмо с кодом входа в аккаунт по запросу бота. */
async function sendBotCodeEmail({ to, username, botUsername, capabilities, code }) {
  const subject = `Код входа в ИДЕЛЬ: бот @${botUsername}`;
  const text =
    `ВНИМАНИЕ!!! В Ваш аккаунт пытается войти: @${botUsername}!\n` +
    `Этот бот может: ${capabilities}.\n` +
    `Вот ваш код для входа: ${code}.\n\n` +
    "Никому не сообщайте код. Если это не вы — проигнорируйте письмо и завершите сессии в настройках.";
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>ВНИМАНИЕ!!! В Ваш аккаунт пытается войти</h2>
      <p>Бот: <b>@${escapeHtml(botUsername)}</b></p>
      <p>Этот бот может: ${escapeHtml(capabilities)}</p>
      <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px; margin: 18px 0;">${escapeHtml(code)}</p>
      <p style="color:#666;font-size:12px;">Никому не сообщайте код. Если это не вы — проигнорируйте письмо и завершите сессии в настройках ИДЕЛЬ.</p>
      <p style="color:#666;font-size:12px;">Привет, ${escapeHtml(username || "")}!</p>
    </div>`;
  return sendMail({ to, subject, text, html, consoleHint: `код ${code}` });
}

/** Письмо со ссылкой сброса пароля. */
async function sendPasswordResetEmail({ to, username, resetLink }) {
  const subject = "Сброс пароля в ИДЕЛЬ";
  const text = `Привет, ${username}!\n\nЧтобы задать новый пароль, перейдите по ссылке:\n${resetLink}\n\nСсылка действует 30 минут. Если вы не запрашивали сброс — просто проигнорируйте письмо: пароль останется прежним.`;
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2>Сброс пароля в ИДЕЛЬ</h2>
      <p>Привет, <b>${escapeHtml(username)}</b>!</p>
      <p>Чтобы задать новый пароль, нажмите кнопку:</p>
      <p><a href="${resetLink}" style="display:inline-block;padding:10px 18px;background:#000;color:#fff;border-radius:8px;text-decoration:none;">Задать новый пароль</a></p>
      <p style="color:#666;font-size:12px;">Ссылка действует 30 минут. Если кнопка не работает, скопируйте её: ${resetLink}</p>
      <p style="color:#666;font-size:12px;">Если вы не запрашивали сброс — пароль останется прежним.</p>
    </div>`;
  return sendMail({ to, subject, text, html, consoleHint: resetLink });
}

module.exports = {
  isMailerConfigured,
  sendMail,
  sendConfirmationEmail,
  sendBotCodeEmail,
  sendPasswordResetEmail,
};