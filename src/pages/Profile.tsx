import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Award,
  MessageCircle,
  Pencil,
  Settings as SettingsIcon,
  ShieldCheck,
  UserPlus,
  UserCheck,
  Ban,
  ShieldOff,
  Flag,
} from 'lucide-react';
import { useAuth } from '../context/auth';
import * as api from '../lib/api';
import type { Post, User, FriendStatus, Rule } from '../lib/types';
import { UserAvatar } from '@/components/common/UserAvatar';
import { UserName, UserBadges } from '@/components/common/PremiumBadge';
import { BotBadge } from '@/components/common/BotBadge';
import { BannedProfileNotice, BanOwnerNotice } from '@/components/profile/BanNotice';
import { PostCard } from '@/components/post/PostCard';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface RelationState {
  followers: number;
  following: number;
  isFollowing: boolean;
  friendStatus: FriendStatus;
  iBlockedThem: boolean;
  theyBlockedMe: boolean;
  banned: boolean;
  banReason: string | null;
  banRuleNumber: number | null;
  banDaysLeft: number | null;
  banExpiresAt: string | null;
  banIsAuto: boolean;
}

const Profile: React.FC = () => {
  const { t } = useTranslation();
  const { username } = useParams<{ username: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<User | null | undefined>(undefined);
  const [posts, setPosts] = useState<Post[]>([]);
  const [relation, setRelation] = useState<RelationState | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [rules, setRules] = useState<Rule[]>([]);

  const load = async () => {
    const found = await api.getUserByUsername(username || '');
    setProfile(found);
    if (!found) return;

    const [userPosts, counts, banStatus, allRules] = await Promise.all([
      api.getPostsByUser(found.id),
      api.getFollowCounts(found.id),
      api.getBanStatus(found.id),
      api.getRules().catch(() => [] as Rule[]),
    ]);
    setPosts(userPosts);
    setRules(allRules);

    if (user && user.id !== found.id) {
      const [followStatus, friendStatus, blockStatus] = await Promise.all([
        api.getFollowStatus(found.id),
        api.getFriendStatus(found.id),
        api.getBlockStatus(found.id),
      ]);
      setRelation({
        followers: counts.followers,
        following: counts.following,
        isFollowing: followStatus.following,
        friendStatus,
        iBlockedThem: blockStatus.iBlockedThem,
        theyBlockedMe: blockStatus.theyBlockedMe,
        banned: banStatus.banned,
        banReason: banStatus.reason,
        banRuleNumber: banStatus.ruleNumber ?? null,
        banDaysLeft: banStatus.daysLeft ?? null,
        banExpiresAt: banStatus.expiresAt ?? null,
        banIsAuto: !!banStatus.isAuto,
      });
    } else {
      setRelation({
        followers: counts.followers,
        following: counts.following,
        isFollowing: false,
        friendStatus: 'none',
        iBlockedThem: false,
        theyBlockedMe: false,
        banned: banStatus.banned,
        banReason: banStatus.reason,
        banRuleNumber: banStatus.ruleNumber ?? null,
        banDaysLeft: banStatus.daysLeft ?? null,
        banExpiresAt: banStatus.expiresAt ?? null,
        banIsAuto: !!banStatus.isAuto,
      });
    }
  };

  useEffect(() => {
    setProfile(undefined);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, user]);

  if (profile === undefined || !relation) {
    return null;
  }

  if (!profile) {
    return (
      <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
        {t('profile.notFound')}
      </div>
    );
  }

  const isOwn = user?.id === profile.id;
  const {
    followers,
    following,
    isFollowing,
    friendStatus,
    iBlockedThem,
    theyBlockedMe,
    banned,
    banReason,
    banRuleNumber,
    banDaysLeft,
    banExpiresAt,
    banIsAuto,
  } = relation;
  // Владелец профиля и администрация видят подробности бана, остальным
  // показывается табличка о блокировке, а посты и чаты скрыты.
  const canSeeBanDetails = isOwn || !!user?.isAdmin;
  const hideContent = banned && !canSeeBanDetails;

  const handleFollow = async () => {
    if (!user) return;
    await api.toggleFollow(profile.id);
    load();
  };

  const handleFriendAction = async () => {
    if (!user) return;
    if (friendStatus === 'none' || friendStatus === 'rejected') {
      await api.sendFriendRequest(profile.id);
    }
    load();
  };

  const handleMessage = () => {
    navigate(`/chat/${profile.id}`);
  };

  const handleBlockToggle = async () => {
    if (!user) return;
    if (iBlockedThem) {
      await api.unblockUser(profile.id);
      load();
    } else {
      setConfirmBlock(true);
    }
  };

  const confirmBlockUser = async () => {
    if (!user) return;
    await api.blockUser(profile.id);
    setConfirmBlock(false);
    load();
  };

  const submitReport = async () => {
    if (!user || !reportReason.trim()) return;
    await api.submitReport(profile.id, reportReason.trim());
    setReportReason('');
    setReportOpen(false);
  };

  const goToVerifyBot = async () => {
    const bot = await api.getVerifyBotUser();
    navigate(`/chat/${bot.id}`);
  };

  // Забаненный может написать @restorebot: он разбанивает за маты и передаёт
  // остальные апелляции администрации.
  const goToRestoreBot = async () => {
    const bot = await api.getRestoreBotUser();
    navigate(`/chat/${bot.id}`);
  };

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <div
          className="h-24 w-full bg-secondary bg-cover bg-center"
          style={profile.coverUrl ? { backgroundImage: `url(${profile.coverUrl})` } : undefined}
        />
        <div className="px-5 pb-5">
          <div className="-mt-10 flex items-end justify-between">
            <UserAvatar user={profile} size="xl" className="ring-4 ring-card" />
          </div>

          <div className="mt-3 flex items-center gap-1">
            <h1 className="truncate text-lg font-bold">
              <UserName user={profile} />
            </h1>
            {profile.isBot && <BotBadge />}
            <UserBadges user={profile} />
          </div>
          {profile.fullName && (
            <p className="text-sm text-muted-foreground">{profile.fullName}</p>
          )}
          {profile.bio && <p className="mt-2 text-sm">{profile.bio}</p>}

          {banned && canSeeBanDetails && (
            <>
              <BanOwnerNotice
                reason={banReason}
                ruleNumber={banRuleNumber}
                ruleTitle={rules.find((rule) => rule.number === banRuleNumber)?.title ?? null}
                daysLeft={banDaysLeft}
                expiresAt={banExpiresAt}
                isAuto={banIsAuto}
              />
              <Button size="sm" variant="outline" className="mt-2" onClick={goToRestoreBot}>
                <MessageCircle className="h-4 w-4" />
                {t('ban.contactRestoreBot')}
              </Button>
            </>
          )}

          <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>{t('profile.aktiviki')}: {profile.aktiviki}</span>
          </div>

          {/* Варны и ранг показываются только владельцу профиля и администрации —
              сервер отдаёт эти поля лишь в этом случае. */}
          {(isOwn || user?.isAdmin) && profile.warningsCount !== undefined && (
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>
                {t('moderation.warnings')}:{' '}
                <strong className={profile.warningsCount > 0 ? 'text-destructive' : undefined}>
                  {profile.warningsCount}
                </strong>
                <span className="ml-1 opacity-70">({t('moderation.warningsHint')})</span>
              </span>
              <span>
                {t('moderation.reputation')}: <strong>{profile.reputation ?? 100}</strong>/100
              </span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {t('profile.joined')}{' '}
            {new Date(profile.createdAt).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>

          <div className="mt-3 flex gap-4 text-sm">
            <span><strong>{posts.length}</strong> <span className="text-muted-foreground">{t('profile.posts')}</span></span>
            <span><strong>{followers}</strong> <span className="text-muted-foreground">{t('profile.followers')}</span></span>
            <span><strong>{following}</strong> <span className="text-muted-foreground">{t('profile.following')}</span></span>
          </div>

          <Link
            to={isOwn ? '/achievements' : `/achievements/${profile.username}`}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-secondary/70"
          >
            <Award className="h-3.5 w-3.5" />
            {t('achievements.title')}
          </Link>

          <div className="mt-4 flex flex-wrap gap-2">
            {profile.isBot ? (
              <Button size="sm" onClick={() => navigate(`/chat/${profile.id}`)}>
                <MessageCircle className="h-4 w-4" />
                {t('nav.messages')}
              </Button>
            ) : isOwn ? (
              <>
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/u/${profile.username}/edit`}>
                    <Pencil className="h-4 w-4" />
                    {t('profile.edit')}
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/settings">
                    <SettingsIcon className="h-4 w-4" />
                    {t('settings.title')}
                  </Link>
                </Button>
                {!profile.verified && (
                  <Button size="sm" variant="outline" onClick={goToVerifyBot}>
                    <ShieldCheck className="h-4 w-4" />
                    {t('verifyBot.getVerified')}
                  </Button>
                )}
                {profile.isAdmin && (
                  <Button size="sm" asChild>
                    <Link to="/admin">
                      <ShieldCheck className="h-4 w-4" />
                      {t('profile.adminPanel')}
                    </Link>
                  </Button>
                )}
              </>
            ) : theyBlockedMe ? (
              <p className="text-sm text-muted-foreground">{t('block.unavailable')}</p>
            ) : (
              <>
                <Button size="sm" variant={isFollowing ? 'outline' : 'default'} onClick={handleFollow}>
                  {isFollowing ? t('profile.unfollow') : t('profile.follow')}
                </Button>
                {friendStatus === 'accepted' ? (
                  <Button size="sm" variant="outline" disabled>
                    <UserCheck className="h-4 w-4" />
                    {t('friends.areFriends')}
                  </Button>
                ) : friendStatus === 'pending' ? (
                  <Button size="sm" variant="outline" disabled>
                    <UserPlus className="h-4 w-4" />
                    {t('friends.requestSent')}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={handleFriendAction}>
                    <UserPlus className="h-4 w-4" />
                    {t('friends.add')}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={handleMessage}>
                  <MessageCircle className="h-4 w-4" />
                  {t('nav.messages')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={iBlockedThem ? undefined : 'text-destructive hover:text-destructive'}
                  onClick={handleBlockToggle}
                >
                  {iBlockedThem ? <ShieldOff className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                  {iBlockedThem ? t('block.unblock') : t('block.block')}
                </Button>
                <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setReportOpen(true)}>
                  <Flag className="h-4 w-4" />
                  {t('report.action')}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {hideContent ? (
          <BannedProfileNotice username={profile.username} />
        ) : posts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('profile.noPosts')}</p>
        ) : (
          posts.map((post) => <PostCard key={post.id} post={post} onChange={load} />)
        )}
      </div>

      <AlertDialog open={confirmBlock} onOpenChange={setConfirmBlock}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('block.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('block.confirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBlockUser}>{t('block.block')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={reportOpen} onOpenChange={setReportOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('report.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('report.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <textarea
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            placeholder={t('report.placeholder')}
            rows={3}
            className="w-full resize-none rounded-lg border border-input bg-background p-2 text-sm text-foreground"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={submitReport} disabled={!reportReason.trim()}>
              {t('report.submit')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Profile;
