import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Crown, Palette, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/auth";
import * as api from "@/lib/api";
import { PremiumBadge } from "@/components/common/PremiumBadge";
import { contrastTextColor } from "@/lib/premium";
import { cn } from "@/lib/utils";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Блок ИДЕЛЬ ПРЕМИУМ в настройках: статус подписки, выбор цвета подложки
 * своих сообщений и подсказка про разовый триал в @premiumbot.
 */
export function PremiumPanel() {
  const { t } = useTranslation();
  const { user, refresh } = useAuth();
  const [colors, setColors] = useState<string[]>([]);
  const [trialDays, setTrialDays] = useState(3);
  const [premiumBotId, setPremiumBotId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getPremiumInfo()
      .then((info) => {
        setColors(info.colors);
        setTrialDays(info.trialDays);
      })
      .catch(() => setColors([]));
    api
      .getBotUser("premiumbot")
      .then((bot) => setPremiumBotId(bot.id))
      .catch(() => setPremiumBotId(null));
  }, []);

  if (!user) return null;

  const active = !!user.premium;
  const permanent = user.premiumUntil === "9999-12-31T23:59:59.000Z";
  const currentColor = user.messageColor ?? null;

  const pickColor = async (color: string | null) => {
    setSaving(true);
    try {
      await api.setMessageColor(color);
      await refresh();
      toast.success(color ? t("premium.colorSaved") : t("premium.colorResetDone"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <PremiumBadge />
          {t("premium.title")}
        </h2>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
            active ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-secondary text-muted-foreground",
          )}
        >
          {active ? t("premium.active") : t("premium.inactive")}
        </span>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">{t("premium.hint")}</p>

      {active && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          {permanent ? t("premium.permanent") : t("premium.until", { date: formatDate(user.premiumUntil ?? "") })}
        </p>
      )}

      {!active && (
        <p className="mt-2 rounded-xl bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
          {t("premium.trialHint", { days: trialDays })}
        </p>
      )}

      {premiumBotId && (
        <Button size="sm" variant="outline" className="mt-2" asChild>
          <Link to={`/chat/${premiumBotId}`}>
            <Crown className="h-4 w-4" />
            {t("premium.openPremiumBot")}
          </Link>
        </Button>
      )}

      {active && (
        <div className="mt-4 border-t border-border pt-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Palette className="h-3.5 w-3.5" />
            {t("premium.color")}
          </h3>
          <p className="mt-1 text-[11px] text-muted-foreground">{t("premium.colorHint")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                disabled={saving}
                onClick={() => pickColor(color)}
                style={{ backgroundColor: color }}
                aria-label={color}
                className={cn(
                  "h-7 w-7 rounded-full border transition-transform hover:scale-110",
                  currentColor === color ? "border-2 border-foreground" : "border-border",
                )}
              />
            ))}
            {currentColor && (
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => pickColor(null)}>
                {t("premium.colorReset")}
              </Button>
            )}
          </div>
          {/* Превью именно подложки, как это увидят собеседники. */}
          <div
            className="mt-3 inline-flex rounded-2xl px-3 py-2 text-sm shadow-soft"
            style={
              currentColor
                ? { backgroundColor: currentColor, color: contrastTextColor(currentColor) }
                : { backgroundColor: "hsl(var(--secondary))" }
            }
          >
            {t("premium.preview")}
          </div>
        </div>
      )}
    </div>
  );
}
