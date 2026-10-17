import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/auth';
import Layout from './components/layout/Layout';
import Feed from './pages/Feed';
import AuthLogin from './pages/AutchLogin';
import AuthRegister from './pages/AutchRegister';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Profile from './pages/Profile';
import EditProfile from './pages/EditProfile';
import Search from './pages/Search';
import Notifications from './pages/Notifications';
import Channels from './pages/Channels';
import ChannelDetail from './pages/ChannelDetail';
import Groups from './pages/Groups';
import GroupChat from './pages/GroupChat';
import AdminPanel from './pages/AdminPanel';
import Friends from './pages/Friends';
import Chat from './pages/Chat';
import Settings from './pages/Settings';
import Rules from './pages/Rules';
import BotDocs from './pages/BotDocs';
import Achievements from './pages/Achievements';
import NotFound from './pages/NotFound';
import './index.css';
import './premium.css';

/** Blocks rendering of routes until the initial /api/auth/me check resolves,
 * so pages that redirect on `!user` don't misfire during that first beat. */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      </div>
    );
  }
  return <>{children}</>;
}

const App: React.FC = () => {
  return (
    <AuthProvider>
      <HashRouter>
        <AuthGate>
          <Routes>
            <Route path="/login" element={<AuthLogin />} />
            <Route path="/register" element={<AuthRegister />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route element={<Layout />}>
              <Route path="/" element={<Feed />} />
              {/* Post creation now happens in a modal opened from the bottom nav. */}
              <Route path="/create" element={<Navigate to="/" replace />} />
              <Route path="/search" element={<Search />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/channels" element={<Channels />} />
              <Route path="/channels/:id" element={<ChannelDetail />} />
              <Route path="/groups" element={<Groups />} />
              <Route path="/groups/:id" element={<GroupChat />} />
              <Route path="/u/:username" element={<Profile />} />
              <Route path="/u/:username/edit" element={<EditProfile />} />
              <Route path="/admin" element={<AdminPanel />} />
              <Route path="/friends" element={<Friends />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/chat/:userId" element={<Chat />} />
              <Route path="/settings" element={<Settings />} />
              {/* Публичная страница правил: доступна и без входа. */}
              <Route path="/rules" element={<Rules />} />
              {/* Документация API ботов: ссылку присылает @creatorbot. */}
              <Route path="/bot-docs/:token" element={<BotDocs />} />
              {/* Достижения: свои и публичные у другого профиля. */}
              <Route path="/achievements" element={<Achievements />} />
              <Route path="/achievements/:username" element={<Achievements />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </AuthGate>
      </HashRouter>
    </AuthProvider>
  );
};

export default App;