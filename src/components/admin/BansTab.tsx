import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Ban, ChevronDown, ShieldCheck, Trash2, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { UserAvatar } from "@/components/common/UserAvatar";
import { BadgeLevel } from "@/components/common/BadgeLevel";
import * as api from "@/lib/api";
import type { User } from "@/lib/types";

interface BansTabProps {
  users: User[];
  bannedIds: Set<string>;
  onChanged: () => void;
}

const DURATIONS = [
  { value: "0", labelKey: "admin.durationPermanent" },
  { value: "1", labelKey: "admin.duration1" },
  { value: "3", labelKey: "admin.duration3" },
  { value: "7", labelKey: "admin.duration7" },
  { value: "30", labelKey: "admin.duration30" },
];

/** Аккаунты, на которых держится платформа, — их удалять нельзя. */
const PROTECTED_USERNAMES = ["verifybot", "restorebot", "creatorbot"];

const emptyForm = { reason: "", ruleNumber: "", durationDays: "0", mode: "normal" as "normal" | "serious" };

/**
 * Вкладка «Баны»: обычный и серьёзный бан, временный бан, причина, номер
 * пункта правил, разбан, снятие ограничения и полное удаление аккаунта.
 */
export function BansTab({ users, bannedIds, onChanged }: BansTabProps) {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleteReason, setDeleteReason] = useState("");

  const toggleForm = (userId: string) => {
    setOpenId((current) => (current === userId ? null : userId));
    setForm(emptyForm);
  };

  const submitBan = async (userId: string) => {
    if (!form.reason.trim()) {
      toast.error(t("admin.banReasonRequired"));
      return;
    }
    const ruleNumber = form.ruleNumber.trim() ? Number(form.ruleNumber) : null;
    const durationDays = Number(form.durationDays) || 0;
    try {
      await api.banUser(userId, form.reason.trim(), {
        ruleNumber: Number.isFinite(ruleNumber) ? ruleNumber : null,
        mode: form.mode,
        durationDays: durationDays > 0 ? durationDays : null,
      });
      toast.success(form.mode === "serious" ? t("admin.seriousBanApplied") : t("admin.banApplied"));
      setOpenId(null);
      setForm(emptyForm);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const liftBan = async (userId: string) => {
    try {
      await api.unbanUser(userId);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const clearRestrictions = async (userId: string) => {
    try {
      await api.clearUserRestrictions(userId);
      toast.success(t("admin.restrictionCleared"));
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      const snapshot = await api.deleteUserAccount(deleteTarget.id, deleteReason.trim());
      toast.success(
        t("admin.deleted", {
          username: deleteTarget.username,
          posts: snapshot?.posts ?? 0,
          messages: snapshot?.messages ?? 0,
        }),
      );
      setDeleteTarget(null);
      setDeleteReason("");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="space-y-2">
      {users.map((u) => {
        const banned = bannedIds.has(u.id);
        const bronzeBlocked = !!u.restrictions?.bronze_badge_blocked;
        const open = openId === u.id;
        const canDelete = !u.isAdmin && !PROTECTED_USERNAMES.includes(u.username.toLowerCase());
        return (
          <div key={u.id} className="rounded-2xl border border-border bg-card p-3 shadow-soft">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <UserAvatar user={u} size="sm" />
                <div className="min-w-0">
                  <p className="flex items-center gap-1 truncate text-sm font-medium">
                    @{u.username}
                    {u.isBot && <span className="text-[10px] text-muted-foreground">({t("admin.bot")})</span>}
                    <BadgeLevel level={u.badgeLevel} />
                    {banned && (
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                        {t("moderation.banned")}
                      </span>
                    )}
                    {bronzeBlocked && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold">
                        {t("admin.bronzeBlocked")}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {u.fullName || "—"}
                    {typeof u.reputation === "number" && (
                      <span className="ml-2">{t("moderation.reputation")}: {u.reputation}/100</span>
                    )}
                    {typeof u.warningsCount === "number" && (
                      <span className="ml-2">{t("moderation.warnings")}: {u.warningsCount}</span>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {bronzeBlocked && (
                  <Button size="sm" variant="outline" onClick={() => clearRestrictions(u.id)}>
                    <Unlock className="h-4 w-4" />
                    {t("admin.clearRestriction")}
                  </Button>
                )}
                {banned ? (
                  <Button size="sm" variant="outline" onClick={() => liftBan(u.id)}>
                    <ShieldCheck className="h-4 w-4" />
                    {t("admin.unban")}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={u.isAdmin}
                    className="text-destructive hover:text-destructive"
                    onClick={() => toggleForm(u.id)}
                  >
                    <Ban className="h-4 w-4" />
                    {t("admin.ban")}
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
                  </Button>
                )}
                {/* Полное удаление аккаунта — отдельная необратимая операция. */}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  disabled={!canDelete}
                  title={canDelete ? t("admin.deleteAccount") : t("admin.deleteProtected")}
                  aria-label={t("admin.deleteAccount")}
                  onClick={() => {
                    setDeleteTarget(u);
                    setDeleteReason("");
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {open && (
              <div className="mt-3 space-y-2 border-t border-border pt-3">
                <div className="space-y-1">
                  <Label htmlFor={`ban-reason-${u.id}`}>{t("admin.banReason")}</Label>
                  <Input
                    id={`ban-reason-${u.id}`}
                    value={form.reason}
                    onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                    placeholder={t("admin.banReasonPlaceholder")}
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`ban-rule-${u.id}`}>{t("ban.rule")}</Label>
                    <Input
                      id={`ban-rule-${u.id}`}
                      type="number"
                      min={1}
                      value={form.ruleNumber}
                      onChange={(e) => setForm((f) => ({ ...f, ruleNumber: e.target.value }))}
                      placeholder="1"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`ban-duration-${u.id}`}>{t("ban.term")}</Label>
                    <select
                      id={`ban-duration-${u.id}`}
                      value={form.durationDays}
                      onChange={(e) => setForm((f) => ({ ...f, durationDays: e.target.value }))}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {DURATIONS.map((d) => (
                        <option key={d.value} value={d.value}>
                          {t(d.labelKey)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`ban-mode-${u.id}`}>{t("admin.banMode")}</Label>
                    <select
                      id={`ban-mode-${u.id}`}
                      value={form.mode}
                      onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value as "normal" | "serious" }))}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="normal">{t("admin.modeNormal")}</option>
                      <option value="serious">{t("admin.modeSerious")}</option>
                    </select>
                  </div>
                </div>

                {form.mode === "serious" && (
                  <p className="rounded-lg bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
                    {t("admin.seriousBanHint")}
                  </p>
                )}

                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" onClick={() => submitBan(u.id)}>
                    {t("admin.banSubmit")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleForm(u.id)}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <AlertDialog open={!!deleteTarget} onOpenChange={(next) => !next && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.deleteAccountTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.deleteAccountWarning", { username: deleteTarget?.username ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label htmlFor="delete-reason">{t("admin.deleteReason")}</Label>
            <Input
              id="delete-reason"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder={t("admin.deleteReasonPlaceholder")}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              {t("admin.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
