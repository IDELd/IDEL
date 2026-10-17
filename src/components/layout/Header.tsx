import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Bell, LogOut, MessageCircle, ScrollText, Users } from "lucide-react";
import { useAuth } from "@/context/auth";
import * as api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/common/ThemeToggle";
import { LanguageSwitcher } from "@/components/language-switcher";

export function Header() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [pendingFriends, setPendingFriends] = useState(0);

  useEffect(() => {
    if (!user) return;
    api.getPendingFriendRequests().then((r) => setPendingFriends(r.length));
  }, [user]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-1 overflow-x-auto px-3 lg:px-6">
        <Link to="/" className="flex min-w-0 shrink-0 items-baseline gap-1.5">
          <span className="bg-brand-gradient bg-clip-text text-xl font-extrabold tracking-tight text-transparent">
            {t("common.appName")}
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-0">
          {/* On desktop these live in the sidebar instead, to avoid duplicating the same links twice. */}
          <div className="flex items-center gap-0 lg:hidden">
            {user && (
              <Button variant="ghost" size="icon" className="relative h-9 w-9 shrink-0" asChild aria-label={t("nav.friends")} title={t("nav.friends")}>
                <Link to="/friends">
                  <Users className="h-[18px] w-[18px]" />
                  {pendingFriends > 0 && (
                    <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
                  )}
                </Link>
              </Button>
            )}
            {user && (
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" asChild aria-label={t("nav.messages")} title={t("nav.messages")}>
                <Link to="/chat">
                  <MessageCircle className="h-[18px] w-[18px]" />
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" asChild aria-label={t("rules.title")} title={t("rules.title")}>
              <Link to="/rules">
                <ScrollText className="h-[18px] w-[18px]" />
              </Link>
            </Button>
          </div>

          {/* Уведомления — колокольчик в шапке, виден и на ПК, и на телефоне. */}
          {user && (
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" asChild aria-label={t("nav.notifications")} title={t("nav.notifications")}>
              <Link to="/notifications">
                <Bell className="h-[18px] w-[18px]" />
              </Link>
            </Button>
          )}

          {user && (
            <Link
              to={`/u/${user.username}`}
              className="hidden truncate px-2 text-xs font-medium text-muted-foreground hover:text-foreground lg:inline"
            >
              @{user.username}
            </Link>
          )}
          <LanguageSwitcher className="ml-0.5 h-9 w-auto min-w-0 shrink-0 px-2 text-xs" />
          <ThemeToggle className="h-9 w-9 shrink-0" />
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={logout} aria-label={t("common.logout")} title={t("common.logout")}>
            <LogOut className="h-[18px] w-[18px]" />
          </Button>
        </div>
      </div>
    </header>
  );
}
