import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, FileWarning, Gavel, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as api from "@/lib/api";
import type { AdminWarning, Appeal } from "@/lib/api";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Вкладка «Варны и апелляции»: рассматриваем апелляции (решение принимает
 * администратор) и смотрим последние предупреждения.
 */
export function WarningsAppealsTab() {
  const { t } = useTranslation();
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [warnings, setWarnings] = useState<AdminWarning[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [appealsList, warningsList] = await Promise.all([
        api.getAppeals("pending"),
        api.getRecentWarnings(20),
      ]);
      setAppeals(appealsList);
      setWarnings(warningsList);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const decide = async (appeal: Appeal, approve: boolean) => {
    try {
      await api.decideAppeal(appeal.id, approve, comments[appeal.id]);
      toast.success(approve ? t("admin.appealApproved") : t("admin.appealRejected"));
      await load();
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Gavel className="h-4 w-4" />
          {t("admin.appeals")}
        </h2>
        {loading ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : appeals.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("admin.noAppeals")}</p>
        ) : (
          <div className="mt-2 space-y-2">
            {appeals.map((appeal) => (
              <div key={appeal.id} className="space-y-2 rounded-2xl border border-border bg-card p-3 shadow-soft">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">@{appeal.user?.username ?? "?"}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(appeal.createdAt)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("ban.reason")}: {appeal.banReason || t("ban.noReason")}
                </p>
                <p className="whitespace-pre-wrap rounded-xl bg-secondary/60 px-3 py-2 text-sm">
                  {appeal.appealText}
                </p>
                <Input
                  value={comments[appeal.id] ?? ""}
                  onChange={(e) => setComments((prev) => ({ ...prev, [appeal.id]: e.target.value }))}
                  placeholder={t("admin.appealCommentPlaceholder")}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => decide(appeal, true)}>
                    <Check className="h-4 w-4" />
                    {t("admin.appealApprove")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => decide(appeal, false)}>
                    <X className="h-4 w-4" />
                    {t("admin.appealReject")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <FileWarning className="h-4 w-4" />
          {t("admin.recentWarnings")}
        </h2>
        {warnings.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("admin.noWarnings")}</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {warnings.map((warning) => (
              <div
                key={warning.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs"
              >
                <span className="font-medium">@{warning.username ?? warning.userId.slice(0, 8)}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{warning.reason}</span>
                <span className="rounded-full bg-secondary px-2 py-0.5">{warning.category}</span>
                <span className="text-muted-foreground">{formatDate(warning.createdAt)}</span>
                <span className="text-muted-foreground">
                  {warning.issuedBy ? t("admin.byAdmin") : t("admin.bySystem")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
