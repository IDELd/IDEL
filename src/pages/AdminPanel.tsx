import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Flag,
  ShieldCheck,
  ShieldX,
} from 'lucide-react';
import { useAuth } from '../context/auth';
import * as api from '../lib/api';
import type { Channel, User, VerificationRequest, Report } from '../lib/types';
import type { AdminStats } from '../lib/api';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { VerificationTab } from '@/components/admin/VerificationTab';
import { BansTab } from '@/components/admin/BansTab';
import { RulesTab } from '@/components/admin/RulesTab';
import { WarningsAppealsTab } from '@/components/admin/WarningsAppealsTab';
import { ForbiddenWordsTab } from '@/components/admin/ForbiddenWordsTab';

const AdminPanel: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [verificationRequests, setVerificationRequests] = useState<VerificationRequest[]>([]);
  const [requesters, setRequesters] = useState<Map<string, User>>(new Map());
  const [reports, setReports] = useState<Report[]>([]);
  const [reportUsers, setReportUsers] = useState<Map<string, User>>(new Map());
  const [bannedIds, setBannedIds] = useState<Set<string>>(new Set());
  const [censorEnabled, setCensorEnabledState] = useState(true);

  const load = async () => {
    if (!user?.isAdmin) return;
    const [badgeTargets, adminStats, allVerifReqs, allReports, censor] = await Promise.all([
      api.getBadgeTargets(),
      api.getAdminStats(),
      api.getVerificationRequests(),
      api.getReports(),
      api.isCensorEnabled(),
    ]);
    const allUsers = badgeTargets.users;
    setUsers(allUsers);
    setChannels(badgeTargets.channels);
    setStats(adminStats);
    const pendingVerif = allVerifReqs.filter((r) => r.status === 'pending');
    setVerificationRequests(pendingVerif);
    const pendingReports = allReports.filter((r) => r.status === 'pending');
    setReports(pendingReports);
    setCensorEnabledState(censor);

    const usersById = new Map(allUsers.map((u) => [u.id, u]));
    setRequesters(new Map(pendingVerif.map((r) => [r.userId, usersById.get(r.userId)]).filter((e): e is [string, User] => !!e[1])));
    const reportUserIds = new Set<string>();
    pendingReports.forEach((r) => {
      reportUserIds.add(r.reporterUserId);
      reportUserIds.add(r.reportedUserId);
    });
    setReportUsers(new Map(Array.from(reportUserIds).map((id) => [id, usersById.get(id)]).filter((e): e is [string, User] => !!e[1])));

    const banStatuses = await Promise.all(allUsers.map(async (u) => [u.id, (await api.getBanStatus(u.id)).banned] as const));
    setBannedIds(new Set(banStatuses.filter(([, banned]) => banned).map(([id]) => id)));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (!user?.isAdmin) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-5 text-center text-sm font-medium text-destructive">
        {t('admin.forbidden')}
      </div>
    );
  }

  const handleReport = async (reportId: string, action: 'resolve' | 'dismiss') => {
    await api.resolveReport(reportId, action);
    load();
  };

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 px-1 text-xl font-bold">
        <ShieldCheck className="h-5 w-5" />
        {t('admin.title')}
      </h1>

      <Tabs defaultValue="stats">
        {/* Одна строка без переносов: на узком экране вкладки прокручиваются. */}
        <TabsList className="w-full flex-nowrap justify-start gap-1 overflow-x-auto">
          <TabsTrigger value="stats">{t('admin.stats')}</TabsTrigger>
          <TabsTrigger value="verification">
            {t('admin.verification')}
            {verificationRequests.length > 0 && (
              <span className="ml-1 rounded-full bg-foreground px-1.5 text-[10px] text-background">
                {verificationRequests.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="bans">{t('admin.bans')}</TabsTrigger>
          <TabsTrigger value="moderation">{t('admin.moderation')}</TabsTrigger>
          <TabsTrigger value="rules">{t('admin.rules')}</TabsTrigger>
          <TabsTrigger value="forbidden">{t('admin.forbiddenWordsTab')}</TabsTrigger>
          <TabsTrigger value="reports">
            {t('admin.reports')}
            {reports.length > 0 && (
              <span className="ml-1 rounded-full bg-foreground px-1.5 text-[10px] text-background">
                {reports.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="censor">{t('admin.censor')}</TabsTrigger>
        </TabsList>

        <TabsContent value="stats" className="mt-4 grid grid-cols-2 gap-3">
          {stats && [
            [stats.users, t('admin.statUsers')],
            [stats.posts, t('admin.statPosts')],
            [stats.comments, t('admin.statComments')],
            [`#${stats.channels}`, t('admin.statChannels')],
            [stats.aktiviki, t('admin.statAktiviki')],
          ].map(([value, label], index, list) => (
            <div
              key={String(label)}
              // Плиток нечётное число — последняя занимает всю строку, чтобы сетка не выглядела обрезанной.
              className={`rounded-2xl border border-border bg-card p-4 text-center shadow-soft${
                index === list.length - 1 && list.length % 2 === 1 ? ' col-span-2' : ''
              }`}
            >
              <p className="text-2xl font-bold">{value}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="verification" className="mt-4">
          <VerificationTab
            requests={verificationRequests}
            requesters={requesters}
            users={users}
            channels={channels}
            onChanged={load}
          />
        </TabsContent>

        <TabsContent value="bans" className="mt-4">
          <BansTab users={users} bannedIds={bannedIds} onChanged={load} />
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          <RulesTab />
        </TabsContent>

        <TabsContent value="moderation" className="mt-4">
          <WarningsAppealsTab />
        </TabsContent>

        <TabsContent value="forbidden" className="mt-4">
          <ForbiddenWordsTab />
        </TabsContent>

        <TabsContent value="reports" className="mt-4 space-y-2">
          {reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('admin.noReports')}</p>
          ) : (
            reports.map((r) => {
              const reporter = reportUsers.get(r.reporterUserId);
              const reported = reportUsers.get(r.reportedUserId);
              return (
                <div key={r.id} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
                  <div className="flex flex-wrap items-center gap-1 text-sm">
                    <Flag className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">@{reporter?.username ?? '?'}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="font-medium">@{reported?.username ?? '?'}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground">{r.reason}</p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleReport(r.id, 'resolve')}>
                      <ShieldX className="h-4 w-4" />
                      {t('admin.resolve')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleReport(r.id, 'dismiss')}>
                      {t('admin.dismiss')}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="censor" className="mt-4">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div>
              <h3 className="text-sm font-semibold">{t('admin.censor')}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{t('admin.censorHint')}</p>
            </div>
            <Switch
              checked={censorEnabled}
              onCheckedChange={async (checked) => {
                await api.setCensorEnabled(checked);
                load();
              }}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminPanel;
