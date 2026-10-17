import { useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Camera, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/auth";
import * as api from "@/lib/api";
import { downscaleImage, fileToDataUrl } from "@/lib/media";
import { UserAvatar } from "@/components/common/UserAvatar";
import { UserName, UserBadges } from "@/components/common/PremiumBadge";

export function EditProfile() {
  const { t } = useTranslation();
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [avatar, setAvatar] = useState<string | null>(user?.avatarUrl ?? null);
  const [cover, setCover] = useState<string | null>(user?.coverUrl ?? null);
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  const pickImage = async (file: File | undefined, setter: (v: string | null) => void) => {
    if (!file || !file.type.startsWith("image/")) return;
    const raw = await fileToDataUrl(file);
    const downscaled = await downscaleImage(raw);
    setter(downscaled);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) return;
    setSaving(true);
    try {
      await api.updateProfile({
        fullName: fullName.trim(),
        bio: bio.trim(),
        avatarUrl: avatar,
        coverUrl: cover,
      });
      await refresh();
      navigate(`/u/${user.username}`, { replace: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="px-1 text-xl font-bold">{t("profile.editTitle")}</h1>

      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-soft">
        <div className="flex items-center gap-3 rounded-xl bg-secondary/60 px-3 py-2.5">
          <UserAvatar user={user} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 truncate text-sm font-semibold">
              <UserName user={user} />
              {user.verified && <UserBadges user={user} />}
            </p>
            <p className="text-[11px] text-muted-foreground">{t("profile.identityLocked")}</p>
          </div>
          <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>{t("auth.avatar")}</Label>
            <div className="relative inline-block">
              {avatar ? (
                <>
                  <img
                    src={avatar}
                    alt=""
                    className="h-20 w-20 rounded-full border border-border object-cover"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="absolute -right-2 -top-2 h-6 w-6 rounded-full"
                    onClick={() => setAvatar(null)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </>
              ) : (
                <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:border-foreground hover:text-foreground">
                  <Camera className="h-5 w-5" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void pickImage(e.target.files?.[0], setAvatar)}
                  />
                </label>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t("auth.cover")}</Label>
            <div className="relative">
              {cover ? (
                <>
                  <img
                    src={cover}
                    alt=""
                    className="h-20 w-full rounded-xl border border-border object-cover"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="absolute right-1 top-1 h-5 w-5 rounded-full"
                    onClick={() => setCover(null)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </>
              ) : (
                <label className="flex h-20 w-full cursor-pointer items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground hover:border-foreground hover:text-foreground">
                  <Camera className="h-5 w-5" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void pickImage(e.target.files?.[0], setCover)}
                  />
                </label>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edit-fullname">{t("profile.fullName")}</Label>
          <Input
            id="edit-fullname"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edit-bio">{t("profile.bio")}</Label>
          <Textarea
            id="edit-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            className="resize-none"
          />
        </div>

        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            className="flex-1"
            onClick={() => navigate(`/u/${user.username}`)}
          >
            {t("common.cancel")}
          </Button>
          <Button type="submit" className="flex-1" disabled={saving}>
            {saving ? t("common.loading") : t("common.save")}
          </Button>
        </div>
      </form>
    </div>
  );
}
export default EditProfile;