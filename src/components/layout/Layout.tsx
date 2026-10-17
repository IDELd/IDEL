import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import BottomNav from './BottomNav';
import { Sidebar } from './Sidebar';
import { CreatePostModal } from '@/components/post/CreatePostModal';
import { emit } from '@/lib/events';

const Layout: React.FC = () => {
  const [createOpen, setCreateOpen] = useState(false);
  const openCreate = () => setCreateOpen(true);

  return (
    <div className="min-h-dvh bg-background">
      <Header />
      <div className="mx-auto flex w-full max-w-5xl gap-8 px-3 lg:px-6">
        <Sidebar onCreate={openCreate} />
        <main className="min-w-0 flex-1 pb-28 pt-4 lg:max-w-2xl lg:pb-10">
          <div className="mx-auto w-full max-w-md lg:mx-0 lg:max-w-none">
            <Outlet />
          </div>
        </main>
      </div>
      <BottomNav onCreate={openCreate} />
      <CreatePostModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onPostCreated={() => emit('posts-changed')}
      />
    </div>
  );
};

export default Layout;