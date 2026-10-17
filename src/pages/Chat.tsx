import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ImagePlus, MessageCircle, Send, X } from 'lucide-react';
import { useAuth } from '../context/auth';
import * as api from '../lib/api';
import type { Message, User } from '../lib/types';
import { downscaleImage, fileToDataUrl } from '../lib/media';
import { UserAvatar } from '@/components/common/UserAvatar';
import { UserName, UserBadges } from '@/components/common/PremiumBadge';
import { bubbleStyle } from '@/lib/premium';
import { BotBadge } from '@/components/common/BotBadge';
import { cn } from '@/lib/utils';

const Chat: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { userId: otherUserId } = useParams<{ userId: string }>();
  const [chats, setChats] = useState<User[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    api.getChats().then(setChats);
  }, [user]);

  useEffect(() => {
    if (!user || !otherUserId) {
      setSelectedUser(null);
      return;
    }
    api.getUserById(otherUserId).then(async (target) => {
      if (!target) return;
      setSelectedUser(target);
      if (target.isBot) await api.ensureBotWelcome(target.id);
      api.getMessages(otherUserId).then(setMessages);
    });
  }, [otherUserId, user]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (user && selectedUser) {
        api.getMessages(selectedUser.id).then(setMessages);
        api.getChats().then(setChats);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [user, selectedUser]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const pickImage = async (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    const raw = await fileToDataUrl(file);
    setPendingImage(await downscaleImage(raw, 900));
  };

  const handleSend = async () => {
    if (!user || !selectedUser || (!input.trim() && !pendingImage)) return;
    const text = input.trim();
    const image = pendingImage;
    setInput('');
    setPendingImage(null);
    await api.sendMessage(selectedUser.id, text, image);
    api.getMessages(selectedUser.id).then(setMessages);
    api.getChats().then(setChats);
  };

  if (!user) return null;

  // --- Conversation view ---
  if (selectedUser) {
    return (
      <div className="flex h-[calc(100dvh-9.5rem)] flex-col">
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <button
            onClick={() => navigate('/chat')}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label={t('common.back')}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Link to={`/u/${selectedUser.username}`} className="flex min-w-0 items-center gap-2">
            <UserAvatar user={selectedUser} size="sm" />
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <p className="truncate text-sm font-semibold">
                  <UserName user={selectedUser} />
                </p>
                {selectedUser.isBot && <BotBadge />}
                <UserBadges user={selectedUser} />
              </div>
            </div>
          </Link>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto py-3">
          {messages.length === 0 ? (
            <p className="pt-10 text-center text-sm text-muted-foreground">{t('chat.noMessages')}</p>
          ) : (
            messages.map((msg) => {
              const mine = msg.fromUserId === user.id;
              const sender = mine ? user : selectedUser;
              const bubble = bubbleStyle(sender);
              return (
                <div
                  key={msg.id}
                  className={cn('flex', mine ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-soft',
                      mine ? 'bg-foreground text-background' : 'bg-secondary text-foreground',
                    )}
                    style={bubble}
                  >
                    <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                    {msg.imageUrl && (
                      <img
                        src={msg.imageUrl}
                        alt=""
                        className="mt-1.5 max-h-60 w-full rounded-xl border border-black/10 object-cover"
                      />
                    )}
                    <p className="mt-1 text-[10px] opacity-60">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {pendingImage && (
          <div className="relative mx-1 mb-2 w-24 shrink-0">
            <img src={pendingImage} alt="" className="h-24 w-24 rounded-xl border border-border object-cover" />
            <button
              type="button"
              onClick={() => setPendingImage(null)}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-background"
              aria-label={t('common.cancel')}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-border pt-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void pickImage(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label={t('chat.attachImage')}
            title={t('chat.attachImage')}
          >
            <ImagePlus className="h-4 w-4" />
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('chat.placeholder')}
            className="flex-1 rounded-full border border-input bg-background px-4 py-2 text-sm outline-none focus:border-foreground"
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() && !pendingImage}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-40"
            aria-label={t('chat.send')}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // --- Conversation list ---
  return (
    <div className="space-y-4">
      <h1 className="px-1 text-xl font-bold">{t('nav.messages')}</h1>
      {chats.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-14 text-center">
          <MessageCircle className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('chat.noChats')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {chats.map((u) => (
            <button
              key={u.id}
              onClick={() => navigate(`/chat/${u.id}`)}
              className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left shadow-soft transition-colors hover:border-foreground/30"
            >
              <UserAvatar user={u} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <p className="truncate text-sm font-semibold">
                    <UserName user={u} />
                  </p>
                  {u.isBot && <BotBadge />}
                  <UserBadges user={u} />
                </div>
                <p className="truncate text-xs text-muted-foreground">{u.fullName}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default Chat;
