import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ImagePlus,
  Lock,
  Pin,
  PinOff,
  Send,
  Settings2,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/auth";
import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";
import type { Group, GroupMember, GroupMessage, GroupVisibility, User } from "@/lib/types";
import { downscaleImage, fileToDataUrl } from "@/lib/media";
import { bubbleStyle } from "@/lib/premium";
import { UserAvatar } from "@/components/common/UserAvatar";
import { UserName, UserBadges } from "@/components/common/PremiumBadge";
import { TimeAgo } from "@/components/common/TimeAgo";
import { cn } from "@/lib/utils";

const POLL_MS = 4000;

export function GroupChat() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const [group, setGroup] = useState<Group | null | undefined>(undefined);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [usersById, setUsersById] = useState<Map<string, User>>(new Map());
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const [membersOpen, setMembersOpen] = useState(false);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [memberName, setMemberName] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editVisibility, setEditVisibility] = useState<GroupVisibility>("public");

  const load = async () => {
    if (!id) return;
    try {
      const found = await api.getGroup(id);
      setGroup(found);
      setAccessError(null);
      const users = await api.getUsersCached();
      setUsersById(new Map(users.map((u) => [u.id, u])));
      if (found.isMember && !found.isBanned) {
        setMessages(await api.getGroupMessages(id));
      }
    } catch (error) {
      setGroup(null);
      setAccessError(error instanceof ApiError ? error.code ?? null : null);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const timer = setInterval(async () => {
      if (!id || !group?.isMember || group.isBanned) return;
      try {
        setMessages(await api.getGroupMessages(id));
      } catch {
        /* тихо: следующая попытка через POLL_MS */
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [id, group?.isMember, group?.isBanned]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (group === undefined) return null;

  if (!group) {
    const privateGroup = accessError === "private_group";
    return (
      <div className="rounded-2xl border border-dashed border-border px-6 py-16 text-center">
        <p className="text-sm font-semibold">
          {privateGroup ? t("groups.privateTitle") : t("groups.notFound")}
        </p>
        {privateGroup && <p className="mt-1 text-xs text-muted-foreground">{t("groups.privateHint")}</p>}
        <Button variant="outline" className="mt-4" asChild>
          <Link to="/groups">{t("groups.title")}</Link>
        </Button>
      </div>
    );
  }

  const canModerate = group.myRole === "owner" || group.myRole === "moderator";
  const pinned = group.pinnedMessageId ? messages.find((m) => m.id === group.pinnedMessageId) : undefined;

  const refreshMembers = async () => {
    if (!id) return;
    try {
      setMembers(await api.getGroupMembers(id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const openMembers = async () => {
    setMembersOpen(true);
    await refreshMembers();
  };

  const openSettings = () => {
    setEditName(group.name);
    setEditDescription(group.description);
    setEditVisibility(group.visibility);
    setSettingsOpen(true);
  };

  const pickImage = async (file?: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    const raw = await fileToDataUrl(file);
    setPendingImage(await downscaleImage(raw, 900));
  };

  const send = async () => {
    if (!id || (!input.trim() && !pendingImage)) return;
    const text = input.trim();
    const image = pendingImage;
    setInput("");
    setPendingImage(null);
    try {
      await api.sendGroupMessage(id, { text, imageUrl: image });
      setMessages(await api.getGroupMessages(id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const removeMessage = async (messageId: string) => {
    if (!id) return;
    try {
      await api.deleteGroupMessage(id, messageId);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      if (group.pinnedMessageId === messageId) {
        setGroup({ ...group, pinnedMessageId: null });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const togglePin = async (messageId: string | null) => {
    if (!id) return;
    try {
      const updated = await api.pinGroupMessage(id, messageId);
      setGroup(updated);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const join = async () => {
    if (!id) return;
    try {
      setGroup(await api.joinGroup(id));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const leave = async () => {
    if (!id) return;
    try {
      await api.leaveGroup(id);
      setGroup(await api.getGroup(id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const saveSettings = async () => {
    if (!id || !editName.trim()) return;
    try {
      const updated = await api.updateGroup(id, {
        name: editName.trim(),
        description: editDescription,
        visibility: editVisibility,
      });
      setGroup(updated);
      setSettingsOpen(false);
      toast.success(t("groups.saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const deleteGroup = async () => {
    if (!id) return;
    try {
      await api.deleteGroup(id);
      window.location.hash = "#/groups";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const addMember = async () => {
    if (!id || !memberName.trim()) return;
    try {
      setMembers(await api.addGroupMember(id, memberName.trim()));
      setMemberName("");
      toast.success(t("groups.memberAdded"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const removeMember = async (member: GroupMember) => {
    if (!id) return;
    try {
      await api.removeGroupMember(id, member.userId);
      await refreshMembers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const changeRole = async (member: GroupMember, role: "moderator" | "member") => {
    if (!id) return;
    try {
      setMembers(await api.setGroupMemberRole(id, member.userId, role));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleBan = async (member: GroupMember) => {
    if (!id) return;
    try {
      setMembers(
        member.banned
          ? await api.unbanGroupMember(id, member.userId)
          : await api.banGroupMember(id, member.userId),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const authorOf = (msg: GroupMessage): User | undefined => usersById.get(msg.userId);

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      {/* Шапка группы */}
      <div className="flex items-center gap-2 border-b border-border p-3">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" asChild>
          <Link to="/groups" aria-label={t("common.back")}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-foreground text-background">
          {group.avatarUrl ? (
            <img src={group.avatarUrl} alt="" className="h-9 w-9 object-cover" />
          ) : (
            <Users className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate text-sm font-semibold">
            {group.visibility === "private" && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
            {group.name}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {t("groups.membersCount", { count: group.memberCount })}
            {group.myRole ? ` · ${t(`groups.role${group.myRole === "owner" ? "Owner" : group.myRole === "moderator" ? "Moderator" : "Member"}`)}` : ""}
          </p>
        </div>
        {group.isBanned ? (
          <span className="rounded-full bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
            {t("groups.bannedInGroup")}
          </span>
        ) : group.isMember ? (
          <>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={openMembers} aria-label={t("groups.members")}>
              <Users className="h-4 w-4" />
            </Button>
            {group.isOwner && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={openSettings} aria-label={t("groups.settings")}>
                <Settings2 className="h-4 w-4" />
              </Button>
            )}
            {!group.isOwner && (
              <Button variant="outline" size="sm" onClick={leave}>
                {t("groups.leave")}
              </Button>
            )}
          </>
        ) : (
          <Button size="sm" onClick={join}>
            {t("groups.join")}
          </Button>
        )}
      </div>

      {/* Закреплённое сообщение */}
      {pinned && (
        <div className="flex items-start gap-2 border-b border-border bg-secondary/40 px-3 py-2">
          <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 text-[11px]">
            <p className="font-medium">
              {t("groups.pinned")} · @{pinned.authorUsername}
            </p>
            <p className="truncate text-muted-foreground">{pinned.text || "—"}</p>
          </div>
          {canModerate && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => togglePin(null)}
              aria-label={t("groups.unpin")}
            >
              <PinOff className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}

      {/* Сообщения */}
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {!group.isMember ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Users className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("groups.joinToRead")}</p>
            <Button size="sm" onClick={join}>
              {t("groups.join")}
            </Button>
          </div>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{t("groups.noMessages")}</p>
        ) : (
          messages.map((msg) => {
            const author = authorOf(msg);
            const mine = msg.userId === user?.id;
            return (
              <div key={msg.id} className={cn("group flex gap-2", mine ? "justify-end" : "justify-start")}>
                {!mine && (
                  <Link to={`/u/${author?.username ?? msg.authorUsername}`} className="mt-auto shrink-0">
                    <UserAvatar
                      user={
                        author ?? {
                          id: msg.userId,
                          username: msg.authorUsername ?? "?",
                          fullName: msg.authorFullName ?? "",
                          avatarUrl: msg.authorAvatarUrl,
                        } as User
                      }
                      size="sm"
                    />
                  </Link>
                )}
                <div className={cn("max-w-[75%]", mine && "text-right")}>
                  {!mine && (
                    <p className="mb-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Link to={`/u/${author?.username ?? msg.authorUsername}`} className="font-medium hover:underline">
                        {author ? <UserName user={author} /> : `@${msg.authorUsername}`}
                      </Link>
                      {author && <UserBadges user={author} />}
                    </p>
                  )}
                  <div
                    className={cn(
                      "inline-block rounded-2xl px-3 py-1.5 text-left text-sm",
                      mine
                        ? "rounded-br-md bg-foreground text-background"
                        : "rounded-bl-md bg-secondary text-foreground",
                    )}
                    style={mine ? undefined : bubbleStyle(author)}
                  >
                    {msg.text && <p className="whitespace-pre-wrap break-words">{msg.text}</p>}
                    {msg.imageUrl && (
                      <img
                        src={msg.imageUrl}
                        alt=""
                        className="mt-1.5 max-h-60 w-full rounded-xl border border-black/10 object-cover"
                      />
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <TimeAgo iso={msg.createdAt} />
                    {canModerate && (
                      <button
                        type="button"
                        onClick={() => togglePin(msg.id)}
                        className="hover:text-foreground"
                        aria-label={t("groups.pin")}
                      >
                        <Pin className="h-3 w-3" />
                      </button>
                    )}
                    {(mine || canModerate) && (
                      <button
                        type="button"
                        onClick={() => removeMessage(msg.id)}
                        className="hover:text-destructive"
                        aria-label={t("common.delete")}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Ввод */}
      {group.isMember && !group.isBanned && (
        <div className="border-t border-border p-3">
          {pendingImage && (
            <div className="relative mb-2 w-20">
              <img src={pendingImage} alt="" className="h-20 w-20 rounded-xl border border-border object-cover" />
              <button
                type="button"
                onClick={() => setPendingImage(null)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background"
                aria-label={t("common.cancel")}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void pickImage(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-muted-foreground"
              onClick={() => fileRef.current?.click()}
              aria-label={t("chat.attachImage")}
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("groups.messagePlaceholder")}
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
            <Button
              size="icon"
              className="h-9 w-9 shrink-0 rounded-full"
              onClick={send}
              disabled={!input.trim() && !pendingImage}
              aria-label={t("chat.send")}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Участники */}
      <Dialog open={membersOpen} onOpenChange={setMembersOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("groups.members")}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {(canModerate || group.isOwner) && (
              <div className="flex gap-2">
                <Input
                  value={memberName}
                  onChange={(e) => setMemberName(e.target.value)}
                  placeholder={t("groups.memberUsername")}
                  onKeyDown={(e) => e.key === "Enter" && addMember()}
                />
                <Button variant="outline" size="sm" onClick={addMember}>
                  <UserPlus className="h-4 w-4" />
                  {t("groups.addMember")}
                </Button>
              </div>
            )}
            {members.map((member) => (
              <div key={member.userId} className="flex items-center gap-2 rounded-xl border border-border p-2">
                <UserAvatar
                  user={{ id: member.userId, username: member.username, fullName: member.fullName, avatarUrl: member.avatarUrl } as User}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-xs font-medium">
                    @{member.username}
                    {member.role === "owner" && <Shield className="h-3 w-3 text-amber-500" />}
                    {member.role === "moderator" && <Shield className="h-3 w-3 text-blue-500" />}
                    {member.banned && <span className="text-[10px] text-destructive">({t("groups.bannedInGroup")})</span>}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">{member.fullName}</p>
                </div>
                {member.role !== "owner" && (group.isOwner || (canModerate && member.role === "member")) && (
                  <div className="flex shrink-0 items-center gap-1">
                    {group.isOwner && (
                      <Select
                        value={member.role}
                        onValueChange={(v) => changeRole(member, v as "moderator" | "member")}
                      >
                        <SelectTrigger className="h-7 w-28 text-[11px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">{t("groups.roleMember")}</SelectItem>
                          <SelectItem value="moderator">{t("groups.roleModerator")}</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() => toggleBan(member)}
                      aria-label={member.banned ? t("groups.unban") : t("groups.ban")}
                    >
                      <Shield className={cn("h-3.5 w-3.5", member.banned && "text-destructive")} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => removeMember(member)}
                      aria-label={t("groups.removeMember")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Настройки группы (владелец) */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("groups.settings")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="group-edit-name">{t("groups.name")}</Label>
              <Input id="group-edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={40} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="group-edit-desc">{t("groups.description")}</Label>
              <Input id="group-edit-desc" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("groups.visibility")}</Label>
              <Select value={editVisibility} onValueChange={(v) => setEditVisibility(v as GroupVisibility)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">{t("groups.visibilityPublic")}</SelectItem>
                  <SelectItem value="private">{t("groups.visibilityPrivate")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 pt-1">
              <Button className="flex-1" onClick={saveSettings}>
                {t("groups.save")}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="text-destructive hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("groups.deleteTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>{t("groups.deleteHint")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={deleteGroup}>{t("common.delete")}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
export default GroupChat;
