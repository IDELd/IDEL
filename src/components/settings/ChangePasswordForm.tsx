import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as api from "@/lib/api";

/**
 * Смена пароля. После успешной смены сервер завершает все прочие сессии,
 * текущая остаётся рабочей.
 */
export function ChangePasswordForm() {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!currentPassword || !newPassword) {
      setError(t("auth.fillAll"));
      return;
    }
    if (newPassword.length < 6) {
      setError(t("auth.passwordShort"));
      return;
    }
    setBusy(true);
    try {
      const result = await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      toast.success(
        result.revokedOtherSessions > 0
          ? t("settings.passwordChangedSessions", { count: result.revokedOtherSessions })
          : t("settings.passwordChanged"),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <KeyRound className="h-4 w-4" />
        {t("settings.changePassword")}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("settings.changePasswordHint")}</p>
      <div className="mt-3 space-y-2">
        <div className="space-y-1">
          <Label htmlFor="current-password">{t("settings.currentPassword")}</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="new-password">{t("settings.newPassword")}</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        {error && <p className="text-xs font-medium text-destructive">{error}</p>}
        <Button size="sm" onClick={submit} disabled={busy || !currentPassword || !newPassword}>
          {t("settings.changePasswordButton")}
        </Button>
      </div>
    </div>
  );
}
