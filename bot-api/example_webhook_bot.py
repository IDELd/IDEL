"""Бот на Flask + вебхуках (рекомендуемый режим).

Сервер ИДЕЛЬ сам присылает события POST-запросом на /webhook с подписью
HMAC-SHA256 в заголовке X-Idel-Signature — бот не опрашивает API в цикле.

Запуск:
    pip install -r requirements.txt
    set IDEL_BOT_TOKEN=idel_...
    set IDEL_API_URL=http://localhost:5001
    set IDEL_PUBLIC_URL=http://localhost:8090
    python example_webhook_bot.py

Для продакшена IDEL_PUBLIC_URL должен быть публичным (https), иначе сервер
ИДЕЛЬ не достучится до вашего бота.
"""

import json
import os

from flask import Flask, jsonify, request

from idelbot import Bot

TOKEN = os.environ.get("IDEL_BOT_TOKEN", "idel_ВАШ_ТОКЕН")
API_URL = os.environ.get("IDEL_API_URL", "http://localhost:5001")
PUBLIC_URL = os.environ.get("IDEL_PUBLIC_URL", "http://localhost:8090")
# Секрет для проверки подписи. Если не задан — сервер сгенерирует его при
# установке вебхука и вернёт один раз (сохраните его).
SECRET = os.environ.get("IDEL_WEBHOOK_SECRET")

app = Flask(__name__)
bot = Bot(token=TOKEN, base_url=API_URL)


@bot.on_message
def handle(message):
    text = (message.get("text") or "").strip()
    user_id = message["fromUserId"]

    if text.lower() in ("/start", "начать"):
        bot.send_message(
            user_id,
            "Привет! Я пример бота ИДЕЛЬ на Flask + вебхуках.\n\n"
            "Любой текст — верну эхом. /whoami — покажу ваш профиль.",
        )
        return

    if text.lower() == "/whoami":
        try:
            profile = bot.get_user(message.get("fromUsername", ""))
        except Exception as error:  # noqa: BLE001
            bot.send_message(user_id, f"Не удалось получить профиль: {error}")
            return
        bot.send_message(
            user_id,
            f"@{profile['username']}\n{profile.get('fullName') or '—'}\n"
            f"Галочка: {profile.get('badgeLevel', 0)}\nРанг: {profile.get('reputation', '—')}",
        )
        return

    bot.kv_set("last_message", text)
    bot.send_message(user_id, f"эхо (вебхук): {text}")


@app.get("/health")
def health():
    return jsonify({"ok": True})


@app.post("/webhook")
def webhook():
    raw = request.get_data() or b"{}"
    signature = request.headers.get("X-Idel-Signature", "")
    if SECRET and not bot.verify_signature(SECRET, raw, signature):
        return jsonify({"error": "bad signature"}), 401
    try:
        update = json.loads(raw)
    except ValueError:
        return jsonify({"error": "bad json"}), 400
    bot.handle_update(update)
    return jsonify({"ok": True})


def main():
    hook = bot.set_webhook(f"{PUBLIC_URL}/webhook", SECRET)
    print("Вебхук установлен:", hook)
    print(f"События приходят на {PUBLIC_URL}/webhook")
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8090")))


if __name__ == "__main__":
    main()
