import { useTranslation } from "react-i18next";
import { AlertTriangle, ShieldOff } from "lucide-react";

/**
 * Табличка для сторонних пользователей на профиле забаненного.
 * Точный текст из требований: «Профиль пользователя %username% был заблокирован
 * за нарушение правил использования платформы! Для вашей безопасности мы скрыли
 * его чаты и его посты от вас!»
 */
export function BannedProfileNotice({ username }: { username: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5">
      <div className="flex items-start gap-3">
        <ShieldOff className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
        <div className="min-w-0 text-sm text-destructive">
          <p className="font-semibold leading-relaxed">
            {t("ban.otherNotice", { username })}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Плашка для владельца профиля: причина бана, номер пункта правил и срок.
 */
export function BanOwnerNotice({
  reason,
  ruleNumber,
  ruleTitle,
  daysLeft,
  expiresAt,
  isAuto,
}: {
  reason: string | null;
  ruleNumber: number | null;
  ruleTitle?: string | null;
  daysLeft: number | null;
  expiresAt: string | null;
  isAuto: boolean;
}) {
  const { t } = useTranslation();
  const until = expiresAt
    ? new Date(expiresAt).toLocaleString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-destructive">
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4" />
        {t("ban.title")}
      </p>
      <dl className="mt-2 space-y-1 text-xs">
        <div className="flex gap-1.5">
          <dt className="opacity-70">{t("ban.reason")}:</dt>
          <dd className="font-medium">{reason || t("ban.noReason")}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="opacity-70">{t("ban.rule")}:</dt>
          <dd className="font-medium">
            {ruleNumber ? `п. ${ruleNumber}${ruleTitle ? ` — ${ruleTitle}` : ""}` : t("ban.ruleUnknown")}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="opacity-70">{t("ban.term")}:</dt>
          <dd className="font-medium">
            {expiresAt
              ? `${t("ban.until", { date: until })}${daysLeft ? ` · ${t("ban.daysLeft", { count: daysLeft })}` : ""}`
              : t("ban.permanent")}
          </dd>
        </div>
        {isAuto && (
          <div className="flex gap-1.5">
            <dt className="opacity-70">{t("ban.issuedBy")}:</dt>
            <dd className="font-medium">{t("moderation.bannedBySystem")}</dd>
          </div>
        )}
      </dl>
      <p className="mt-2 text-[11px] opacity-80">{t("ban.appealHint")}</p>
    </div>
  );
}
