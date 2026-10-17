import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { SearchX } from "lucide-react";
import { Input } from "@/components/ui/input";
import * as api from "@/lib/api";
import type { User } from "@/lib/types";
import { UserAvatar } from "@/components/common/UserAvatar";
import { UserName, UserBadges } from "@/components/common/PremiumBadge";
import { BotBadge } from "@/components/common/BotBadge";

export function Search() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [allUsers, setAllUsers] = useState<User[]>([]);

  useEffect(() => {
    // Свежий список: только что созданного бота не должно «съедать» кэширование.
    api.invalidateUsersCache();
    api.getUsers().then(setAllUsers);
  }, []);

  useEffect(() => {
    const q = searchParams.get("q");
    if (q) setQuery(q);
  }, [searchParams]);

  const q = query.trim().toLowerCase();
  const results = q
    ? allUsers.filter((u) => u.username.toLowerCase().includes(q)).sort((a, b) => a.username.localeCompare(b.username))
    : [];

  return (
    <div className="space-y-4">
      <h1 className="px-1 text-xl font-bold">{t("search.title")}</h1>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("search.placeholder")}
        className="h-11"
        autoFocus
      />

      {query.trim() === "" ? (
        <p className="px-1 text-xs text-muted-foreground">{t("search.hint")}</p>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-12 text-center">
          <SearchX className="h-7 w-7 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("search.empty")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {results.map((u) => (
            <Link
              key={u.id}
              to={`/u/${u.username}`}
              className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-soft transition-all hover:border-foreground/30"
            >
              <UserAvatar user={u} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <p className="truncate text-sm font-semibold">
                    <UserName user={u} />
                  </p>
                  {u.isBot && <BotBadge />}
                  <UserBadges user={u} />
                </div>
                <p className="truncate text-xs text-muted-foreground">{u.fullName}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
export default Search;