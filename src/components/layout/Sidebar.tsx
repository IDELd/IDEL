import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Hash,
  Home,
  MessageCircle,
  Plus,
  ScrollText,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  User,
  Users,
  UsersRound,
} from "lucide-react";
import { useAuth } from "@/context/auth";
import * as api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Sidebar({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const location = useLocation();
  const [pendingFriends, setPendingFriends] = useState(0);

  useEffect(() => {
    if (!user) return;
    api.getPendingFriendRequests().then((r) => setPendingFriends(r.length));
  }, [user]);

  if (!user) return null;

  const links = [
    { to: "/", label: t("nav.feed"), icon: Home },
    { to: "/search", label: t("nav.search"), icon: Search },
    { to: `/u/${user.username}`, label: t("nav.profile"), icon: User },
    { to: "/channels", label: t("nav.channels"), icon: Hash },
    { to: "/groups", label: t("nav.groups"), icon: UsersRound },
    { to: "/friends", label: t("nav.friends"), icon: Users, badge: pendingFriends },
    { to: "/chat", label: t("nav.messages"), icon: MessageCircle },
    { to: "/rules", label: t("rules.title"), icon: ScrollText },
  ];

  const isActive = (to: string) => {
    if (to === "/") return location.pathname === "/";
    return location.pathname === to || location.pathname.startsWith(to + "/");
  };

  return (
    <aside className="sticky top-[3.75rem] hidden h-[calc(100dvh-3.75rem)] w-60 shrink-0 flex-col justify-between overflow-y-auto py-6 pr-2 lg:flex">
      <div className="space-y-1">
        <Button onClick={onCreate} className="mb-4 w-full justify-start gap-2">
          <Plus className="h-4 w-4" />
          {t("nav.create")}
        </Button>
        {links.map(({ to, label, icon: Icon, badge }) => (
          <Link
            key={to}
            to={to}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              isActive(to)
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {!!badge && (
              <span className="rounded-full bg-foreground px-1.5 text-[10px] font-bold text-background">
                {badge}
              </span>
            )}
          </Link>
        ))}
      </div>

      <div className="space-y-1 border-t border-border pt-3">
        <Link
          to="/settings"
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
            isActive("/settings")
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
          )}
        >
          <SettingsIcon className="h-[18px] w-[18px] shrink-0" />
          {t("settings.title")}
        </Link>
        {user.isAdmin && (
          <Link
            to="/admin"
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              isActive("/admin")
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <ShieldCheck className="h-[18px] w-[18px] shrink-0" />
            {t("profile.adminPanel")}
          </Link>
        )}
      </div>
    </aside>
  );
}
