import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import {
  Award,
  Bot,
  CheckCircle2,
  Flame,
  Heart,
  Lock,
  MessageCircle,
  Moon,
  PenLine,
  ShieldCheck,
  Star,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/auth";
import * as api from "@/lib/api";
import type { Achievement, AchievementsPayload } from "@/lib/types";
import { UserAvatar } from "@/components/common/UserAvatar";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/** Иконка по коду достижения (без эмодзи — только lucide). */
function AchievementIcon({ code, className }: { code: string; className?: string }) {
  const map: Record<string, typeof Award> = {
    first_post: PenLine,
    posts_10: PenLine,
    posts_50: PenLine,
    comments_10: MessageCircle,
    likes_100: Heart,
    popular_post: Flame,
    followers_10: Users,
    friends_5: UserPlus,
    verified: ShieldCheck,
    premium: Star,
    bot_creator: Bot,
    group_owner: Users,
    night_owl: Moon,
    streak_7: Flame,
    clean_rank: CheckCircle2,
  };
  const Icon = map[code] ?? Award;
  return <Icon className={className} />;
}

/**
 * Достижения профиля: открытые и с прогрессом.
 * #/achievements — свои, #/achievements/:username — чужие.
 */
export function Achievements() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { username } = useParams<{ username?: string }>();
  const [data, setData] = useState<AchievementsPayload | null>(null);
  const [owner, setOwner] = useState<{ username: string; fullName: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        if (username) {
          const [payload, profile] = await Promise.all([
            api.getUserAchievements(username),
            api.getUserByUsername(username),
          ]);
          setData(payload);
          if (profile) setOwner({ username: profile.username, fullName: profile.fullName });
        } else if (user) {
          setData(await api.getMyAchievements());
          setOwner({ username: user.username, fullName: user.fullName });
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    };
    void load();
  }, [username, user]);

  const achievements = data?.achievements ?? [];
  const unlocked = achievements.filter((a) => a.unlocked);
  const locked = achievements.filter((a) => !a.unlocked);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
            <Award className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold">{t("achievements.title")}</h1>
            <p className="truncate text-xs text-muted-foreground">
              {owner ? `@${owner.username}` : "—"} · {data?.unlocked ?? 0} {t("achievements.of")} {data?.total ?? 0} ·{" "}
              {data?.points ?? 0} {t("achievements.points")}
            </p>
          </div>
          {owner && <UserAvatar user={{ id: owner.username, username: owner.username, fullName: owner.fullName } as never} size="md" />}
        </div>
      </div>

      <div>
        <h2 className="px-1 text-sm font-semibold text-muted-foreground">{t("achievements.unlocked")}</h2>
        {unlocked.length === 0 ? (
          <p className="mt-2 rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            {t("achievements.emptyUnlocked")}
          </p>
        ) : (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {unlocked.map((item) => (
              <div
                key={item.code}
                className="flex items-start gap-3 rounded-2xl border border-border bg-card p-3 shadow-soft"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
                  <AchievementIcon code={item.code} className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.description}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    +{item.points} {t("achievements.points")}
                    {item.unlockedAt ? ` · ${new Date(item.unlockedAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="px-1 text-sm font-semibold text-muted-foreground">{t("achievements.inProgress")}</h2>
        {locked.length === 0 ? (
          <p className="mt-2 rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            {t("achievements.emptyLocked")}
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {locked.map((item) => (
              <div key={item.code} className="rounded-2xl border border-border bg-card p-3 shadow-soft">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                    {item.unlocked ? <AchievementIcon code={item.code} className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.description}</p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {item.progress}/{item.target}
                  </span>
                </div>
                <Progress value={(item.progress / item.target) * 100} className="mt-2 h-1.5" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Компактная плашка «достижения» для профиля. */
export function AchievementsSummary({ data }: { data: AchievementsPayload }) {
  const { t } = useTranslation();
  const unlocked = data.achievements.filter((a) => a.unlocked).slice(0, 5);
  if (data.unlocked === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-2.5">
      {unlocked.map((item: Achievement) => (
        <span
          key={item.code}
          title={`${item.title} — ${item.description}`}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-lg bg-secondary text-foreground",
          )}
        >
          <AchievementIcon code={item.code} className="h-3.5 w-3.5" />
        </span>
      ))}
      <span className="ml-1 text-[11px] text-muted-foreground">
        {data.unlocked}/{data.total} · {data.points} {t("achievements.points")}
      </span>
    </div>
  );
}

export default Achievements;