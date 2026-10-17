# Деплой ИДЕЛЬ

> **Нужен бесплатный хостинг, который всегда включён?** Смотрите
> [DEPLOY-FREE.md](DEPLOY-FREE.md) — бесплатная ВМ (Oracle Cloud Always Free /
> GCP e2-micro) + Docker + автоматический HTTPS. Схема ниже — платный Render
> (проще, но ~$7/мес).

Схема: **фронтенд — GitHub Pages** (статика), **бэкенд — Render** (Docker),
**медиа и часть данных — Supabase**, **письма — SMTP**.

```
GitHub Pages (React)  ──HTTPS──▶  Render (Express API)  ──▶  SQLite на диске /data
                                          │
                                          ├──▶ Supabase Storage (картинки/видео/голосовые)
                                          ├──▶ Supabase Postgres (премиум, описания)
                                          └──▶ SMTP (подтверждение, коды, сброс пароля)
```

## 1. Supabase

1. Создайте проект на supabase.com.
2. Storage → **New bucket** → имя `media`, **Public bucket = ON**
   (аватарки и обложки остаются на бэкенде, туда не грузятся).
3. SQL Editor → выполните `supabase/schema.sql` (таблицы `idel_premium`,
   `idel_profiles` для зеркала премиума и описаний).
4. Project Settings → API: скопируйте **Project URL** и **service_role key**
   (это секрет сервера, в браузер его не кладём).

## 2. SMTP

Подойдёт любой провайдер с паролем приложения:

| Провайдер | HOST | PORT |
|---|---|---|
| Яндекс | `smtp.yandex.ru` | 465 |
| Gmail | `smtp.gmail.com` | 465 |
| Mail.ru | `smtp.mail.ru` | 465 |

`SMTP_USER` — полный адрес, `SMTP_PASS` — пароль приложения,
`SMTP_FROM` — например `ИДЕЛЬ <no-reply@вашдомен>`.

Без SMTP сервер работает: письма не уходят, а ссылка/код пишутся в консоль
(удобно для локальной проверки).

## 3. Бэкенд на Render

1. Залейте репозиторий на GitHub.
2. Render → **New → Blueprint** → выберите репозиторий (Render прочитает
   `render.yaml`) или создайте **Web Service** вручную: Environment = Docker,
   Dockerfile = `./Dockerfile`.
3. Заполните переменные: `FRONTEND_URL` (адрес Pages, появится на шаге 4),
   SMTP, Supabase, остальные Render сгенерирует сам.
4. Проверка: `https://ваш-сервис.onrender.com/api/rules` должен вернуть JSON.
5. Диск `/data` обязателен — на нём живут `database.db` и `uploads/`.

### Альтернативы Render

Dockerfile универсален:

```bash
# Railway / Fly.io / VPS
docker build -t idel-api .
docker run -p 5001:5001 -v idel-data:/data --env-file backend/.env idel-api
```

На VPS удобно через `docker compose` с тем же volume `/data`.

## 4. Фронтенд на GitHub Pages

1. Settings → Pages → **Source: GitHub Actions**.
2. Settings → Secrets and variables → Actions → новый секрет
   **`VITE_API_URL`** = адрес бэкенда (`https://ваш-сервис.onrender.com`).
3. Push в `main` — workflow `.github/workflows/deploy-pages.yml` соберёт проект
   с базой `/<имя-репозитория>/` и опубликует.
4. Полученный адрес (`https://<user>.github.io/<repo>/`) пропишите в
   `FRONTEND_URL` бэкенда и перезапустите сервис.

Для пользовательского домена или `<user>.github.io` задайте в workflow
`VITE_BASE: /`.

## 5. Что проверить после деплоя

- Вход/регистрация, лента, профиль.
- Письмо подтверждения и сброс пароля (SMTP).
- Загрузка картинки поста → ссылка должна начинаться с `SUPABASE_URL`.
- Аватарка → локальная ссылка `/uploads/avatars/...` (не Supabase).
- Создание бота в @creatorbot → ссылка на чат.
- @resendcode_bot: код входа в аккаунт по запросу бота.

## 6. Локальная разработка

```bash
npm install          # поставит и backend-зависимости (postinstall)
npm run dev:full     # фронт :8080, бэкенд :5001
```

Локально можно не настраивать Supabase и SMTP: медиа хранится в SQLite,
письма печатаются в консоль.

## Переменные окружения бэкенда

| Переменная | Назначение |
|---|---|
| `PORT` | порт API (5001) |
| `JWT_SECRET`, `SESSION_ENC_KEY`, `CSRF_SECRET`, `MESSAGE_ENC_KEY`, `BOT_CODE_SECRET` | секреты (генерируются Render) |
| `DB_PATH`, `UPLOAD_DIR` | постоянный диск `/data` |
| `FRONTEND_URL` | адрес Pages для ссылок в письмах |
| `SMTP_HOST/PORT/USER/PASS/FROM` | почта |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_MEDIA_BUCKET` | Storage и зеркало |
| `MAX_MEDIA_FILES`, `MEDIA_TTL_DAYS` | авто-вайп старых медиа |
