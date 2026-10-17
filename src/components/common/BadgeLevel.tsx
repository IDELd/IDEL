import { useTranslation } from "react-i18next";
import { BadgeCheck } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { badgeColorClass, badgeLabelKey } from "@/lib/badges";

/**
 * Иконка галочки: та же BadgeCheck, что была у обычной верификации.
 * Меняется только цвет: 🥉 бронза → 🥈 серебро → 🔵 синий (уровень 0 — серая).
 */
export function BadgeIcon({ level, className }: { level?: number | null; className?: string }) {
  const colorClass = badgeColorClass(level);
  return (
    <BadgeCheck
      className={cn(
        "h-4 w-4 shrink-0",
        colorClass || "text-muted-foreground/40",
        className,
      )}
    />
  );
}

/**
 * Верификационная галочка рядом с ником или названием канала.
 * Уровни: бронзовая → серебряная → синяя (максимум).
 * Это только визуальный префикс — никаких дополнительных прав не даёт.
 */
export function BadgeLevel({ level, className }: { level?: number | null; className?: string }) {
  const { t } = useTranslation();
  const colorClass = badgeColorClass(level);
  const labelKey = badgeLabelKey(level);
  if (!colorClass || !labelKey) return null;

  const label = t(labelKey);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex cursor-help align-middle", className)} aria-label={label}>
          <BadgeIcon level={level} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
