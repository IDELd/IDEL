import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AtSign, MessageCircle, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '../context/auth';
import * as api from '../lib/api';
import { useNicknameCheck } from '@/hooks/use-nickname-check';
import { SessionsPanel } from '@/components/settings/SessionsPanel';
import { PremiumPanel } from '@/components/settings/PremiumPanel';
import { ChangePasswordForm } from '@/components/settings/ChangePasswordForm';
import { FORBIDDEN_USERNAME_MESSAGE } from '@/lib/validation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

const Settings: React.FC = () => {
  const { t } = useTranslation();
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [newUsername, setNewUsername] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSuccess, setUsernameSuccess] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [botId, setBotId] = useState<string | null>(null);

  // Живая проверка ника по таблице запрещённых слов.
  const nicknameForbidden = useNicknameCheck(newUsername);

  useEffect(() => {
    if (!user) return;
    api.getVerifyBotUser().then((bot) => setBotId(bot.id)).catch(() => setBotId(null));
  }, [user]);

  if (!user) {
    navigate('/login');
    return null;
  }

  const handleChangeUsername = async () => {
    const username = newUsername.trim().toLowerCase();
    if (!username) return;
    setUsernameSuccess(false);
    if (nicknameForbidden) {
      setUsernameError(t('auth.usernameForbidden'));
      return;
    }
    try {
      await api.changeUsername(username);
      await refresh();
      setNewUsername('');
      setUsernameError(null);
      setUsernameSuccess(true);
      navigate(`/u/${username}`, { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setUsernameError(message === FORBIDDEN_USERNAME_MESSAGE ? t('auth.usernameForbidden') : message);
    }
  };

  const handleDeleteAccount = async () => {
    await api.deleteAccount();
    logout();
    navigate('/login');
  };

  return (
    <div className="space-y-4">
      <h1 className="px-1 text-xl font-bold">{t('settings.title')}</h1>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <AtSign className="h-4 w-4" />
          {t('settings.changeUsername')}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t('settings.changeUsernameHint')}</p>
        <div className="mt-3 space-y-2">
          <Input
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder={t('settings.newUsernamePlaceholder')}
            aria-invalid={nicknameForbidden}
            className={nicknameForbidden ? 'border-destructive' : undefined}
          />
          {nicknameForbidden && (
            <p className="text-xs font-medium text-destructive">{t('auth.usernameForbidden')}</p>
          )}
          {usernameError && !nicknameForbidden && (
            <p className="text-xs font-medium text-destructive">{usernameError}</p>
          )}
          {usernameSuccess && (
            <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {t('settings.usernameChanged')}
            </p>
          )}
          <Button size="sm" onClick={handleChangeUsername} disabled={!newUsername.trim()}>
            {t('settings.changeUsernameButton')}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
        <h2 className="text-sm font-semibold">{t('settings.more')}</h2>
        <div className="mt-3 grid gap-2">
          <Button variant="outline" className="justify-start" asChild>
            <Link to="/friends">
              <Users className="h-4 w-4" />
              {t('nav.friends')}
            </Link>
          </Button>
          <Button variant="outline" className="justify-start" asChild>
            <Link to="/chat">
              <MessageCircle className="h-4 w-4" />
              {t('nav.messages')}
            </Link>
          </Button>
          {botId && (
            <Button variant="outline" className="justify-start" asChild>
              <Link to={`/chat/${botId}`}>
                <ShieldCheck className="h-4 w-4" />
                @verifybot — {t('verifyBot.getVerified')}
              </Link>
            </Button>
          )}
        </div>
      </div>

      <PremiumPanel />

      <SessionsPanel />

      <ChangePasswordForm />

      <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5">
        <h2 className="text-sm font-semibold text-destructive">{t('settings.dangerZone')}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t('settings.deleteAccountHint')}</p>
        <Button
          size="sm"
          variant="destructive"
          className="mt-3"
          onClick={() => setConfirmDelete(true)}
        >
          {t('settings.deleteAccount')}
        </Button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.deleteAccount')}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.deleteAccountConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAccount}>
              {t('settings.deleteAccount')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Settings;
