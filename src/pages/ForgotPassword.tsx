import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/AuthShell";
import * as api from "@/lib/api";

/** Запрос ссылки для сброса пароля на почту. */
export function ForgotPassword() {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.forgotPassword(value.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title={t("auth.forgotTitle")} subtitle={t("auth.forgotSubtitle")}>
      {sent ? (
        <div className="space-y-3">
          <p className="rounded-xl bg-secondary px-3 py-2 text-xs text-muted-foreground">
            {t("auth.forgotSent")}
          </p>
          <Button variant="outline" className="w-full" asChild>
            <Link to="/login">{t("auth.backToLogin")}</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="forgot-value">{t("auth.emailOrUsername")}</Label>
            <Input
              id="forgot-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t("auth.emailPlaceholder")}
              required
            />
          </div>
          {error && <p className="text-xs font-medium text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || !value.trim()}>
            {t("auth.sendResetLink")}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            <Link to="/login" className="font-semibold text-foreground hover:underline">
              {t("auth.backToLogin")}
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
export default ForgotPassword;