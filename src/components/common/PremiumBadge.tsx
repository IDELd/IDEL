import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BadgeLevel } from "@/components/common/BadgeLevel";
import { cn } from "@/lib/utils";
import type { User } from "@/lib/types";

/**
 * Значок ИДЕЛЬ ПРЕМИУМ — персиковый персонаж перед ником.
 * Файл лежит в public/premium-badge.png, фон вырезан.
 */
export function PremiumBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  // BASE_URL нужен для деплоя на GitHub Pages (проект живёт в подпапке).
  const src = `${import.meta.env.BASE_URL}premium-badge.png`.replace(/\/{2,}/g, "/");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <img
          src={src}
          alt={t("premium.badgeAlt")}
          className={cn("h-4 w-4 shrink-0 object-contain align-middle", className)}
        />
      </TooltipTrigger>
      <TooltipContent side="top">{t("premium.title")}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Ник пользователя. У подписчиков ИДЕЛЬ ПРЕМИУМ ник переливается
 * персиковыми цветами (см. src/premium.css).
 */
export function UserName({
  user,
  className,
}: {
  user: Pick<User, "username" | "premium">;
  className?: string;
}) {
  return (
    <span className={cn(user.premium && "premium-name", className)}>
      @{user.username}
    </span>
  );
}

/** Значки рядом с ником: персик за подписку + уровень верификации. */
export function UserBadges({
  user,
  className,
}: {
  user: Pick<User, "premium" | "badgeLevel">;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1 align-middle", className)}>
      {user.premium && <PremiumBadge />}
      <BadgeLevel level={user.badgeLevel} />
    </span>
  );
}
