/** Уровень верификационной галочки: 0 — нет, 1 — бронза, 2 — серебро, 3 — синий. */
export type BadgeLevel = 0 | 1 | 2 | 3;

/**
 * Цвет галочки по уровню. Иконка везде одна и та же (BadgeCheck), как была у
 * обычной верификации — меняется только цвет: бронза → серебро → синий.
 */
export const BADGE_COLOR_CLASS: Record<number, string> = {
  1: "fill-amber-600 text-white",
  2: "fill-slate-400 text-white",
  3: "fill-blue-500 text-white",
};

/** Ключ перевода с названием уровня (см. src/locales/*.json → badge). */
export const BADGE_LABEL_KEY: Record<number, string> = {
  1: "badge.level1",
  2: "badge.level2",
  3: "badge.level3",
};

export function badgeColorClass(level?: number | null): string | null {
  if (!level) return null;
  return BADGE_COLOR_CLASS[level] || null;
}

export function badgeLabelKey(level?: number | null): string | null {
  if (!level) return null;
  return BADGE_LABEL_KEY[level] || null;
}
