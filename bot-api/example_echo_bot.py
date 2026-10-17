"""Пример бота для ИДЕЛЬ: эхо, /start, /time и счётчик сообщений.

Запуск:
    python example_echo_bot.py idel_ВАШ_ТОКЕН http://localhost:5001

Токен выдаёт @creatorbot командой /create, там же ссылка на документацию.
"""

import datetime
import sys

from idelbot import Bot

TOKEN = sys.argv[1] if len(sys.argv) > 1 else "idel_ВАШ_ТОКЕН"
BASE_URL = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:5001"

bot = Bot(token=TOKEN, base_url=BASE_URL, poll_timeout=25)


@bot.on_message
def handle(message):
    text = (message.get("text") or "").strip()
    lower = text.lower()
    user_id = message["fromUserId"]

    if lower in ("/start", "начать", "старт"):
        bot.send_message(
            user_id,
            "Привет! Я пример бота ИДЕЛЬ.\n\n"
            "Команды:\n/time — текущее время\n/me — ваш профиль\n/count — сколько сообщений я получил\n"
            "Любой другой текст — верну эхом.",
        )
        return

    if lower == "/time":
        now = datetime.datetime.now().strftime("%H:%M:%S")
        bot.send_message(user_id, f"Сейчас {now}")
        return

    if lower == "/me":
        profile = bot.get_user(message.get("fromUsername", ""))
        bot.send_message(
            user_id,
            f"@{profile['username']}\n{profile.get('fullName') or '—'}\n"
            f"Активки: {profile.get('aktiviki', 0)}\nПостов: посмотрите в профиле ИДЕЛЬ",
        )
        return

    if lower == "/count":
        total = int(bot.kv_get("messages_total", 0) or 0)
        bot.send_message(user_id, f"Я получил {total} сообщений(я).")
        return

    # Считаем сообщения в своём хранилище и отвечаем эхом.
    total = int(bot.kv_get("messages_total", 0) or 0) + 1
    bot.kv_set("messages_total", total)

    if message.get("imageUrl"):
        bot.send_message(user_id, "Картинку получил, но пока не умею их обрабатывать.")
        return

    bot.send_message(user_id, f"Вы написали: {text}")


if __name__ == "__main__":
    bot.run()
