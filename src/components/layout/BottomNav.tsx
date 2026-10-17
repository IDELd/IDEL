import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home, Search, User, Hash, Plus, UsersRound } from 'lucide-react';
import { useAuth } from '../../context/auth';
import { cn } from '@/lib/utils';

interface BottomNavProps {
  onCreate?: () => void;
}

const BottomNav: React.FC<BottomNavProps> = ({ onCreate }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const location = useLocation();

  if (!user) return null;

  const links = [
    { path: '/', label: t('nav.feed'), icon: Home },
    { path: '/search', label: t('nav.search'), icon: Search },
    { path: `/u/${user.username}`, label: t('nav.profile'), icon: User },
    { path: '/channels', label: t('nav.channels'), icon: Hash },
    { path: '/groups', label: t('nav.groups'), icon: UsersRound },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 backdrop-blur-md lg:hidden">
      <div className="mx-auto flex w-full max-w-md items-center justify-around px-2 py-2">
        {links.map(({ path, label, icon: Icon }) => {
          const active = location.pathname === path;
          return (
            <Link
              key={path}
              to={path}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-[11px] transition-colors',
                active
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
              <span>{label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onCreate}
          aria-label={t('nav.create')}
          className="flex flex-col items-center gap-0.5 text-[11px] text-muted-foreground"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background shadow-soft transition-transform hover:scale-105">
            <Plus className="h-5 w-5" />
          </span>
          <span>{t('nav.create')}</span>
        </button>
      </div>
    </nav>
  );
};

export default BottomNav;
