import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import {
  Hash,
  ImagePlus,
  Lock,
  Paintbrush,
  Send,
  Settings2,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type {
  Channel,
  ChannelMember,
  ChannelPost,
  ChannelPostPolicy,
  ChannelVisibility,
  User,
} from "@/lib/types";
import { downscaleImage, fileToDataUrl } from "@/lib/media";
import { UserAvatar } from "@/components/common/UserAvatar";
import { BadgeLevel } from "@/components/common/BadgeLevel";
import { UserName, UserBadges } from "@/components/common/PremiumBadge";
import { softTintStyle } from "@/lib/premium";
import { TimeAgo } from "@/components/common/TimeAgo";
import { DrawingTool, type DrawingToolHandle } from "@/components/post/DrawingTool";

export function ChannelDetail() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [content, setContent] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [drawingMode, setDrawingMode] = useState(false);
  const drawingRef = useRef<DrawingToolHandle | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [channel, setChannel] = useState<Channel | null | undefined>(undefined);
  const [posts, setPosts] = useState<ChannelPost[]>([]);
  const [usersById, setUsersById] = useState<Map<string, User>>(new Map());
  const [accessError, setAccessError] = useState<string | null>(null);

  // Настройки канала (владелец).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editVisibility, setEditVisibility] = useState<ChannelVisibility>("public");
  const [editPolicy, setEditPolicy] = useState<ChannelPostPolicy>("owner");
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [memberName, setMemberName] = useState("");

  const load = async () => {
    if (!id) return;
    try {
      const { channel: found, posts: channelPosts } = await api.getChannel(id);
      setChannel(found);
      setPosts(channelPosts);
      setAccessError(null);
      const users = await api.getUsersCached();
      setUsersById(new Map(users.map((u) => [u.id, u])));
    } catch (error) {
      setChannel(null);
      setAccessError(error instanceof ApiError ? error.code ?? null : null);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (channel === undefined) return null;

  if (!channel) {
    const isPrivate = accessError === "private_channel";
    return (
      <div className="rounded-2xl border border-dashed border-border px-6 py-16 text-center">
        <p className="text-sm font-semibold">
          {isPrivate ? t("channels.privateTitle") : t("channels.notFound")}
        </p>
        {isPrivate && <p className="mt-1 text-xs text-muted-foreground">{t("channels.privateHint")}</p>}
        <Button variant="outline" className="mt-4" asChild>
          <Link to="/channels">{t("channels.title")}</Link>
        </Button>
      </div>
    );
  }

  const handleFile = async (file?: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    const raw = await fileToDataUrl(file);
    setImage(await downscaleImage(raw));
    if (fileRef.current) fileRef.current.value = "";
  };

  const publish = async () => {
    if (!user) return;
    const drawing = drawingMode ? drawingRef.current?.getDrawing() ?? null : null;
    if (!content.trim() && !image && !drawing) {
      toast.error(t("post.needContent"));
      return;
    }
    try {
      const created = await api.createChannelPost(channel.id, {
        content,
        imageUrl: image,
        drawingUrl: drawing,
      });
      if (created.censored) toast(t("common.editedByCensor"));
      setContent("");
      setImage(null);
      setDrawingMode(false);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const removePost = async (postId: string) => {
    await api.deleteChannelPost(postId);
    load();
  };

  const openSettings = async () => {
    setEditName(channel.name);
    setEditDescription(channel.description);
    setEditVisibility(channel.visibility);
    setEditPolicy(channel.postPolicy);
    setSettingsOpen(true);
    try {
      setMembers(await api.getChannelMembers(channel.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const saveSettings = async () => {
    if (!editName.trim()) {
      toast.error(t("channels.needName"));
      return;
    }
    try {
      await api.updateChannel(channel.id, {
        name: editName,
        description: editDescription,
        visibility: editVisibility,
        postPolicy: editPolicy,
      });
      toast.success(t("channels.saved"));
      setSettingsOpen(false);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const addMember = async () => {
    if (!memberName.trim()) return;
    try {
      setMembers(await api.addChannelMember(channel.id, memberName.trim()));
      setMemberName("");
      toast.success(t("channels.memberAdded"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const removeMember = async (userId: string) => {
    try {
      await api.removeChannelMember(channel.id, userId);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
      toast.success(t("channels.memberRemoved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const postHint =
    channel.postPolicy === "members" ? t("channels.cannotPostMembers") : t("channels.cannotPostOwner");

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
            {channel.visibility === "private" ? <Lock className="h-5 w-5" /> : <Hash className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-1.5 truncate text-lg font-bold">
              {channel.name}
              <BadgeLevel level={channel.badgeLevel} />
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {channel.description || "—"}
            </p>
            <p className="mt-0.5 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
              <span className="rounded-full bg-secondary px-1.5 py-0.5">
                {channel.visibility === "private"
                  ? t("channels.visibilityPrivate")
                  : t("channels.visibilityPublic")}
              </span>
              <span className="rounded-full bg-secondary px-1.5 py-0.5">
                {channel.postPolicy === "anyone"
                  ? t("channels.postPolicyAnyone")
                  : channel.postPolicy === "members"
                    ? t("channels.postPolicyMembers")
                    : t("channels.postPolicyOwner")}
              </span>
            </p>
          </div>
          {channel.isOwner && (
            <Button variant="outline" size="sm" onClick={openSettings}>
              <Settings2 className="h-4 w-4" />
              {t("channels.settings")}
            </Button>
          )}
        </div>
      </div>

      {channel.canPost ? (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t("channels.postPlaceholder")}
            rows={2}
            className="resize-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" />
              {t("post.attachImage")}
            </Button>
            <Button
              variant={drawingMode ? "default" : "outline"}
              size="sm"
              type="button"
              onClick={() => setDrawingMode((d) => !d)}
            >
              <Paintbrush className="h-4 w-4" />
              {t("post.attachDrawing")}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
            <Button size="sm" className="ml-auto" onClick={publish}>
              <Send className="h-4 w-4" />
              {t("common.publish")}
            </Button>
          </div>

          {image && (
            <div className="relative mt-3 overflow-hidden rounded-xl border">
              <img src={image} alt="" className="w-full" />
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute right-2 top-2 h-7 w-7 rounded-full"
                onClick={() => setImage(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
          {drawingMode && <div className="mt-3"><DrawingTool ref={drawingRef} /></div>}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
          {postHint}
        </p>
      )}

      {posts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          {t("channels.noPosts")}
        </p>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => {
            const author = usersById.get(post.userId);
            if (!author) return null;
            return (
              <article
                key={post.id}
                className="rounded-2xl border border-border bg-card p-4 shadow-soft"
                style={softTintStyle(author)}
              >
                <div className="flex items-start gap-2.5">
                  <Link to={`/u/${author.username}`} className="shrink-0">
                    <UserAvatar user={author} size="sm" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <Link
                        to={`/u/${author.username}`}
                        className="truncate text-xs font-semibold hover:underline"
                      >
                        <UserName user={author} />
                      </Link>
                      <UserBadges user={author} />
                      <TimeAgo
                        iso={post.createdAt}
                        className="ml-auto shrink-0 text-[10px] text-muted-foreground"
                      />
                    </div>
                    {post.content && (
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                        {post.content}
                      </p>
                    )}
                    {post.imageUrl && (
                      <img src={post.imageUrl} alt="" className="mt-2 w-full rounded-xl border" />
                    )}
                    {post.drawingUrl && (
                      <div className="mt-2 overflow-hidden rounded-xl border">
                        <img src={post.drawingUrl} alt="" className="w-full" />
                      </div>
                    )}
                    {(user?.id === post.userId || channel.isOwner) && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="mt-1.5 h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => removePost(post.id)}
                        aria-label={t("common.delete")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("channels.settings")}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label htmlFor="edit-channel-name">{t("channels.name")}</Label>
              <Input
                id="edit-channel-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={40}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-channel-desc">{t("channels.description")}</Label>
              <Textarea
                id="edit-channel-desc"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("channels.visibility")}</Label>
              <Select value={editVisibility} onValueChange={(v) => setEditVisibility(v as ChannelVisibility)}>
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
              <Select value={editPolicy} onValueChange={(v) => setEditPolicy(v as ChannelPostPolicy)}>
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

            <div className="space-y-1.5 border-t pt-3">
              <Label>{t("channels.members")}</Label>
              <div className="flex gap-2">
                <Input
                  value={memberName}
                  onChange={(e) => setMemberName(e.target.value)}
                  placeholder={t("channels.memberUsername")}
                  onKeyDown={(e) => e.key === "Enter" && addMember()}
                />
                <Button variant="outline" size="sm" onClick={addMember}>
                  <UserPlus className="h-4 w-4" />
                  {t("channels.addMember")}
                </Button>
              </div>
              {members.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("channels.noMembers")}</p>
              ) : (
                <ul className="space-y-1">
                  {members.map((member) => (
                    <li
                      key={member.userId}
                      className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-xs">
                        @{member.username}
                        <span className="ml-1.5 text-muted-foreground">{member.fullName}</span>
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => removeMember(member.userId)}
                        aria-label={t("common.delete")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSettingsOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={saveSettings}>{t("channels.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
export default ChannelDetail;
