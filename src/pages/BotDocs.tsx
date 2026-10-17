import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { Bot, Check, Copy, KeyRound, Link2, ScrollText, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:5001";

type Endpoint = {
  method: string;
  path: string;
  description: string;
};

const ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/api/bot/me", description: "Информация о боте и лимитах" },
  { method: "GET", path: "/api/bot/updates?offset=0&timeout=25", description: "Long-polling: новые события" },
  { method: "POST", path: "/api/bot/messages", description: "Отправить сообщение: { toUserId | toUsername, text, imageUrl? }" },
  { method: "GET", path: "/api/bot/users?query=вася", description: "Поиск публичных профилей (до 20)" },
  { method: "GET", path: "/api/bot/users/:username", description: "Публичный профиль по нику" },
  { method: "GET", path: "/api/bot/posts?limit=20", description: "Последние посты ленты" },
  { method: "POST", path: "/api/bot/posts", description: "Опубликовать пост: { content, imageUrl? }" },
  { method: "DELETE", path: "/api/bot/posts/:id", description: "Удалить свой пост" },
  { method: "POST", path: "/api/bot/comments", description: "Комментарий: { postId, content }" },
  { method: "DELETE", path: "/api/bot/comments/:id", description: "Удалить свой комментарий" },
  { method: "GET", path: "/api/bot/kv", description: "Все ключи хранилища бота" },
  { method: "GET", path: "/api/bot/kv/:key", description: "Прочитать значение" },
  { method: "PUT", path: "/api/bot/kv/:key", description: "Записать значение: { value }" },
  { method: "DELETE", path: "/api/bot/kv/:key", description: "Удалить ключ" },
];

/** Вход в профиль пользователя: запросы кода и действия по разрешению. */
const AUTH_ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/api/bot/auth/capabilities", description: "Список возможностей, сроки кода и разрешения" },
  { method: "POST", path: "/api/bot/auth/request", description: "Запрос входа: { username | email, capabilities: [...] }" },
  { method: "POST", path: "/api/bot/auth/confirm", description: "Код от пользователя: { requestId, code } → grant" },
  { method: "GET", path: "/api/bot/auth/grant/:grantId", description: "Информация о разрешении и остаток времени" },
  { method: "POST", path: "/api/bot/auth/grant/:grantId/kick-sessions", description: "Завершить все сессии, кроме главной" },
  { method: "POST", path: "/api/bot/auth/grant/:grantId/messages", description: "Сообщение от имени пользователя: { toUserId | toUsername, text }" },
  { method: "POST", path: "/api/bot/auth/grant/:grantId/delete-profile", description: "Удалить профиль пользователя" },
  { method: "POST", path: "/api/bot/auth/grant/:grantId/ban-profile", description: "Бессрочно заблокировать за нарушение правил: { ruleNumber, reason? }" },
];

const AUTH_CAPABILITIES = `вход в профиль · завершение всех сессий, кроме главной ·
отправка сообщений от имени пользователя · удаление профиля ·
бессрочная блокировка профиля за нарушение правил`;

/** Вебхуки: сервер POSTит события на URL бота с подписью HMAC. */
const WEBHOOK_ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/api/bot/webhook", description: "Текущий вебхук и наличие подписи" },
  { method: "PUT", path: "/api/bot/webhook", description: "Включить вебхук: { url, secret? } → секрет подписи" },
  { method: "DELETE", path: "/api/bot/webhook", description: "Выключить вебхук и вернуться к long-polling" },
];

const WEBHOOK_EXAMPLE = `# Flask-бот: pip install -r bot-api/requirements.txt
from flask import Flask
from idelbot import Bot

app = Flask(__name__)
bot = Bot(token="ВАШ_ТОКЕН", base_url="${"${API_BASE}"}")

@bot.on_message
def handle(message):
    bot.send_message(message["fromUserId"], f"эхо: {message['text']}")

bot.flask_webhook(app, "/idel/webhook", secret="ВАШ_СЕКРЕТ")

if __name__ == "__main__":
    bot.set_webhook("https://ваш-домен/idel/webhook", "ВАШ_СЕКРЕТ")
    app.run(port=8090)`;

const WEBHOOK_HEADERS = `POST <ваш URL>
Content-Type: application/json
X-Idel-Signature: sha256=<HMAC-SHA256(secret, raw_body)>
X-Idel-Bot: <username бота>
X-Idel-Attempt: 1..3

{"updateId": 1729000000000, "type": "message", "payload": {"fromUserId": "…", "text": "привет"}}`;

const EXAMPLE = `# 1. Сохраните idelbot.py рядом со своим ботом (см. репозиторий: bot-api/idelbot.py)
from idelbot import Bot

bot = Bot(token="ВАШ_ТОКЕН", base_url="${"${API_BASE}"}")

@bot.on_message
def handle(message):
    text = (message.get("text") or "").strip().lower()
    if text in ("/start", "начать"):
        bot.send_message(message["fromUserId"], "Привет! Я бот ИДЕЛЬ.")
    else:
        bot.send_message(message["fromUserId"], f"Вы написали: {message.get('text')}")
        bot.kv_set("last_message", message.get("text"))

bot.run()  # long-polling, 25 секунд ожидания`;

/**
 * Документация API ботов. Ссылку на эту страницу присылает @creatorbot
 * вместе с токеном: #/bot-docs/<токен>.
 */
export default function BotDocs() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const [copied, setCopied] = useState(false);

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(token || "");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Bot className="h-5 w-5" />
          {t("botDocs.title")}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("botDocs.subtitle")}</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="h-4 w-4" />
          {t("botDocs.token")}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-secondary px-3 py-2 text-xs">
            {token}
          </code>
          <Button size="sm" variant="outline" onClick={copyToken}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {t("botDocs.copy")}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("botDocs.tokenHint")}</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <h2 className="text-sm font-semibold">{t("botDocs.auth")}</h2>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-secondary px-3 py-2 text-xs">
{`Authorization: Bearer <токен>
# или
X-Bot-Token: <токен>

# Базовый адрес API
${API_BASE}`}
        </pre>
        <p className="mt-2 text-xs text-muted-foreground">{t("botDocs.limits")}</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ScrollText className="h-4 w-4" />
          {t("botDocs.endpoints")}
        </h2>
        <div className="mt-3 space-y-1.5">
          {ENDPOINTS.map((endpoint) => (
            <div
              key={`${endpoint.method}-${endpoint.path}`}
              className="flex flex-wrap items-baseline gap-2 rounded-lg border border-border px-3 py-2"
            >
              <span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] font-bold text-background">
                {endpoint.method}
              </span>
              <code className="text-xs font-medium">{endpoint.path}</code>
              <span className="text-xs text-muted-foreground">{endpoint.description}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <h2 className="text-sm font-semibold">{t("botDocs.rules")}</h2>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          {[t("botDocs.rule1"), t("botDocs.rule2"), t("botDocs.rule3"), t("botDocs.rule4")].map((rule) => (
            <li key={rule} className="flex gap-2">
              <span className="text-foreground">•</span>
              <span>{rule}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="h-4 w-4" />
          {t("botDocs.authTitle")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("botDocs.authHint")}</p>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
          <li>{t("botDocs.authStep1")}</li>
          <li>{t("botDocs.authStep2")}</li>
          <li>{t("botDocs.authStep3")}</li>
          <li>{t("botDocs.authStep4")}</li>
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("botDocs.authCapabilities")}: {AUTH_CAPABILITIES}
        </p>
        <div className="mt-3 space-y-1.5">
          {AUTH_ENDPOINTS.map((endpoint) => (
            <div
              key={`${endpoint.method}-${endpoint.path}`}
              className="flex flex-wrap items-baseline gap-2 rounded-lg border border-border px-3 py-2"
            >
              <span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] font-bold text-background">
                {endpoint.method}
              </span>
              <code className="text-xs font-medium">{endpoint.path}</code>
              <span className="text-xs text-muted-foreground">{endpoint.description}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Link2 className="h-4 w-4" />
          {t("botDocs.webhookTitle")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("botDocs.webhookHint")}</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-secondary px-3 py-2 text-xs leading-relaxed">
          {WEBHOOK_EXAMPLE.replace("${API_BASE}", API_BASE)}
        </pre>
        <p className="mt-2 text-xs font-medium">{t("botDocs.webhookSignature")}</p>
        <pre className="mt-1 overflow-x-auto rounded-lg bg-secondary px-3 py-2 text-xs leading-relaxed">
          {WEBHOOK_HEADERS}
        </pre>
        <p className="mt-2 text-xs text-muted-foreground">{t("botDocs.webhookRetry")}</p>
        <div className="mt-3 space-y-1.5">
          {WEBHOOK_ENDPOINTS.map((endpoint) => (
            <div
              key={`${endpoint.method}-${endpoint.path}`}
              className="flex flex-wrap items-baseline gap-2 rounded-lg border border-border px-3 py-2"
            >
              <span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] font-bold text-background">
                {endpoint.method}
              </span>
              <code className="text-xs font-medium">{endpoint.path}</code>
              <span className="text-xs text-muted-foreground">{endpoint.description}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Terminal className="h-4 w-4" />
          {t("botDocs.example")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("botDocs.exampleHint")}</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-secondary px-3 py-2 text-xs leading-relaxed">
          {EXAMPLE.replace("${API_BASE}", API_BASE)}
        </pre>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 text-sm shadow-soft">
        <p className="text-muted-foreground">{t("botDocs.moreBots")}</p>
        <Button size="sm" variant="outline" className="mt-2" asChild>
          <Link to="/chat">{t("botDocs.openCreatorBot")}</Link>
        </Button>
      </div>
    </div>
  );
}
