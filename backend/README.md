# ИДЕЛЬ — backend

Node.js + Express + SQLite (`better-sqlite3`) + JWT + bcrypt + Multer + Nodemailer.

## Быстрый старт

```bash
cd backend
npm install
npm start          # или npm run dev — то же самое
```

Сервер поднимется на `http://localhost:5001` (см. `PORT` в `.env`).
При первом запуске автоматически создаются:
- аккаунт администратора `@drobovikov` / `iDrobo13*5448I`
- бот-аккаунт `@verifybot`

Файл базы данных — `backend/database.db` (SQLite), создаётся автоматически.

## Запуск фронтенда + бэкенда вместе

Из корня проекта:

```bash
npm install
npm run dev:full
```

Это поднимет Vite (`npm run dev`) и Express (`npm run server`) параллельно.
Фронтенд по умолчанию стучится на `http://localhost:5001` — при необходимости
поменяйте это через `VITE_API_URL` в `.env` (см. `.env.example`).

## Переменные окружения (`backend/.env`)

| Переменная | Назначение |
|---|---|
| `PORT` | Порт сервера (по умолчанию 5001) |
| `JWT_SECRET` | Секрет для подписи JWT — **обязательно смените в проде** |
| `JWT_EXPIRES_IN` | Срок жизни токена (по умолчанию 30d) |
| `SMTP_HOST/PORT/USER/PASS/FROM` | Данные SMTP (например, Brevo) для писем подтверждения регистрации |
| `FRONTEND_URL` | Базовый URL фронтенда — используется в ссылке подтверждения email |

Если `SMTP_USER`/`SMTP_PASS` не заданы, письма не отправляются по-настоящему —
ссылка подтверждения просто печатается в консоль сервера. Это осознанное
поведение для локальной разработки без реального SMTP-аккаунта.

Замечание про регистрацию: поле `email` при регистрации — необязательное.
Если его не передать, аккаунт считается подтверждённым сразу (как было в
старой версии на localStorage), и письмо не отправляется вовсе.

## Структура

```
backend/
├── database.db          # SQLite (создаётся сам)
├── server.js             # точка входа, сидирует admin/verifybot, монтирует роуты
├── db.js                  # схема SQLite + подключение
├── routes/                # см. ниже
├── middleware/
│   ├── auth.js            # requireAuth / requireAdmin / optionalAuth (JWT)
│   └── upload.js           # multer: аватары/обложки/картинки постов/голос/видео
├── utils/
│   ├── censor.js            # тот же словарь цензуры, что был на фронте
│   ├── validation.js         # правила username (в т.ч. блок-лист стран)
│   ├── serialize.js           # snake_case (БД) → camelCase (фронт)
│   ├── blockCheck.js           # общая проверка блокировки для friends/messages
│   ├── mailer.js                # nodemailer + консольный fallback
│   └── uid.js                    # crypto.randomUUID()
└── uploads/                # статически отдаётся на /uploads/...
    ├── avatars/ covers/ posts/ voice/ video/
```

## Роуты

Все защищённые роуты ждут `Authorization: Bearer <token>`.

- **auth**: `POST /register`, `GET /confirm?token=`, `POST /login`, `POST /logout`, `GET /me`
- **users**: `GET /`, `GET /:username`, `PUT /profile`, `PUT /username`, `DELETE /account`, `POST /avatar`, `POST /cover`, `PUT /:id/verified` (админ)
- **posts**: `GET /`, `GET /user/:userId`, `POST /`, `DELETE /:id`, `POST /upload/image`, `POST /upload/video`
- **comments**: `GET /post/:postId`, `POST /`, `DELETE /:id`, `POST /upload/voice`
- **likes**: `POST /toggle`, `GET /post/:postId`
- **follows**: `POST /toggle`, `GET /status/:userId`, `GET /counts/:userId`
- **friends**: `GET /`, `GET /requests`, `GET /status/:userId`, `POST /request`, `PUT /request/:id/accept`, `PUT /request/:id/reject`
- **messages**: `GET /chats`, `GET /bot`, `POST /bot/welcome`, `GET /:userId`, `POST /` (включает автоответ `@verifybot`)
- **channels**: `GET /`, `POST /`, `GET /:id`, `POST /:id/posts`, `DELETE /posts/:id`
- **verify**: `POST /request`, `GET /` (админ), `PUT /:id` (админ)
- **reports**: `POST /`, `GET /` (админ), `PUT /:id` (админ)
- **bans**: `GET /` (админ), `GET /status/:userId`, `POST /` (админ), `DELETE /:userId` (админ)
- **blocks**: `GET /`, `POST /:userId`, `DELETE /:userId`, `GET /status/:userId`
- **events**: PixelWar/WordWar/PopuWar — создание и управление только админом, участие — любым пользователем
- **notifications**: `GET /`
- **admin**: `GET /stats`, `GET /censor`, `PUT /censor` (админ)

Полный фронтенд-клиент — `src/lib/api.ts`, каждая функция там соответствует
одному из этих эндпоинтов.

## Изображения/видео/голос — как хранятся

Аватары, обложки, картинки постов и голосовые сообщения по-прежнему
передаются как data URL прямо в JSON (как это было в старой
localStorage-версии) — так проще всего было перенести существующие
компоненты без изменений. Видео — единственное исключение: оно реально
загружается на диск через `multer` (`POST /api/posts/upload/video`,
до 20 МБ), потому что видео в base64 было бы слишком тяжёлым для JSON-тела
запроса.
