import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Heart, MessageCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { useAuth } from "@/context/auth";
import * as api from "@/lib/api";
import type { Post, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/common/UserAvatar";
import { UserName, UserBadges } from "@/components/common/PremiumBadge";
import { softTintStyle } from "@/lib/premium";
import { TimeAgo } from "@/components/common/TimeAgo";
import { CommentSection } from "./CommentSection";

export function PostCard({ post, onChange }: { post: Post; onChange: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [author, setAuthor] = useState<User | null>(null);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getUserById(post.userId).then((u) => !cancelled && setAuthor(u ?? null));
    api.getComments(post.id).then((c) => !cancelled && setCommentCount(c.length));
    if (user) {
      api.getLikeStatus(post.id).then((s) => {
        if (cancelled) return;
        setLiked(s.liked);
        setLikeCount(s.count);
      });
    } else {
      api.getLikeStatus(post.id).catch(() => {
        // not logged in edge case — ignore, count stays 0
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id, post.userId]);

  if (!author) return null;

  const toggleLike = async () => {
    if (!user) return;
    const result = await api.toggleLike(post.id);
    setLiked(result.liked);
    setLikeCount(result.count);
    onChange();
  };

  const removePost = async () => {
    await api.deletePost(post.id);
    setConfirmDelete(false);
    onChange();
  };

  return (
    <article
      className="animate-fade-up rounded-2xl border border-border bg-card p-4 shadow-soft transition-colors hover:border-foreground/20"
      style={softTintStyle(author)}
    >
      <div className="flex items-start gap-3">
        <Link to={`/u/${author.username}`} className="shrink-0">
          <UserAvatar user={author} size="md" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <Link
              to={`/u/${author.username}`}
              className="truncate text-sm font-semibold hover:underline"
            >
              <UserName user={author} />
            </Link>
            <UserBadges user={author} />
          </div>
          <p className="truncate text-xs text-muted-foreground">{author.fullName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <TimeAgo iso={post.createdAt} className="text-xs text-muted-foreground" />
          {user?.id === author.id && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
              aria-label={t("post.deletePost")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {post.content && (
        <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed">
          {post.content}
        </p>
      )}

      {post.imageUrl && (
        <img
          src={post.imageUrl}
          alt=""
          className="mt-3 w-full rounded-xl border border-border"
        />
      )}

      {post.drawingUrl && (
        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          <img src={post.drawingUrl} alt="" className="w-full" />
        </div>
      )}

      {post.video && (
        <video
          src={post.video.videoUrl}
          controls
          preload="metadata"
          className="mt-3 w-full rounded-xl border border-border bg-black"
        />
      )}

      <div className="mt-3 flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "text-muted-foreground",
            liked && "text-foreground hover:text-foreground",
          )}
          onClick={toggleLike}
        >
          <Heart
            className={cn("h-4 w-4", liked && "animate-pop-in fill-foreground")}
          />
          <span className="tabular-nums">{likeCount}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setCommentsOpen((o) => !o)}
        >
          <MessageCircle className="h-4 w-4" />
          <span className="tabular-nums">{commentCount}</span>
        </Button>
      </div>

      {commentsOpen && (
        <CommentSection
          postId={post.id}
          onChange={() => {
            api.getComments(post.id).then((c) => setCommentCount(c.length));
            onChange();
          }}
        />
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("post.deletePost")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("post.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={removePost}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
