import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Feather } from 'lucide-react';
import { useAuth } from '../context/auth';
import * as api from '../lib/api';
import * as events from '../lib/events';
import type { Post } from '../lib/types';
import { PostCard } from '@/components/post/PostCard';
import { Button } from '@/components/ui/button';

const Feed: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [ban, setBan] = useState<{ banned: boolean; reason: string | null } | null>(null);

  const loadPosts = () => {
    api.getPosts().then(setPosts);
  };

  useEffect(() => {
    if (!user) return;
    loadPosts();
    api.getBanStatus(user.id).then(setBan);
    const off = events.on('posts-changed', loadPosts);
    const interval = setInterval(loadPosts, 5000);
    return () => {
      off();
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <h1 className="bg-brand-gradient bg-clip-text text-3xl font-extrabold tracking-tight text-transparent">
          {t('common.appName')}
        </h1>
        <p className="max-w-xs text-sm text-muted-foreground">{t('auth.loginSubtitle')}</p>
        <Button asChild className="mt-2">
          <Link to="/login">{t('auth.loginButton')}</Link>
        </Button>
      </div>
    );
  }

  if (ban?.banned) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5 text-center">
        <p className="font-bold text-destructive">{t('ban.title')}</p>
        <p className="mt-1 text-sm text-destructive/80">
          {t('ban.reason')}: {ban.reason || t('ban.noReason')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">{t('nav.feed')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('feed.subtitle')}</p>
      </div>

      {posts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-16 text-center">
          <Feather className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium">{t('feed.empty')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} onChange={loadPosts} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Feed;
