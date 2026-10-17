import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AuthShell } from "@/components/auth/AuthShell";
import { useAuth } from "@/context/auth";
import { USERNAME_RE, FORBIDDEN_USERNAME_MESSAGE } from "@/lib/validation";
import { useNicknameCheck } from "@/hooks/use-nickname-check";
import { downscaleImage, fileToDataUrl } from "@/lib/media";
import { cn } from "@/lib/utils";

export function AuthRegister() {
  const { t } = useTranslation();
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [bio, setBio] = useState("");
  const [password, setPassword] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const nicknameForbidden = useNicknameCheck(username);

  if (user) return <Navigate to="/" replace />;

  const usernameValid = USERNAME_RE.test(username.trim().toLowerCase());

  const pickImage = async (file: File | undefined, setter: (v: string | null) => void) => {
    if (!file || !file.type.startsWith("image/")) return;
    const raw = await fileToDataUrl(file);
    const downscaled = await downscaleImage(raw, file.type.startsWith("image/") && file.size > 200000 ? 1280 : 800);
    setter(downscaled);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!username.trim() || !fullName.trim() || !password) {
      setError("auth.fillAll");
      return;
    }
    // Запрещённый ник: отказ без обращения к серверу (сервер проверит повторно).
    if (nicknameForbidden) {
      setError("auth.usernameForbidden");
      return;
    }
    const err = await register({ username, fullName, bio, avatarUrl: avatar, coverUrl: cover, password });
    if (err) {
      setError(err === FORBIDDEN_USERNAME_MESSAGE ? "auth.usernameForbidden" : err);
    } else {
      navigate("/", { replace: true });
    }
  };

  return (
    <AuthShell title={t("auth.registerTitle")} subtitle={t("auth.registerSubtitle")}>
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="reg-username">{t("auth.username")}</Label>
          <Input
            id="reg-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            aria-invalid={nicknameForbidden}
            className={cn(
              (touched && username.length > 0 && !usernameValid) || nicknameForbidden
                ? "border-destructive"
                : undefined,
            )}
            required
          />
          {/* Красный текст под строкой ввода для запрещённого ника. */}
          {nicknameForbidden ? (
            <p className="text-[11px] font-medium text-destructive">{t("auth.usernameForbidden")}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">{t("auth.usernameHint")}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reg-fullname">{t("auth.fullName")}</Label>
          <Input
            id="reg-fullname"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reg-bio">{t("auth.bio")}</Label>
          <Textarea
            id="reg-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={2}
            className="resize-none"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reg-password">{t("auth.password")}</Label>
          <Input
            id="reg-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
          <p className="text-[11px] text-muted-foreground">{t("auth.passwordHint")}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>{t("auth.avatar")}</Label>
            <div className="relative">
              {avatar ? (
                <>
                  <img
                    src={avatar}
                    alt=""
                    className="h-24 w-24 rounded-full border border-border object-cover"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="absolute left-16 top-0 h-6 w-6 rounded-full"
                    onClick={() => setAvatar(null)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </>
              ) : (
                <label className="flex h-24 w-24 cursor-pointer items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground hover:text-foreground">
                  <Camera className="h-6 w-6" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void pickImage(e.target.files?.[0], setAvatar)}
                  />
                </label>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">{t("auth.uploadAvatar")}</p>
          </div>

          <div className="space-y-1.5">
            <Label>{t("auth.cover")}</Label>
            <div className="relative">
              {cover ? (
                <>
                  <img
                    src={cover}
                    alt=""
                    className="h-24 w-full rounded-xl border border-border object-cover"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="absolute right-1 top-1 h-6 w-6 rounded-full"
                    onClick={() => setCover(null)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </>
              ) : (
                <label className="flex h-24 w-full cursor-pointer items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground transition-colors hover:border-foreground hover:text-foreground">
                  <Camera className="h-6 w-6" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void pickImage(e.target.files?.[0], setCover)}
                  />
                </label>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">{t("auth.uploadCover")}</p>
          </div>
        </div>

        {error && <p className="text-xs font-medium text-destructive">{t(error)}</p>}

        <Button type="submit" className="w-full">
          {t("auth.registerButton")}
        </Button>
      </form>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        {t("auth.alreadyHave")}{" "}
        <Link to="/login" className="font-semibold text-foreground hover:underline">
          {t("auth.loginLink")}
        </Link>
      </p>
    </AuthShell>
  );
}
export default AuthRegister;