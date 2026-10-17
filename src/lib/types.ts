export type User = {
    id: string;
    username: string;
    fullName: string;
    bio: string;
    passwordHash: string;
    avatarUrl: string | null;
    coverUrl: string | null;
    isAdmin: boolean;
    verified: boolean;
    isBot?: boolean;
    aktiviki: number;
    createdAt: string;
    /** Уровень галочки: 0 — нет, 1 — бронза, 2 — серебро, 3 — синий. */
    badgeLevel: number;
    /** ИДЕЛЬ ПРЕМИУМ: значок перед ником и переливающийся ник. */
    premium?: boolean;
    premiumUntil?: string | null;
    /** Цвет текста сообщений/комментариев/постов (виден всем). */
    messageColor?: string | null;
    /** Поля модерации: приходят только самому пользователю и администратору. */
    reputation?: number;
    warningsCount?: number;
    restrictions?: UserRestrictions;
    seriousBanned?: boolean;
    banReason?: string | null;
    banRuleNumber?: number | null;
    /** Использован ли разовый 3-дневный триал Премиума. */
    premiumTrialUsed?: boolean;
  };

  /** Ограничения, которые накладывает система (например, @restorebot). */
  export type UserRestrictions = {
    bronze_badge_blocked?: boolean;
    [key: string]: unknown;
  };
  
  export type PublicUser = Omit<User, "passwordHash">;
  
  export type NewUserInput = {
    username: string;
    fullName: string;
    bio: string;
    avatarUrl: string | null;
    coverUrl: string | null;
    password: string;
  };
  
  export type Post = {
    id: string;
    userId: string;
    content: string;
    imageUrl: string | null;
    drawingUrl: string | null;
    censored: boolean;
    createdAt: string;
    video?: {
      id: string;
      postId: string;
      videoUrl: string;
      thumbnailUrl?: string | null;
      duration?: number | null;
    };
  };
  
  export type CommentItem = {
    id: string;
    postId: string;
    userId: string;
    content: string | null;
    voiceUrl: string | null;
    duration: number | null;
    /** Расшифровка голосового (ИДЕЛЬ ПРЕМИУМ). */
    transcript?: string | null;
    censored: boolean;
    createdAt: string;
  };
  
  export type Like = {
    postId: string;
    userId: string;
  };
  
  export type Follow = {
    followerId: string;
    followingId: string;
  };
  
  export type ChannelVisibility = 'public' | 'private';
  /** Кто может публиковать: только владелец, участники или любой пользователь. */
  export type ChannelPostPolicy = 'owner' | 'members' | 'anyone';

  export type Channel = {
    id: string;
    name: string;
    description: string;
    ownerId: string;
    /** Уровень галочки канала: 0 — нет, 1 — бронза, 2 — серебро, 3 — синий. */
    badgeLevel: number;
    /** public — виден всем, private — только владельцу и участникам. */
    visibility: ChannelVisibility;
    /** owner — только владелец, members — участники, anyone — любой. */
    postPolicy: ChannelPostPolicy;
    isOwner?: boolean;
    isMember?: boolean;
    /** Может ли текущий пользователь публиковать. */
    canPost?: boolean;
    createdAt: string;
  };

  export type ChannelMember = {
    userId: string;
    username: string;
    fullName: string;
    avatarUrl: string | null;
    badgeLevel: number;
    role: string;
    createdAt: string;
  };
  
  export type ChannelPost = {
    id: string;
    channelId: string;
    userId: string;
    content: string;
    imageUrl: string | null;
    drawingUrl: string | null;
    censored: boolean;
    createdAt: string;
  };

  export type GroupVisibility = 'public' | 'private';
  /** Роль в группе: владелец, модератор или участник. */
  export type GroupRole = 'owner' | 'moderator' | 'member';

  export type Group = {
    id: string;
    name: string;
    description: string;
    avatarUrl: string | null;
    visibility: GroupVisibility;
    ownerId: string;
    pinnedMessageId: string | null;
    memberCount: number;
    myRole: GroupRole | null;
    isOwner: boolean;
    isMember: boolean;
    isBanned: boolean;
    createdAt: string;
  };

  export type GroupMember = {
    userId: string;
    username: string;
    fullName: string;
    avatarUrl: string | null;
    badgeLevel: number;
    role: GroupRole;
    banned: boolean;
    createdAt: string;
  };

  export type GroupMessage = {
    id: string;
    groupId: string;
    userId: string;
    text: string;
    imageUrl: string | null;
    censored: boolean;
    authorUsername: string | null;
    authorFullName: string | null;
    authorAvatarUrl: string | null;
    authorBadgeLevel: number;
    createdAt: string;
  };
  
  export type EventType = "pixelwar" | "wordwar" | "popuwar";
  
  export type WordWarQuestion = {
    word: string;
    options: string[];
    correctIndex: number;
  };
  
  export type AppEvent = {
    id: string;
    type: EventType;
    title: string;
    description: string;
    theme: string | null;
    questions: WordWarQuestion[];
    reward: number;
    participationReward: number;
    startAt: string;
    endAt: string;
    active: boolean;
    finalized: boolean;
    winnerId: string | null;
    createdAt: string;
  };
  
  export type EventSubmission = {
    id: string;
    eventId: string;
    userId: string;
    drawingUrl: string | null;
    answers: number[] | null;
    score: number | null;
    createdAt: string;
  };
  
  export type AdminSettings = {
    censorEnabled: boolean;
  };
  
  export type Session = {
    userId: string;
  };
  // ===== НОВЫЕ ТИПЫ ДЛЯ ДРУЗЕЙ, ЧАТОВ, ВЕРИФИКАЦИИ, РЕПОРТОВ, БАНОВ =====

export type FriendStatus = 'none' | 'pending' | 'accepted' | 'rejected';

export interface FriendRequest {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface Message {
  id: string;
  chatId: string;
  fromUserId: string;
  toUserId: string;
  text: string;
  /** Картинка в сообщении (data-URL или ссылка). */
  imageUrl?: string | null;
  read: boolean;
  createdAt: string;
}

/** Вклад одного фактора в AI-оценку заявки на верификацию. */
export interface VerificationScoreDetail {
  key: string;
  label: string;
  points: number;
  max: number;
  note: string;
}

export interface VerificationRequest {
  id: string;
  userId: string;
  status: 'pending' | 'accepted' | 'approved' | 'rejected';
  /** Процент «доверия» (0–100), посчитанный по фактическим данным аккаунта. */
  aiScore?: number | null;
  aiDetails?: VerificationScoreDetail[];
  /** user — обычная заявка, bot — заявка на верификацию бота (опрос @verifybot). */
  kind?: 'user' | 'bot';
  /** Ответы на опрос @verifybot для бот-заявок. */
  answers?: string[] | null;
  score?: number;
  createdAt: string;
}

/** Запрещённое слово для фильтра ников (админ-управление). */
export interface ForbiddenWord {
  id: string;
  word: string;
  category: string;
  createdAt: string;
}

export interface Report {
  id: string;
  reporterUserId: string;
  reportedUserId: string;
  reason: string;
  status: 'pending' | 'resolved' | 'dismissed';
  createdAt: string;
}

export interface Ban {
  userId: string;
  reason: string;
  bannedBy: string;
  createdAt: string;
}

/** Варн (предупреждение) за нарушение правил. */
export interface Warning {
  id: string;
  userId: string;
  reason: string;
  category: 'nickname' | 'profanity' | 'spam' | 'toxicity' | 'other';
  ruleNumber: number | null;
  /** null — варн выдан автоматически системой. */
  issuedBy: string | null;
  createdAt: string;
}

export interface VideoPost {
  id: string;
  postId: string;
  videoUrl: string;
  thumbnailUrl?: string;
  duration?: number;
}

export interface UserBlock {
  id: string;
  blockerId: string;
  blockedId: string;
  createdAt: string;
}

/** Сессия пользователя: IP и устройство приходят расшифрованными. */
export interface UserSession {
  id: string;
  userId: string;
  ip: string;
  userAgent: string | null;
  device: string;
  current: boolean;
  createdAt: string;
  lastActive: string;
}

/** Пункт правил соцсети (страница #/rules). */
export interface Rule {
  id: string;
  number: number;
  title: string;
  description: string;
  /** Ключ автоматора (детектора) или null — только ручное рассмотрение. */
  detector: string | null;
  detectorConfig: { contexts?: string[]; [key: string]: unknown } | null;
  enabled: boolean;
  /** warn — варн, ban — сразу бан (со сроком banDays). */
  action: 'warn' | 'ban';
  banDays: number | null;
  /** Удалять нарушающий пост/комментарий/сообщение при срабатывании. */
  deleteContent: boolean;
  updatedAt: string;
}

/** Автоматор нарушения из библиотеки сервера. */
export interface RuleDetector {
  key: string;
  label: string;
  /** Категория варна: profanity, toxicity, spam, nickname, other. */
  category: string;
  contexts: string[];
}

/** Достижение профиля с прогрессом. */
export interface Achievement {
  code: string;
  title: string;
  description: string;
  category: 'activity' | 'popularity' | 'social' | 'status' | 'developers' | 'fun';
  target: number;
  points: number;
  progress: number;
  unlocked: boolean;
  unlockedAt: string | null;
}

export interface AchievementsPayload {
  achievements: Achievement[];
  unlocked: number;
  total: number;
  points: number;
}