-- Схема Supabase для ИДЕЛЬ.
--
-- 1) Storage: создайте в Dashboard → Storage бакет с именем `media`
--    (Public bucket = ON). Файлы постов/видео/голосовых грузятся туда,
--    в SQLite остаются публичные ссылки. Аватарки и обложки не переносятся.
--
-- 2) PostgREST: выполните этот файл в SQL Editor. Таблицы — зеркало данных
--    о подписке ИДЕЛЬ ПРЕМИУМ и описаниях профилей. Пишет только сервер
--    (service_role key), поэтому RLS включён и публичного доступа нет.

create table if not exists public.idel_premium (
  user_id text primary key,
  active boolean not null default false,
  premium_until timestamptz,
  permanent boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.idel_profiles (
  user_id text primary key,
  username text not null,
  full_name text not null default '',
  bio text not null default '',
  updated_at timestamptz not null default now()
);

-- Сервер использует service_role key, он обходит RLS. Публичный доступ закрыт.
alter table public.idel_premium enable row level security;
alter table public.idel_profiles enable row level security;

-- Опционально: политика только на чтение для аутентифицированных
-- (если понадобится показывать данные из Supabase напрямую клиенту).
-- create policy "read premium" on public.idel_premium for select using (auth.role() = 'authenticated');
-- create policy "read profiles" on public.idel_profiles for select using (auth.role() = 'authenticated');

-- 3) Переменные окружения бэкенда (backend/.env):
--    SUPABASE_URL=https://<project>.supabase.co
--    SUPABASE_SERVICE_KEY=<service_role key>
--    SUPABASE_MEDIA_BUCKET=media
--    MAX_MEDIA_FILES=2000
--    MEDIA_TTL_DAYS=30
