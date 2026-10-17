"""Клиент API ИДЕЛЬ для ботов: requests + вебхуки Flask.

Зависимости: requests (обязательно), flask (только для вебхук-режима).

Два режима доставки событий:
  1. Long-polling (bot.run()) — бот сам опрашивает сервер.
  2. Вебхук — бот поднимает HTTP-сервер (Flask), сервер POSTит события на него
     с подписью HMAC-SHA256. Включается bot.set_webhook(url).

    from idelbot import Bot

    bot = Bot(token="idel_...", base_url="http://localhost:5001")

    @bot.on_message
    def handle(message):
        bot.send_message(message["fromUserId"], "привет!")

    bot.run()  # polling
"""

import hashlib
import hmac
import json
import time

import requests

DEFAULT_BASE_URL = "http://localhost:5001"
DEFAULT_POLL_TIMEOUT = 25


class BotError(Exception):
    """Ошибка API: HTTP-статус и текст ответа."""

    def __init__(self, status, message):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status
        self.message = message


class Bot:
    def __init__(self, token, base_url=DEFAULT_BASE_URL, poll_timeout=DEFAULT_POLL_TIMEOUT, request_timeout=40):
        if not token:
            raise ValueError("Нужен токен бота: его выдаёт @creatorbot")
        self.token = token
        self.base_url = base_url.rstrip("/")
        self.poll_timeout = poll_timeout
        self.request_timeout = request_timeout
        self.offset = 0
        self._message_handlers = []
        self._handlers = {}
        self.session = requests.Session()
        self.session.headers.update(
            {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        )

    # ------------------------------------------------------------------ HTTP

    def _request(self, method, path, payload=None, timeout=None):
        url = f"{self.base_url}{path}"
        try:
            response = self.session.request(
                method, url, json=payload, timeout=timeout or self.request_timeout
            )
        except requests.RequestException as error:
            raise BotError(0, f"нет связи с {url}: {error}") from None

        if response.status_code >= 400:
            try:
                data = response.json()
                message = data.get("error") or response.text
                code = data.get("code")
            except ValueError:
                message = response.text
                code = None
            error = BotError(response.status_code, message)
            error.code = code
            raise error

        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError:
            return {}

    def get(self, path, timeout=None):
        return self._request("GET", path, timeout=timeout)

    def post(self, path, payload=None, timeout=None):
        return self._request("POST", path, payload or {}, timeout=timeout)

    def put(self, path, payload=None):
        return self._request("PUT", path, payload or {})

    def delete(self, path):
        return self._request("DELETE", path)

    # ------------------------------------------------------------- декораторы

    def on_message(self, handler):
        """Регистрирует обработчик входящих сообщений."""
        self._message_handlers.append(handler)
        return handler

    def on(self, update_type, handler):
        """Регистрирует обработчик произвольного типа события."""
        self._handlers.setdefault(update_type, []).append(handler)
        return handler

    # -------------------------------------------------------------- действия

    def me(self):
        return self.get("/api/bot/me")["bot"]

    def updates(self, offset=None, timeout=None):
        offset = self.offset if offset is None else offset
        timeout = self.poll_timeout if timeout is None else timeout
        return self.get(f"/api/bot/updates?offset={offset}&timeout={timeout}", timeout=timeout + 15)

    def send_message(self, to_user_id, text, image_url=None, to_username=None):
        """Отправляет сообщение. Бот может писать только тем, кто написал ему."""
        payload = {"text": text or ""}
        if to_user_id:
            payload["toUserId"] = to_user_id
        if to_username:
            payload["toUsername"] = to_username
        if image_url:
            payload["imageUrl"] = image_url
        return self.post("/api/bot/messages", payload)["message"]

    def find_users(self, query=""):
        return self.get(f"/api/bot/users?query={requests.utils.quote(query)}")["users"]

    def get_user(self, username):
        return self.get(f"/api/bot/users/{requests.utils.quote(username)}")["user"]

    def get_posts(self, limit=20):
        return self.get(f"/api/bot/posts?limit={limit}")["posts"]

    def create_post(self, content, image_url=None):
        return self.post("/api/bot/posts", {"content": content, "imageUrl": image_url})["post"]

    def delete_post(self, post_id):
        return self.delete(f"/api/bot/posts/{post_id}")

    def create_comment(self, post_id, content):
        return self.post("/api/bot/comments", {"postId": post_id, "content": content})["comment"]

    def delete_comment(self, comment_id):
        return self.delete(f"/api/bot/comments/{comment_id}")

    def kv_get(self, key, default=None):
        try:
            return self.get(f"/api/bot/kv/{requests.utils.quote(key)}")["value"]
        except BotError as error:
            if error.status == 404:
                return default
            raise

    def kv_set(self, key, value):
        return self.put(f"/api/bot/kv/{requests.utils.quote(key)}", {"value": value})

    def kv_delete(self, key):
        return self.delete(f"/api/bot/kv/{requests.utils.quote(key)}")

    def kv_all(self):
        return self.get("/api/bot/kv")["items"]

    # ------------------------------------------------- вход в профиль (по коду)

    def auth_capabilities(self):
        """Список возможностей и сроки действия кода/разрешения."""
        return self.get("/api/bot/auth/capabilities")

    def request_login(self, username=None, email=None, capabilities=None):
        """Просит доступ к аккаунту. Код придёт в @resendcode_bot или на почту."""
        payload = {"capabilities": capabilities or ["login"]}
        if username:
            payload["username"] = username
        if email:
            payload["email"] = email
        return self.post("/api/bot/auth/request", payload)["request"]

    def confirm_login(self, request_id, code):
        """Подтверждает код, полученный пользователем."""
        return self.post("/api/bot/auth/confirm", {"requestId": request_id, "code": code})["grant"]

    def grant(self, grant_id):
        return self.get(f"/api/bot/auth/grant/{requests.utils.quote(grant_id)}")["grant"]

    def kick_sessions(self, grant_id):
        """Завершает все сессии пользователя, кроме главной и сессии бота."""
        return self.post(f"/api/bot/auth/grant/{requests.utils.quote(grant_id)}/kick-sessions")

    def send_as_user(self, grant_id, text="", to_user_id=None, to_username=None, image_url=None):
        """Пишет сообщение от имени пользователя по подтверждённому разрешению."""
        payload = {"text": text}
        if to_user_id:
            payload["toUserId"] = to_user_id
        if to_username:
            payload["toUsername"] = to_username
        if image_url:
            payload["imageUrl"] = image_url
        return self.post(
            f"/api/bot/auth/grant/{requests.utils.quote(grant_id)}/messages", payload
        )

    def delete_profile_as_user(self, grant_id):
        """Удаляет профиль пользователя (жёстко, с журналом)."""
        return self.post(f"/api/bot/auth/grant/{requests.utils.quote(grant_id)}/delete-profile")

    def ban_profile_as_user(self, grant_id, rule_number=None, reason=None):
        """Бессрочно блокирует профиль за нарушение правил платформы."""
        payload = {}
        if rule_number is not None:
            payload["ruleNumber"] = rule_number
        if reason:
            payload["reason"] = reason
        return self.post(
            f"/api/bot/auth/grant/{requests.utils.quote(grant_id)}/ban-profile", payload
        )

    # ---------------------------------------------------------------- вебхуки

    def set_webhook(self, url, secret=None):
        """Включает вебхук-режим: события приходят POST-запросами на url."""
        payload = {"url": url}
        if secret:
            payload["secret"] = secret
        return self.put("/api/bot/webhook", payload)["webhook"]

    def delete_webhook(self):
        """Возвращает long-polling."""
        return self.delete("/api/bot/webhook")

    def webhook_info(self):
        return self.get("/api/bot/webhook")["webhook"]

    @staticmethod
    def verify_signature(secret, body, signature_header):
        """Проверяет подпись X-Idel-Signature (HMAC-SHA256 от тела запроса)."""
        if not secret or not signature_header:
            return False
        expected = "sha256=" + hmac.new(
            secret.encode("utf-8"), body, hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(expected, signature_header)

    def handle_update(self, update):
        """Раздаёт одно событие обработчикам (используется и polling, и вебхуком)."""
        if not update:
            return
        update_type = update.get("type")
        try:
            if update.get("updateId") is not None:
                self.offset = update["updateId"]
        except (TypeError, KeyError):
            pass

        handlers = list(self._handlers.get(update_type, []))
        if update_type == "message":
            handlers += self._message_handlers
        for handler in handlers:
            try:
                handler(update.get("payload") or {})
            except Exception as error:  # noqa: BLE001 — падение обработчика не роняет бота
                print(f"Ошибка в обработчике: {error}")

    def flask_webhook(self, app, path="/idel/webhook", secret=None):
        """Регистрирует во Flask маршрут вебхука с проверкой подписи.

        Если secret не задан, подпись не проверяется (только для отладки).
        """
        from flask import jsonify, request

        @app.post(path)
        def _idel_webhook():  # pragma: no cover - выполняется в приложении бота
            raw = request.get_data() or b"{}"
            if secret and not Bot.verify_signature(
                secret, raw, request.headers.get("X-Idel-Signature", "")
            ):
                return jsonify({"error": "bad signature"}), 401
            try:
                update = json.loads(raw)
            except ValueError:
                return jsonify({"error": "bad json"}), 400
            self.handle_update(update)
            return jsonify({"ok": True})

        return _idel_webhook

    # ---------------------------------------------------------------- polling

    def run(self, poll_timeout=None):
        """Бесконечный long-polling: получает события и раздаёт обработчикам."""
        if poll_timeout is not None:
            self.poll_timeout = poll_timeout
        print(f"Бот запущен: {self.me()['username']} @ {self.base_url} (long-polling)")
        while True:
            try:
                batch = self.updates(timeout=self.poll_timeout)
            except BotError as error:
                if error.status == 429:
                    time.sleep(2)
                    continue
                if error.status == 401:
                    raise SystemExit(
                        "Токен недействителен — перевыпустите его в @creatorbot"
                    ) from None
                print(f"Ошибка опроса: {error}")
                time.sleep(3)
                continue

            for update in batch.get("updates", []):
                self.handle_update(update)