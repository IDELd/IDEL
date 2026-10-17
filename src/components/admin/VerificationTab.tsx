import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Crown, Hash, X } from "lucide-react";
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
import { BadgeLevelSelect } from "./BadgeLevelSelect";
import { cn } from "@/lib/utils";
import * as api from "@/lib/api";
import type { Channel, User, VerificationRequest } from "@/lib/types";

interface VerificationTabProps {
  requests: VerificationRequest[];
  requesters: Map<string, User>;
  users: User[];
  channels: Channel[];
  onChanged: () => void;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Полоска «AI-оценки» заявки с расшифровкой по факторам. */
function ScoreMeter({ score, details }: { score: number; details?: VerificationRequest["aiDetails"] }) {
  const { t } = useTranslation();
  const value = Math.max(0, Math.min(100, score || 0));
  return (
    <div className="mt-1 w-full">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {t("admin.aiScore")}: <strong className="text-foreground">{value}%</strong>
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${value}%` }} />
      </div>
      {details && details.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
          {details.map((item) => (
            <span key={item.key}>
              {item.label}: {item.points}/{item.max} ({item.note})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Вкладка «Верификация»: заявки на верификацию и ручная выдача уровней
 * галочки пользователям (включая ботов) и каналам.
 */
export function VerificationTab({ requests, requesters, users, channels, onChanged }: VerificationTabProps) {
  const { t } = useTranslation();
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [crownTarget, setCrownTarget] = useState<User | null>(null);
  const [crownDays, setCrownDays] = useState("30");
  const [crownPermanent, setCrownPermanent] = useState(false);

  const savePremium = async (revoke: boolean) => {
    if (!crownTarget) return;
    try {
      if (revoke) {
        await api.revokePremium(crownTarget.id);
        toast.success(t("admin.premiumRevoked"));
      } else {
        await api.grantPremium(crownTarget.id, {
          permanent: crownPermanent,
          days: crownPermanent ? undefined : Number(crownDays),
        });
        toast.success(t("admin.premiumGranted"));
      }
      setCrownTarget(null);
      onChanged();
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const requestLevel = (id: string) => levels[id] ?? 3;

  const decide = async (requestId: string, approve: boolean) => {
    try {
      await api.processVerificationRequest(requestId, approve, requestLevel(requestId));
      onChanged();
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const changeUserLevel = async (userId: string, level: number) => {
    try {
      await api.setBadgeLevel("user", userId, level);
      onChanged();
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const changeChannelLevel = async (channelId: string, level: number) => {
    try {
      await api.setBadgeLevel("channel", channelId, level);
      onChanged();
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground">{t("admin.pendingRequests")}</h2>
        {requests.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("admin.noPendingRequests")}</p>
        ) : (
          <div className="mt-2 space-y-2">
            {requests.map((req) => {
              const u = requesters.get(req.userId);
              if (!u) return null;
              return (
                <div
                  key={req.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card p-3 shadow-soft"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <UserAvatar user={u} size="sm" />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1 truncate text-sm font-semibold">
                        @{u.username}
                        {u.isBot && <span className="text-[10px] text-muted-foreground">({t("admin.bot")})</span>}
                        <BadgeLevel level={u.badgeLevel} />
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {u.fullName}
                        {typeof u.reputation === "number" && (
                          <span className="ml-2">{t("moderation.reputation")}: {u.reputation}/100</span>
                        )}
                        {typeof u.warningsCount === "number" && (
                          <span className="ml-2">{t("moderation.warnings")}: {u.warningsCount}</span>
                        )}
                      </p>
                      {req.kind === "bot" && req.answers && req.answers.length > 0 && (
                        <div className="mt-1.5 rounded-lg bg-secondary/50 px-2 py-1.5 text-[11px]">
                          <p className="font-semibold text-muted-foreground">{t("admin.botVerifyAnswers")}</p>
                          <ol className="mt-0.5 list-decimal space-y-0.5 pl-4 text-muted-foreground">
                            {req.answers.map((answer, i) => (
                              <li key={i}>{answer || "—"}</li>
                            ))}
                          </ol>
                        </div>
                      )}
                      {req.kind !== "bot" && (
                        <ScoreMeter score={req.score ?? req.aiScore ?? 0} details={req.aiDetails} />
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <BadgeLevelSelect
                      value={requestLevel(req.id)}
                      onChange={(level) => setLevels((prev) => ({ ...prev, [req.id]: level }))}
                    />
                    <Button size="sm" variant="outline" onClick={() => decide(req.id, true)}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={() => decide(req.id, false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h2 className="mt-4 text-sm font-semibold text-muted-foreground">{t("admin.badgeLevels")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("admin.badgeLevelsHint")}</p>
        <div className="mt-2 space-y-2">
          {users.map((u) => (
            <div
              key={u.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card p-3 shadow-soft"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1 truncate text-sm font-medium">
                  @{u.username}
                  {u.isBot && <span className="text-[10px] text-muted-foreground">({t("admin.bot")})</span>}
                  <BadgeLevel level={u.badgeLevel} />
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
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="icon"
                  variant="ghost"
                  className={cn(
                    "h-8 w-8",
                    u.premium ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                  )}
                  title={u.premium ? t("admin.premiumActive") : t("admin.premiumGrant")}
                  aria-label={t("admin.premium")}
                  onClick={() => {
                    setCrownTarget(u);
                    setCrownDays("30");
                    setCrownPermanent(false);
                  }}
                >
                  <Crown className="h-4 w-4" />
                </Button>
                <BadgeLevelSelect
                  value={u.badgeLevel ?? 0}
                  disabled={u.isAdmin}
                  onChange={(level) => changeUserLevel(u.id, level)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={u.isAdmin}
                  className={u.verified ? undefined : "text-destructive hover:text-destructive"}
                  onClick={async () => {
                    try {
                      await api.setUserVerified(u.id, !u.verified);
                      onChanged();
                    } catch (error) {
                      toast.error(errorText(error));
                    }
                  }}
                >
                  {u.verified ? t("admin.revoke") : t("admin.grant")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mt-4 text-sm font-semibold text-muted-foreground">{t("admin.channels")}</h2>
        {channels.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">{t("admin.noChannels")}</p>
        ) : (
          <div className="mt-2 space-y-2">
            {channels.map((channel) => (
              <div
                key={channel.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card p-3 shadow-soft"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary">
                    <Hash className="h-4 w-4" />
                  </span>
                  <p className="flex items-center gap-1 truncate text-sm font-medium">
                    {channel.name}
                    <BadgeLevel level={channel.badgeLevel} />
                  </p>
                </div>
                <BadgeLevelSelect
                  value={channel.badgeLevel ?? 0}
                  onChange={(level) => changeChannelLevel(channel.id, level)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ИДЕЛЬ ПРЕМИУМ: выдача и снятие подписки (корона в строке пользователя). */}
      <AlertDialog open={!!crownTarget} onOpenChange={(next) => !next && setCrownTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin.premiumTitle", { username: crownTarget?.username ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {crownTarget?.premium ? t("admin.premiumActiveHint") : t("admin.premiumInactiveHint")}
              {crownTarget?.premiumTrialUsed ? ` ${t("admin.premiumTrialUsed")}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1">
            <Label htmlFor="premium-days">{t("admin.premiumDays")}</Label>
            <select
              id="premium-days"
              value={crownPermanent ? "permanent" : crownDays}
              onChange={(e) => {
                if (e.target.value === "permanent") {
                  setCrownPermanent(true);
                } else {
                  setCrownPermanent(false);
                  setCrownDays(e.target.value);
                }
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="7">{t("admin.duration7")}</option>
              <option value="30">{t("admin.duration30")}</option>
              <option value="90">{t("admin.premiumDuration90")}</option>
              <option value="365">{t("admin.premiumDuration365")}</option>
              <option value="permanent">{t("admin.premiumPermanent")}</option>
            </select>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            {crownTarget?.premium && (
              <Button variant="outline" onClick={() => savePremium(true)}>
                {t("admin.premiumRevoke")}
              </Button>
            )}
            <AlertDialogAction onClick={() => savePremium(false)}>
              {t("admin.premiumGrant")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
