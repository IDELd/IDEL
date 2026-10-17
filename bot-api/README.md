# API ботов ИДЕЛЬ

Бот создаётся в **@creatorbot** (команда `/create`): бот присылает API-токен и
ссылку на документацию. Сам код бота работает **у вас** и общается с ИДЕЛЬ по
HTTP — сервер не исполняет чужой код.

## Файлы

| Файл | Назначение |
|---|---|
| `idelbot.py` | клиент API на `requests` + вебхуки Flask |
| `example_echo_bot.py` | пример на long-polling: эхо, `/start`, `/time`, `/me`, `/count` |
| `example_webhook_bot.py` | пример на Flask + вебхуках (рекомендуемый режим) |
| `requirements.txt` | зависимости: `requests`, `flask` |

## Установка

```bash
cd bot-api
pip install -r requirements.txt
```

## Запуск примеров

```bash
# long-polling
python example_echo_bot.py idel_ВАШ_ТОКЕН http://localhost:5001

# вебхуки (Flask): сервер сам присылает события на /webhook
set IDEL_BOT_TOKEN=idel_ВАШ_ТОКЕН
set IDEL_API_URL=http://localhost:5001
set IDEL_PUBLIC_URL=http://localhost:8090
python example_webhook_bot.py
```

## Свой бот

```python
from idelbot import Bot

bot = Bot(token="idel_...", base_url="http://localhost:5001")

@bot.on_message
def handle(message):
    bot.send_message(message["fromUserId"], f"эхо: {message['text']}")

bot.run()          # long-polling, ожидание 25 секунд
```

## Вебхуки (Flask) — рекомендуемый режим

```python
from flask import Flask
from idelbot import Bot

app = Flask(__name__)
bot = Bot(token="idel_...", base_url="http://localhost:5001")

@bot.on_message
def handle(message):
    bot.send_message(message["fromUserId"], f"эхо: {message['text']}")

# Регистрирует POST /idel/webhook с проверкой подписи
bot.flask_webhook(app, "/idel/webhook", secret="ВАШ_СЕКРЕТ")

if __name__ == "__main__":
    bot.set_webhook("https://ваш-домен/idel/webhook", "ВАШ_СЕКРЕТ")
    app.run(port=8090)
```

Сервер отправляет `POST` с JSON-телом события и заголовками:

```
X-Idel-Signature: sha256=<HMAC-SHA256(secret, raw_body)>
X-Idel-Bot: <username бота>
X-Idel-Attempt: 1..3
```

Если вебхук не ответил 2xx, сервер повторяет попытку (3 попытки), а затем
кладёт событие в очередь long-polling — бот сможет забрать его через
`bot.updates()`. `DELETE /api/bot/webhook` возвращает polling.

Подпись проверяется так:

```python
raw = request.get_data()
ok = bot.verify_signature(secret, raw, request.headers.get("X-Idel-Signature", ""))
```

## Авторизация

```
Authorization: Bearer <токен>
# или
X-Bot-Token: <токен>
```

## Лимиты

* 60 запросов в минуту на бота;
* 20 сообщений в минуту.

При превышении — `429` и заголовок `Retry-After`.

## Правила

* Отвечать можно только тем, кто написал боту первым (защита от рассылок).
* Прав модератора у ботов нет: варны, баны и верификацию они не выдают.
* Подписка, галочки и удаление аккаунтов — только через обычный API администрации.

## Хранилище

`kv_get` / `kv_set` / `kv_delete` — своё ключ-значение на каждого бота, чтобы
помнить состояние между запусками (до 10 000 символов на значение).

## Перевыпуск токена

`/my_bots` → номер бота → пункт 5 (или `/newtoken <номер>`). Старый токен
перестаёт работать сразу.

## Вход в профиль пользователя по коду

Бот может запросить доступ к аккаунту. Код подтверждения приходит пользователю
**в чат с @resendcode_bot** (не на почту — доставка на почту появится позже),
где указано, какой бот просит доступ и что он сможет делать.

```python
# 1. Запрос доступа: ник (или почта) и нужные возможности
request = bot.request_login(
    username="vasya",
    capabilities=["login", "kick_sessions", "send_message", "delete_profile", "ban_profile"],
)
print("Попросите пользователя прислать код из чата с @resendcode_bot")

# 2. Пользователь передаёт код боту, бот подтверждает
grant = bot.confirm_login(request["id"], "123456")
grant_id = grant["id"]          # разрешение живёт 30 минут

# 3. Действия по разрешению
bot.kick_sessions(grant_id)                                   # все сессии, кроме главной
bot.send_as_user(grant_id, to_user_id="...", text="Привет")   # сообщение от имени пользователя
bot.ban_profile_as_user(grant_id, rule_number=9)              # бессрочная блокировка
bot.delete_profile_as_user(grant_id)                          # удаление профиля
```

Возможности (`capabilities`):

| Ключ | Что даёт |
|---|---|
| `login` | вход в профиль (обязательно) |
| `kick_sessions` | завершить все сессии, кроме главной |
| `send_message` | писать в чаты от имени пользователя |
| `delete_profile` | удалить профиль |
| `ban_profile` | бессрочная блокировка за нарушение правил |

Защита:
* код действует 10 минут, неверных попыток — 3;
* разрешение — 30 минут и только для объявленных возможностей;
* пользователь видит сессию «Вход через бота @x» в настройках; если её
  завершить, разрешение отзывается;
* вход в аккаунт администрации и в аккаунты ботов запрещён;
* всё пишется в `logs/Obshiy_log.txt`.
