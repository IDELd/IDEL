import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Laptop, LogOut, Monitor, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import * as api from "@/lib/api";
import type { UserSession } from "@/lib/types";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DeviceIcon({ device }: { device: string }) {
  if (device.includes("телефон")) return <Smartphone className="h-4 w-4" />;
  if (device.includes("планшет")) return <Laptop className="h-4 w-4" />;
  return <Monitor className="h-4 w-4" />;
}

/**
 * Список активных сессий: IP, устройство, дата входа и кнопка «Завершить».
 * Текущая сессия помечена и не может быть завершена этой кнопкой.
 */
export function SessionsPanel() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setSessions(await api.getSessions());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const terminate = async (sessionId: string) => {
    try {
      await api.revokeSession(sessionId);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const terminateOthers = async () => {
    try {
      const revoked = await api.revokeOtherSessions();
      toast.success(t("settings.sessionsTerminated", { count: revoked }));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const others = sessions.filter((s) => !s.current).length;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t("settings.sessions")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("settings.sessionsHint")}</p>
        </div>
        {others > 0 && (
          <Button size="sm" variant="outline" onClick={terminateOthers}>
            <LogOut className="h-4 w-4" />
            {t("settings.terminateOthers")}
          </Button>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {loading ? (
          <p className="text-xs text-muted-foreground">{t("common.loading")}</p>
        ) : sessions.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("settings.noSessions")}</p>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <DeviceIcon device={session.device} />
                  {session.device}
                  {session.current && (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                      {t("settings.currentSession")}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("settings.sessionIp")}: {session.ip} · {t("settings.sessionSignedIn")}: {formatDate(session.createdAt)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("settings.sessionLastActive")}: {formatDate(session.lastActive)}
                </p>
              </div>
              {!session.current && (
                <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => terminate(session.id)}>
                  {t("settings.terminate")}
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
