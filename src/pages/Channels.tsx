import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Hash, Lock, Plus } from "lucide-react";
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
import { BadgeLevel } from "@/components/common/BadgeLevel";
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
import type { Channel, ChannelPostPolicy, ChannelVisibility, User } from "@/lib/types";
import { UserAvatar } from "@/components/common/UserAvatar";

export function Channels() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<ChannelVisibility>("public");
  const [postPolicy, setPostPolicy] = useState<ChannelPostPolicy>("owner");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [owners, setOwners] = useState<Map<string, User>>(new Map());
  const [postCounts, setPostCounts] = useState<Map<string, number>>(new Map());

  const load = async () => {
    const list = await api.getChannels();
    setChannels(list);
    const ownerEntries = await Promise.all(
      Array.from(new Set(list.map((c) => c.ownerId))).map(async (id) => [id, await api.getUserById(id)] as const),
    );
    setOwners(new Map(ownerEntries.filter((e): e is [string, User] => !!e[1])));
    const countEntries = await Promise.all(
      list.map(async (c) => [c.id, (await api.getChannel(c.id)).posts.length] as const),
    );
    setPostCounts(new Map(countEntries));
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    if (!user || !name.trim()) {
      toast.error(t("channels.needName"));
      return;
    }
    await api.createChannel(name, description, { visibility, postPolicy });
    setName("");
    setDescription("");
    setVisibility("public");
    setPostPolicy("owner");
    setOpen(false);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1">
        <h1 className="text-xl font-bold">{t("channels.title")}</h1>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          {t("channels.create")}
        </Button>
      </div>

      {channels.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
          <Hash className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("channels.empty")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {channels.map((channel) => {
            const owner = owners.get(channel.ownerId);
            const postCount = postCounts.get(channel.id) ?? 0;
            return (
              <Link
                key={channel.id}
                to={`/channels/${channel.id}`}
                className="block rounded-2xl border border-border bg-card p-4 shadow-soft transition-all hover:border-foreground/30"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-foreground text-lg text-background">
                    <Hash className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 truncate text-sm font-semibold">
                      {channel.visibility === "private" && (
                        <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      {channel.name}
                      <BadgeLevel level={channel.badgeLevel} />
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {channel.description || "—"}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 border-t pt-2.5 text-xs text-muted-foreground">
                  <span>{postCount} {t("profile.posts")}</span>
                  {owner && (
                    <span className="flex min-w-0 items-center gap-1.5">
                      <UserAvatar user={owner} size="sm" className="h-5 w-5 text-[9px]" />
                      <span className="truncate">@{owner.username}</span>
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("channels.create")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="channel-name">{t("channels.name")}</Label>
              <Input
                id="channel-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("channels.namePlaceholder")}
                maxLength={40}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="channel-desc">{t("channels.description")}</Label>
              <Textarea
                id="channel-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("channels.descPlaceholder")}
                rows={3}
                className="resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("channels.visibility")}</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as ChannelVisibility)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">{t("channels.visibilityPublic")}</SelectItem>
                  <SelectItem value="private">{t("channels.visibilityPrivate")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("channels.postPolicy")}</Label>
              <Select value={postPolicy} onValueChange={(v) => setPostPolicy(v as ChannelPostPolicy)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">{t("channels.postPolicyOwner")}</SelectItem>
                  <SelectItem value="members">{t("channels.postPolicyMembers")}</SelectItem>
                  <SelectItem value="anyone">{t("channels.postPolicyAnyone")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={create}>{t("channels.createButton")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
export default Channels;
