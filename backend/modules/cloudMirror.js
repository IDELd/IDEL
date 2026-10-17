// Зеркало данных в Supabase Postgres: подписка ИДЕЛЬ ПРЕМИУМ и описания
// профилей. Основная БД остаётся SQLite, а в Supabase уходят копии для
// внешней аналитики/резерва — как просил заказчик.
//
// Работает best-effort: если Supabase не настроен или недоступен, данные
// просто не уходят, ничего не ломается.

const supabase = require("./supabase");
const { logWarn } = require("../utils/logger");

/** Подписка: состояние на момент изменения. */
async function mirrorPremium({ userId, active, until, permanent }) {
  if (!supabase.isConfigured() || !userId) return false;
  try {
    return await supabase.restUpsert("idel_premium", [
      {
        user_id: userId,
        active: !!active,
        premium_until: until || null,
        permanent: !!permanent,
        updated_at: new Date().toISOString(),
      },
    ]);
  } catch (error) {
    logWarn("Зеркало премиума: ошибка", { userId, error: String(error) });
    return false;
  }
}

/** Описание профиля: ник, имя и био. */
async function mirrorProfile(user) {
  if (!supabase.isConfigured() || !user?.id) return false;
  try {
    return await supabase.restUpsert("idel_profiles", [
      {
        user_id: user.id,
        username: user.username,
        full_name: user.full_name || "",
        bio: user.bio || "",
        updated_at: new Date().toISOString(),
      },
    ]);
  } catch (error) {
    logWarn("Зеркало профиля: ошибка", { userId: user.id, error: String(error) });
    return false;
  }
}

module.exports = { mirrorPremium, mirrorProfile };