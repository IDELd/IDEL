import { useTranslation } from "react-i18next";

/** Localized relative time ("5 min ago") for an ISO timestamp. */
export function useTimeAgo(iso: string): string {
  const { t } = useTranslation();
  const diff = Math.max(0, Date.now() - +new Date(iso));
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t("time.justNow");
  if (minutes < 60) return t("time.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  if (days === 1) return t("time.yesterday");
  if (days < 7) return t("time.daysAgo", { count: days });
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return t("time.weeksAgo", { count: weeks });
  const months = Math.floor(days / 30);
  if (months < 12) return t("time.monthsAgo", { count: months });
  return t("time.yearsAgo", { count: Math.floor(months / 12) });
}
