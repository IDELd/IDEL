# Бесплатный хостинг, который всегда включён (для школы, друзей и родных)

ПК держать включённым не нужно. Схема:

```
Бесплатная ВМ (Oracle Cloud Always Free) ── Docker ──▶ API :5001
        │                                      │
        │ Caddy: автоматический HTTPS          └──▶ /data (SQLite + загрузки)
        ▼
  https://<ваш-домен>  ◀── GitHub Pages (фронтенд)
```

Медиа (картинки постов, видео, голосовые) уже уходят в **Supabase**, поэтому
диск ВМ остаётся маленьким.

---

## Вариант 1 — Oracle Cloud Always Free (рекомендую)

Бесплатно **навсегда**: ARM-ВМ 4 ядра / 24 ГБ RAM / до 200 ГБ диска.
Карта нужна только для верификации личности, списаний за Always Free нет.

1. Регистрация: https://www.oracle.com/cloud/free/ (регион — ближайший, например
   Frankfurt/Amsterdam, чтобы не было проблем с доступом).
2. **Compute → Instances → Create instance**
   - Image: **Ubuntu 24.04** (или 22.04)
   - Shape: **VM.Standard.A1.Flex** (ARM), 1–2 OCPU, 6–12 ГБ RAM — бесплатно
   - Добавьте SSH-ключ (или сгенерируйте пару)
3. После создания: **Primary VNIC → Subnet → Security List** → добавьте
   Ingress Rules:
   - `0.0.0.0/0` → TCP **80**
   - `0.0.0.0/0` → TCP **443**
   - `0.0.0.0/0` → TCP **22** (обычно уже есть)
4. Запишите публичный IP.

### Домен (бесплатно, без покупки)

1. https://www.duckdns.org → войти через GitHub/Google → создать поддомен,
   например `idel-school` → **current ip** = публичный IP ВМ (или включите
   авто-обновление по инструкции DuckDNS).
2. Получится `idel-school.duckdns.org` — на него Caddy сам выпустит HTTPS.

### Установка на сервере

```bash
# по SSH
ssh ubuntu@<IP>

# Docker + compose
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER && newgrp docker

# код
git clone https://github.com/IDELd/IDEL.git
cd IDEL

# переменные
cp backend/.env.production.example backend/.env
nano backend/.env            # JWT_SECRET, *_ENC_KEY, BOT_CODE_SECRET, SMTP_*, SUPABASE_*, FRONTEND_URL
cp deploy/.env.example deploy/.env
nano deploy/.env             # DOMAIN=idel-school.duckdns.org

# запуск
cd deploy
docker compose up -d --build
```

Проверка: `https://idel-school.duckdns.org/api/rules` → JSON.

### Фронтенд

1. GitHub → репозиторий → Settings → Secrets and variables → Actions →
   **VITE_API_URL** = `https://idel-school.duckdns.org`
2. Actions → «Deploy to GitHub Pages» → Run workflow.
3. Полученный адрес (`https://ideld.github.io/IDEL/`) впишите в
   `backend/.env` → `FRONTEND_URL`, затем:
   ```bash
   cd deploy && docker compose up -d
   ```

### Обновления

```bash
cd IDEL && git pull
cd deploy && docker compose up -d --build
```

### Резервная копия

```bash
# база и загрузки лежат в volume idel-data
docker compose exec -T api sh -c "cat /data/database.db" > backup-$(date +%F).db
```

---

## Вариант 2 — Google Cloud e2-micro (тоже бесплатно навсегда)

Если Oracle не подходит: GCP → Compute Engine → `e2-micro` в регионе
`us-central1` (или us-west1/us-east1), Ubuntu, 30 ГБ диск. Остальные шаги
те же (Docker, compose, DuckDNS). 1 ГБ RAM хватает: сборка образа может идти
медленно — соберите образ локально/в CI и запушьте, либо добавьте swap.

---

## Что важно знать

- Бесплатные ВМ требуют карту **только для проверки**; Always Free не списывает
  деньги, но лимиты надо не превышать (на этой схеме вы в них укладываетесь).
- HTTPS обязателен: GitHub Pages работает по HTTPS, браузер не пустит
  запросы к `http://` API.
- Если позже захотите managed-хостинг — переезд простой: тот же Docker-образ и
  volume `/data` переносятся на Render/Fly/Railway (см. `DEPLOY.md`).
- Email (Gmail SMTP) работает с любой ВМ: нужен только интернет.
