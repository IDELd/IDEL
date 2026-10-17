import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/AuthShell";
import * as api from "@/lib/api";

/** Новый пароль по ссылке из письма: #/reset-password?token=… */
export function ResetPassword() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== repeat) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    if (password.length < 6) {
      setError(t("auth.passwordShort"));
      return;
    }
    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthShell title={t("auth.resetTitle")} subtitle={t("auth.resetSubtitle")}>
        <p className="text-xs text-destructive">{t("auth.resetInvalidLink")}</p>
        <Button variant="outline" className="mt-3 w-full" asChild>
          <Link to="/forgot-password">{t("auth.forgotTitle")}</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("auth.resetTitle")} subtitle={t("auth.resetSubtitle")}>
      {done ? (
        <div className="space-y-3">
          <p className="rounded-xl bg-secondary px-3 py-2 text-xs text-muted-foreground">
            {t("auth.resetDone")}
          </p>
          <Button className="w-full" asChild>
            <Link to="/login">{t("auth.loginButton")}</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reset-password">{t("auth.newPassword")}</Label>
            <Input
              id="reset-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reset-password2">{t("auth.repeatPassword")}</Label>
            <Input
              id="reset-password2"
              type="password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          {error && <p className="text-xs font-medium text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || !password || !repeat}>
            {t("auth.savePassword")}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
export default ResetPassword;