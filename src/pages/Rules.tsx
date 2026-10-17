import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ScrollText } from "lucide-react";
import { useAuth } from "@/context/auth";
import * as api from "@/lib/api";
import type { Rule } from "@/lib/types";

/**
 * Публичная страница правил соцсети (#/rules).
 * Доступна без авторизации: список правил отдаёт открытый GET /api/rules.
 */
const Rules: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [rules, setRules] = useState<Rule[] | null>(null);

  useEffect(() => {
    api.getRules().then(setRules).catch(() => setRules([]));
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <ScrollText className="h-5 w-5" />
          {t("rules.title")}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t("rules.subtitle")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("rules.banHint")}</p>
      </div>

      {rules === null ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("rules.empty")}</p>
      ) : (
        <ol className="space-y-2">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
                {rule.number}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{rule.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{rule.description}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t("rules.updated")}: {new Date(rule.updatedAt).toLocaleDateString()}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="rounded-2xl border border-border bg-card p-5 text-sm shadow-soft">
        <p className="text-muted-foreground">{t("rules.appealHint")}</p>
        {!user && (
          <p className="mt-2 text-xs text-muted-foreground">
            <Link to="/register" className="font-semibold text-foreground hover:underline">
              {t("auth.registerLink")}
            </Link>
          </p>
        )}
      </div>
    </div>
  );
};

export default Rules;
