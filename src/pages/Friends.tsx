import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, MessageCircle, UserRound, X } from 'lucide-react';
import { useAuth } from '../context/auth';
import * as api from '../lib/api';
import type { FriendRequest, User } from '../lib/types';
import { UserAvatar } from '@/components/common/UserAvatar';
import { UserName, UserBadges } from '@/components/common/PremiumBadge';
import { Button } from '@/components/ui/button';

const Friends: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [friends, setFriends] = useState<User[]>([]);
  const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>([]);
  const [requesters, setRequesters] = useState<Map<string, User>>(new Map());

  const loadData = async () => {
    if (!user) return;
    const [friendList, requests] = await Promise.all([api.getFriends(), api.getPendingFriendRequests()]);
    setFriends(friendList);
    setPendingRequests(requests);
    const entries = await Promise.all(
      requests.map(async (r) => [r.fromUserId, await api.getUserById(r.fromUserId)] as const),
    );
    setRequesters(new Map(entries.filter((e): e is [string, User] => !!e[1])));
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleAccept = async (requestId: string) => {
    await api.acceptFriendRequest(requestId);
    loadData();
  };

  const handleReject = async (requestId: string) => {
    await api.rejectFriendRequest(requestId);
    loadData();
  };

  return (
    <div className="space-y-5">
      <h1 className="px-1 text-xl font-bold">{t('friends.title')}</h1>

      <div>
        <h2 className="px-1 text-sm font-semibold text-muted-foreground">{t('friends.requests')}</h2>
        {pendingRequests.length === 0 ? (
          <p className="mt-2 px-1 text-sm text-muted-foreground">{t('friends.noRequests')}</p>
        ) : (
          <div className="mt-2 space-y-2">
            {pendingRequests.map((req) => {
              const fromUser = requesters.get(req.fromUserId);
              if (!fromUser) return null;
              return (
                <div
                  key={req.id}
                  className="flex items-center justify-between gap-2 rounded-2xl border border-border bg-card p-3 shadow-soft"
                >
                  <Link to={`/u/${fromUser.username}`} className="flex min-w-0 items-center gap-2.5">
                    <UserAvatar user={fromUser} size="sm" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <p className="truncate text-sm font-semibold">
                          <UserName user={fromUser} />
                        </p>
                        {fromUser.verified && <UserBadges user={fromUser} />}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{fromUser.fullName}</p>
                    </div>
                  </Link>
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="icon" variant="outline" onClick={() => handleAccept(req.id)} aria-label={t('friends.accept')}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleReject(req.id)}
                      aria-label={t('friends.reject')}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h2 className="px-1 text-sm font-semibold text-muted-foreground">{t('friends.allFriends')}</h2>
        {friends.length === 0 ? (
          <div className="mt-2 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-12 text-center">
            <UserRound className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('friends.noFriends')}</p>
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {friends.map((friend) => (
              <div
                key={friend.id}
                className="flex items-center justify-between gap-2 rounded-2xl border border-border bg-card p-3 shadow-soft"
              >
                <Link to={`/u/${friend.username}`} className="flex min-w-0 items-center gap-2.5">
                  <UserAvatar user={friend} size="sm" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <p className="truncate text-sm font-semibold">
                        <UserName user={friend} />
                      </p>
                      {friend.verified && <UserBadges user={friend} />}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{friend.fullName}</p>
                  </div>
                </Link>
                <Button size="icon" variant="ghost" asChild>
                  <Link to={`/chat/${friend.id}`} aria-label={t('nav.messages')}>
                    <MessageCircle className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Friends;
