import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Lock, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/auth";
import * as api from "@/lib/api";
import type { Group, GroupVisibility } from "@/lib/types";

export function Groups() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<GroupVisibility>("public");
  const [groups, setGroups] = useState<Group[]>([]);

  const load = async () => {
    try {
      setGroups(await api.getGroups());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!user || !name.trim()) {
      toast.error(t("groups.needName"));
      return;
    }
    try {
      await api.createGroup({ name: name.trim(), description, visibility });
      setName("");
      setDescription("");
      setVisibility("public");
      setOpen(false);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <h1 className="text-xl font-bold">{t("groups.title")}</h1>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          {t("groups.create")}
        </Button>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
          <Users className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("groups.empty")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <Link
              key={group.id}
              to={`/groups/${group.id}`}
              className="block rounded-2xl border border-border bg-card p-4 shadow-soft transition-all hover:border-foreground/30"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
                  {group.avatarUrl ? (
                    <img src={group.avatarUrl} alt="" className="h-11 w-11 rounded-xl object-cover" />
                  ) : (
                    <Users className="h-5 w-5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-sm font-semibold">
                    {group.visibility === "private" && (
                      <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    {group.name}
                    {group.myRole === "owner" && (
                      <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {t("groups.roleOwner")}
                      </span>
                    )}
                    {group.myRole === "moderator" && (
                      <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {t("groups.roleModerator")}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{group.description || "—"}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 border-t pt-2.5 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                <span>{t("groups.membersCount", { count: group.memberCount })}</span>
                <span className="ml-auto">
                  {group.visibility === "private" ? t("groups.visibilityPrivate") : t("groups.visibilityPublic")}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("groups.create")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="group-name">{t("groups.name")}</Label>
              <Input
                id="group-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("groups.namePlaceholder")}
                maxLength={40}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="group-desc">{t("groups.description")}</Label>
              <Textarea
                id="group-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("groups.descPlaceholder")}
                rows={3}
                className="resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("groups.visibility")}</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as GroupVisibility)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">{t("groups.visibilityPublic")}</SelectItem>
                  <SelectItem value="private">{t("groups.visibilityPrivate")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={create}>{t("groups.createButton")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
export default Groups;
