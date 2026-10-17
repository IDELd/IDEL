import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BadgeIcon } from "@/components/common/BadgeLevel";
import { cn } from "@/lib/utils";

const LEVELS = [0, 1, 2, 3];

/**
 * Выбор уровня верификационной галочки (0 — нет, 1 — бронза, 2 — серебро,
 * 3 — синий). Используется в админ-панели для пользователей, ботов и каналов.
 */
export function BadgeLevelSelect({
  value,
  onChange,
  disabled,
  className,
}: {
  value: number;
  onChange: (level: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const labelFor = (level: number) => (level === 0 ? t("badge.none") : t(`badge.level${level}`));

  return (
    <Select
      value={String(value ?? 0)}
      onValueChange={(next) => onChange(Number(next))}
      disabled={disabled}
    >
      <SelectTrigger className={cn("h-8 w-[168px] text-xs", className)} aria-label={t("admin.badgeLevel")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LEVELS.map((level) => (
          <SelectItem key={level} value={String(level)}>
            <span className="flex items-center gap-1.5">
              <BadgeIcon level={level} className="h-3.5 w-3.5" />
              {labelFor(level)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
