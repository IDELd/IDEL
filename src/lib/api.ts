import type {
  User,
  Post,
  CommentItem,
  Channel,
  ChannelPost,
  ChannelMember,
  Group,
  GroupMember,
  GroupMessage,
  GroupRole,
  FriendRequest,
  FriendStatus,
  Message,
  VerificationRequest,
  Report,
  Ban,
  Warning,
  UserSession,
  Rule,
  RuleDetector,
  Achievement,
  AchievementsPayload,
  ForbiddenWord,
  AppEvent,
  EventSubmission,
} from "./types";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:5001";
const TOKEN_KEY = "idel_token";
const CSRF_HEADER = "X-CSRF-Token";

/** Эндпоинты, доступные без CSRF-токена (вход/регистрация/подтверждение почты). */
const CSRF_EXEMPT_PREFIXES = ["/api/auth/login", "/api/auth/register", "/api/auth/confirm"];
const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"];
/** Коды, при которых сессия недействительна и нужно войти заново. */
const SESSION_ERROR_CODES = ["session_required", "session_revoked"];

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

let csrfToken: string | null = null;
let csrfTokenPromise: Promise<string | null> | null = null;

function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
  csrfToken = null;
  csrfTokenPromise = null;
}

async function loadCsrfToken(): Promise<string | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API_BASE}/api/csrf-token`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { token?: string } | null;
    csrfToken = typeof data?.token === "string" ? data.token : null;
    return csrfToken;
  } catch {
    return null;
  }
}

/** Возвращает CSRF-токен из кэша либо запрашивает новый (без дублирующих запросов). */
function ensureCsrfToken(): Promise<string | null> {
  if (csrfToken) return Promise.resolve(csrfToken);
  if (!csrfTokenPromise) {
    csrfTokenPromise = loadCsrfToken().finally(() => {
      csrfTokenPromise = null;
    });
  }
  return csrfTokenPromise;
}

function isMutating(method: string) {
  return MUTATING_METHODS.includes(method.toUpperCase());
}

function isCsrfExempt(path: string) {
  return CSRF_EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export class ApiError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const needsCsrf = isMutating(method) && !isCsrfExempt(path);
  let csrfRetried = false;

  for (;;) {
    const token = getToken();
    const isFormData = options.body instanceof FormData;
    const headers: Record<string, string> = {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers as Record<string, string> | undefined),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (needsCsrf) {
      const csrf = await ensureCsrfToken();
      if (csrf) headers[CSRF_HEADER] = csrf;
    }

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };

    if (!res.ok) {
      // Токен истёк или выпущен для другого пользователя — берём новый и
      // повторяем запрос ровно один раз.
      if (res.status === 403 && data?.code === "csrf_invalid" && needsCsrf && !csrfRetried) {
        csrfRetried = true;
        csrfToken = null;
        csrfTokenPromise = null;
        continue;
      }
      // Сессия завершена (в том числе с другого устройства) — просим войти заново.
      if (res.status === 401 && data?.code && SESSION_ERROR_CODES.includes(data.code)) {
        setToken(null);
        if (typeof window !== "undefined" && !window.location.hash.startsWith("#/login")) {
          window.location.hash = "#/login";
        }
      }
      throw new ApiError(data?.error || `Ошибка запроса (${res.status})`, data?.code);
    }
    return data as T;
  }
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });
const put = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "PUT", body: body !== undefined ? JSON.stringify(body) : undefined });
const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

async function uploadFile(path: string, file: File): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  return request<{ url: string }>(path, { method: "POST", body: formData });
}

// ---------- AUTH ----------
export interface RegisterInput {
  username: string;
  password: string;
  fullName: string;
  bio: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  email?: string;
}

export async function register(input: RegisterInput): Promise<User> {
  const { token, user } = await post<{ token: string; user: User }>("/api/auth/register", input);
  setToken(token);
  invalidateUsersCache();
  return user;
}

export async function login(username: string, password: string): Promise<User> {
  const { token, user } = await post<{ token: string; user: User }>("/api/auth/login", {
    username,
    password,
  });
  setToken(token);
  return user;
}

export function logout() {
  setToken(null);
}

/** Запрос ссылки сброса пароля на почту (ответ не раскрывает наличие аккаунта). */
export async function forgotPassword(value: string): Promise<void> {
  await post("/api/auth/forgot-password", value.includes("@") ? { email: value } : { username: value });
}

/** Новый пароль по токену из письма. */
export async function resetPassword(token: string, password: string): Promise<void> {
  await post("/api/auth/reset-password", { token, password });
}

export async function getMe(): Promise<User | null> {
  if (!getToken()) return null;
  try {
    const { user } = await get<{ user: User }>("/api/auth/me");
    return user;
  } catch {
    setToken(null);
    return null;
  }
}

export async function confirmEmail(token: string): Promise<void> {
  await get(`/api/auth/confirm?token=${encodeURIComponent(token)}`);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ revokedOtherSessions: number }> {
  return post<{ revokedOtherSessions: number }>("/api/auth/change-password", {
    currentPassword,
    newPassword,
  });
}

// ---------- СЕССИИ ----------
export async function getSessions(): Promise<UserSession[]> {
  const { sessions } = await get<{ sessions: UserSession[] }>("/api/sessions");
  return sessions;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await del(`/api/sessions/${sessionId}`);
}

export async function revokeOtherSessions(): Promise<number> {
  const { revoked } = await del<{ revoked: number }>("/api/sessions");
  return revoked;
}

// ---------- ПРАВИЛА ----------
export async function getRules(): Promise<Rule[]> {
  const { rules } = await get<{ rules: Rule[] }>("/api/rules");
  return rules;
}

export interface RuleInput {
  number: number;
  title: string;
  description: string;
  /** Автоматор: null — вручную. Не передавайте, если не меняете. */
  detector?: string | null;
  contexts?: string[];
  enabled?: boolean;
  action?: "warn" | "ban";
  banDays?: number | null;
  deleteContent?: boolean;
}

export async function getRuleDetectors(): Promise<{ detectors: RuleDetector[]; contexts: string[] }> {
  return get("/api/rules/detectors");
}

export async function createRule(input: RuleInput): Promise<Rule> {
  const { rule } = await post<{ rule: Rule }>("/api/rules", input);
  return rule;
}

export async function updateRule(id: string, input: RuleInput): Promise<Rule> {
  const { rule } = await put<{ rule: Rule }>(`/api/rules/${id}`, input);
  return rule;
}

export async function deleteRule(id: string): Promise<void> {
  await del(`/api/rules/${id}`);
}

// ---------- АПЕЛЛЯЦИИ ----------
export interface AppealUser {
  id: string;
  username: string;
  fullName: string;
  isBot: boolean;
}

export interface Appeal {
  id: string;
  userId: string;
  banReason: string | null;
  appealText: string;
  status: "pending" | "approved" | "rejected";
  decidedBy: string | null;
  decisionComment: string | null;
  createdAt: string;
  decidedAt: string | null;
  user?: AppealUser | null;
}

/** Подать апелляцию на текущую блокировку (для забаненного пользователя). */
export async function submitAppeal(appealText: string): Promise<Appeal> {
  const { appeal } = await post<{ appeal: Appeal }>("/api/appeal", { appealText });
  return appeal;
}

/** Список апелляций для админ-панели. */
export async function getAppeals(status: "pending" | "approved" | "rejected" | "all" = "pending"): Promise<Appeal[]> {
  const { appeals } = await get<{ appeals: Appeal[] }>(`/api/admin/appeals?status=${status}`);
  return appeals;
}

export async function decideAppeal(id: string, approve: boolean, comment?: string): Promise<void> {
  await post(`/api/admin/appeals/${id}/decide`, { approve, comment });
}

export interface AdminWarning extends Warning {
  username: string | null;
}

/** Последние варны по всем пользователям (админ). */
export async function getRecentWarnings(limit = 50): Promise<AdminWarning[]> {
  const { warnings } = await get<{ warnings: AdminWarning[] }>(`/api/admin/warnings?limit=${limit}`);
  return warnings;
}

/** Сколько апелляций ждёт решения (админ). */
export async function getPendingAppealsCount(): Promise<number> {
  const { pending } = await get<{ pending: number }>("/api/admin/appeals/count");
  return pending;
}

// ---------- ЗАПРЕЩЁННЫЕ СЛОВА ----------
export async function getForbiddenWords(): Promise<ForbiddenWord[]> {
  const { words } = await get<{ words: ForbiddenWord[] }>("/api/admin/forbidden-words");
  return words;
}

export async function addForbiddenWord(word: string, category = "other"): Promise<ForbiddenWord> {
  const result = await post<{ word: ForbiddenWord }>("/api/admin/forbidden-words", { word, category });
  return result.word;
}

export async function deleteForbiddenWord(id: string): Promise<void> {
  await del(`/api/admin/forbidden-words/${id}`);
}

// ---------- USERS ----------
let usersCache: User[] | null = null;
let usersCachePromise: Promise<User[]> | null = null;
let usersCacheAt = 0;
/** Кэш списка пользователей живёт недолго: иначе созданный бот не находится. */
const USERS_CACHE_TTL_MS = 30 * 1000;

export function invalidateUsersCache() {
  usersCache = null;
  usersCachePromise = null;
  usersCacheAt = 0;
}

/** Cached version of getUsers() for call sites that need many cheap lookups (e.g. post authors). */
export async function getUsersCached(): Promise<User[]> {
  if (usersCache && Date.now() - usersCacheAt < USERS_CACHE_TTL_MS) return usersCache;
  if (!usersCachePromise) {
    usersCachePromise = getUsers().then((u) => {
      usersCache = u;
      usersCacheAt = Date.now();
      usersCachePromise = null;
      return u;
    });
  }
  return usersCachePromise;
}

export async function getUserById(id: string): Promise<User | undefined> {
  const users = await getUsersCached();
  return users.find((u) => u.id === id);
}

export async function getUsers(): Promise<User[]> {
  const { users } = await get<{ users: User[] }>("/api/users");
  return users;
}

// ---------- ФИЛЬТР НИКОВ ----------
export interface NicknameCheckResult {
  allowed: boolean;
  username?: string;
  error?: string;
  code?: string;
  matched?: string;
}

/** Публичная проверка ника: формат + таблица запрещённых слов. */
export async function checkNickname(username: string): Promise<NicknameCheckResult> {
  return get<NicknameCheckResult>(`/api/nickname/check?username=${encodeURIComponent(username)}`);
}

export async function getUserByUsername(username: string): Promise<User | null> {
  try {
    const { user } = await get<{ user: User }>(`/api/users/${encodeURIComponent(username)}`);
    return user;
  } catch {
    return null;
  }
}

export async function updateProfile(input: {
  fullName?: string;
  bio?: string;
  avatarUrl?: string | null;
  coverUrl?: string | null;
}): Promise<User> {
  const { user } = await put<{ user: User }>("/api/users/profile", input);
  invalidateUsersCache();
  return user;
}

export async function changeUsername(username: string): Promise<User> {
  const { user } = await put<{ user: User }>("/api/users/username", { username });
  invalidateUsersCache();
  return user;
}

export async function setUserVerified(userId: string, verified: boolean): Promise<User> {
  const { user } = await put<{ user: User }>(`/api/users/${userId}/verified`, { verified });
  invalidateUsersCache();
  return user;
}

export async function deleteAccount(): Promise<void> {
  await del("/api/users/account");
  invalidateUsersCache();
  setToken(null);
}

export const uploadAvatar = (file: File) => uploadFile("/api/users/avatar", file);
export const uploadCover = (file: File) => uploadFile("/api/users/cover", file);

// ---------- POSTS ----------
export async function getPosts(): Promise<Post[]> {
  const { posts } = await get<{ posts: Post[] }>("/api/posts");
  return posts;
}

export async function getPostsByUser(userId: string): Promise<Post[]> {
  const { posts } = await get<{ posts: Post[] }>(`/api/posts/user/${userId}`);
  return posts;
}

export interface CreatePostInput {
  content: string;
  imageUrl?: string | null;
  drawingUrl?: string | null;
  videoUrl?: string | null;
  videoThumbnailUrl?: string | null;
  videoDuration?: number | null;
}

export async function createPost(input: CreatePostInput): Promise<Post> {
  const { post: created } = await post<{ post: Post }>("/api/posts", input);
  return created;
}

export async function deletePost(id: string): Promise<void> {
  await del(`/api/posts/${id}`);
}

export const uploadPostImage = (file: File) => uploadFile("/api/posts/upload/image", file);
export const uploadPostVideo = (file: File) => uploadFile("/api/posts/upload/video", file);

// ---------- COMMENTS ----------
export async function getComments(postId: string): Promise<CommentItem[]> {
  const { comments } = await get<{ comments: CommentItem[] }>(`/api/comments/post/${postId}`);
  return comments;
}

export async function createComment(input: {
  postId: string;
  content?: string | null;
  voiceUrl?: string | null;
  duration?: number | null;
  /** Расшифровка голосового — только для подписчиков ИДЕЛЬ ПРЕМИУМ. */
  transcript?: string | null;
}): Promise<CommentItem> {
  const { comment } = await post<{ comment: CommentItem }>("/api/comments", input);
  return comment;
}

export async function deleteComment(id: string): Promise<void> {
  await del(`/api/comments/${id}`);
}

export const uploadVoice = (file: File) => uploadFile("/api/comments/upload/voice", file);

// ---------- LIKES ----------
export async function toggleLike(postId: string): Promise<{ liked: boolean; count: number }> {
  return post("/api/likes/toggle", { postId });
}

export async function getLikeStatus(postId: string): Promise<{ liked: boolean; count: number }> {
  return get(`/api/likes/post/${postId}`);
}

// ---------- FOLLOWS ----------
export async function toggleFollow(userId: string): Promise<{ following: boolean }> {
  return post("/api/follows/toggle", { userId });
}

export async function getFollowStatus(userId: string): Promise<{ following: boolean }> {
  return get(`/api/follows/status/${userId}`);
}

export async function getFollowCounts(userId: string): Promise<{ followers: number; following: number }> {
  return get(`/api/follows/counts/${userId}`);
}

// ---------- FRIENDS ----------
export async function getFriends(): Promise<User[]> {
  const { users } = await get<{ users: User[] }>("/api/friends");
  return users;
}

export async function getPendingFriendRequests(): Promise<FriendRequest[]> {
  const { requests } = await get<{ requests: FriendRequest[] }>("/api/friends/requests");
  return requests;
}

export async function getFriendStatus(userId: string): Promise<FriendStatus> {
  const { status } = await get<{ status: FriendStatus }>(`/api/friends/status/${userId}`);
  return status;
}

export async function sendFriendRequest(toUserId: string): Promise<void> {
  await post("/api/friends/request", { toUserId });
}

export async function acceptFriendRequest(id: string): Promise<void> {
  await put(`/api/friends/request/${id}/accept`);
}

export async function rejectFriendRequest(id: string): Promise<void> {
  await put(`/api/friends/request/${id}/reject`);
}

// ---------- MESSAGES ----------
export async function getChats(): Promise<User[]> {
  const { users } = await get<{ users: User[] }>("/api/messages/chats");
  return users;
}

export async function getBotUser(username = "verifybot"): Promise<User> {
  const { user } = await get<{ user: User }>(
    `/api/messages/bot?username=${encodeURIComponent(username)}`,
  );
  return user;
}

export const getVerifyBotUser = () => getBotUser("verifybot");

export const getRestoreBotUser = () => getBotUser("restorebot");

export async function ensureBotWelcome(botId?: string): Promise<void> {
  await post("/api/messages/bot/welcome", botId ? { botId } : {});
}

export async function getMessages(otherUserId: string): Promise<Message[]> {
  const { messages } = await get<{ messages: Message[] }>(`/api/messages/${otherUserId}`);
  return messages;
}

export async function sendMessage(
  toUserId: string,
  text: string,
  imageUrl?: string | null,
): Promise<Message> {
  const { message } = await post<{ message: Message }>("/api/messages", { toUserId, text, imageUrl });
  return message;
}

// ---------- ДОСТИЖЕНИЯ ----------
export async function getMyAchievements(): Promise<AchievementsPayload> {
  return get<AchievementsPayload>("/api/achievements/me");
}

export async function getUserAchievements(username: string): Promise<AchievementsPayload> {
  return get<AchievementsPayload>(`/api/achievements/${encodeURIComponent(username)}`);
}

// ---------- CHANNELS ----------
export async function getChannels(): Promise<Channel[]> {
  const { channels } = await get<{ channels: Channel[] }>("/api/channels");
  return channels;
}

export async function createChannel(
  name: string,
  description: string,
  options?: { visibility?: Channel["visibility"]; postPolicy?: Channel["postPolicy"] },
): Promise<Channel> {
  const { channel } = await post<{ channel: Channel }>("/api/channels", { name, description, ...options });
  return channel;
}

export async function updateChannel(
  id: string,
  patch: {
    name?: string;
    description?: string;
    visibility?: Channel["visibility"];
    postPolicy?: Channel["postPolicy"];
  },
): Promise<Channel> {
  const { channel } = await put<{ channel: Channel }>(`/api/channels/${id}`, patch);
  return channel;
}

export async function getChannelMembers(id: string): Promise<ChannelMember[]> {
  const { members } = await get<{ members: ChannelMember[] }>(`/api/channels/${id}/members`);
  return members;
}

export async function addChannelMember(id: string, username: string): Promise<ChannelMember[]> {
  const { members } = await post<{ members: ChannelMember[] }>(`/api/channels/${id}/members`, { username });
  return members;
}

export async function removeChannelMember(id: string, userId: string): Promise<void> {
  await del(`/api/channels/${id}/members/${userId}`);
}

export async function getChannel(id: string): Promise<{ channel: Channel; posts: ChannelPost[] }> {
  return get(`/api/channels/${id}`);
}

export async function createChannelPost(
  channelId: string,
  input: { content: string; imageUrl?: string | null; drawingUrl?: string | null },
): Promise<ChannelPost> {
  const { post: created } = await post<{ post: ChannelPost }>(`/api/channels/${channelId}/posts`, input);
  return created;
}

export async function deleteChannelPost(id: string): Promise<void> {
  await del(`/api/channels/posts/${id}`);
}

// ---------- GROUPS (общий чат на много участников) ----------
export async function getGroups(): Promise<Group[]> {
  const { groups } = await get<{ groups: Group[] }>("/api/groups");
  return groups;
}

export async function createGroup(input: {
  name: string;
  description?: string;
  avatarUrl?: string | null;
  visibility?: Group["visibility"];
}): Promise<Group> {
  const { group } = await post<{ group: Group }>("/api/groups", input);
  return group;
}

export async function getGroup(id: string): Promise<Group> {
  const { group } = await get<{ group: Group }>(`/api/groups/${id}`);
  return group;
}

export async function updateGroup(
  id: string,
  patch: { name?: string; description?: string; avatarUrl?: string | null; visibility?: Group["visibility"] },
): Promise<Group> {
  const { group } = await put<{ group: Group }>(`/api/groups/${id}`, patch);
  return group;
}

export async function deleteGroup(id: string): Promise<void> {
  await del(`/api/groups/${id}`);
}

export async function joinGroup(id: string): Promise<Group> {
  const { group } = await post<{ group: Group }>(`/api/groups/${id}/join`);
  return group;
}

export async function leaveGroup(id: string): Promise<void> {
  await post(`/api/groups/${id}/leave`);
}

export async function getGroupMembers(id: string): Promise<GroupMember[]> {
  const { members } = await get<{ members: GroupMember[] }>(`/api/groups/${id}/members`);
  return members;
}

export async function addGroupMember(id: string, username: string): Promise<GroupMember[]> {
  const { members } = await post<{ members: GroupMember[] }>(`/api/groups/${id}/members`, { username });
  return members;
}

export async function removeGroupMember(id: string, userId: string): Promise<void> {
  await del(`/api/groups/${id}/members/${userId}`);
}

export async function setGroupMemberRole(
  id: string,
  userId: string,
  role: Exclude<GroupRole, "owner">,
): Promise<GroupMember[]> {
  const { members } = await post<{ members: GroupMember[] }>(`/api/groups/${id}/members/${userId}/role`, { role });
  return members;
}

export async function banGroupMember(id: string, userId: string): Promise<GroupMember[]> {
  const { members } = await post<{ members: GroupMember[] }>(`/api/groups/${id}/members/${userId}/ban`);
  return members;
}

export async function unbanGroupMember(id: string, userId: string): Promise<GroupMember[]> {
  const { members } = await post<{ members: GroupMember[] }>(`/api/groups/${id}/members/${userId}/unban`);
  return members;
}

export async function pinGroupMessage(id: string, messageId: string | null): Promise<Group> {
  const { group } = await put<{ group: Group }>(`/api/groups/${id}/pin`, { messageId });
  return group;
}

export async function getGroupMessages(id: string): Promise<GroupMessage[]> {
  const { messages } = await get<{ messages: GroupMessage[] }>(`/api/groups/${id}/messages`);
  return messages;
}

export async function sendGroupMessage(
  id: string,
  input: { text: string; imageUrl?: string | null },
): Promise<GroupMessage> {
  const { message } = await post<{ message: GroupMessage }>(`/api/groups/${id}/messages`, input);
  return message;
}

export async function deleteGroupMessage(id: string, messageId: string): Promise<void> {
  await del(`/api/groups/${id}/messages/${messageId}`);
}

// ---------- VERIFICATION ----------
export async function submitVerificationRequest(): Promise<void> {
  await post("/api/verify/request");
}

export async function getVerificationRequests(): Promise<VerificationRequest[]> {
  const { requests } = await get<{ requests: VerificationRequest[] }>("/api/verify");
  return requests;
}

export async function processVerificationRequest(id: string, approve: boolean, level?: number): Promise<void> {
  await put(`/api/verify/${id}`, { approve, level });
}

// ---------- REPORTS ----------
export async function submitReport(reportedUserId: string, reason: string): Promise<void> {
  await post("/api/reports", { reportedUserId, reason });
}

export async function getReports(): Promise<Report[]> {
  const { reports } = await get<{ reports: Report[] }>("/api/reports");
  return reports;
}

export async function resolveReport(id: string, action: "resolve" | "dismiss"): Promise<void> {
  await put(`/api/reports/${id}`, { action });
}

// ---------- BANS ----------
export async function getBans(): Promise<Ban[]> {
  const { bans } = await get<{ bans: Ban[] }>("/api/bans");
  return bans;
}

export interface BanStatus {
  banned: boolean;
  reason: string | null;
  ruleNumber?: number | null;
  mode?: 'normal' | 'serious' | null;
  expiresAt?: string | null;
  daysLeft?: number | null;
  isAuto?: boolean;
}

export async function getBanStatus(userId: string): Promise<BanStatus> {
  return get<BanStatus>(`/api/bans/status/${userId}`);
}

export interface BanOptions {
  ruleNumber?: number | null;
  /** normal — обычный бан, serious — полный сброс профиля. */
  mode?: 'normal' | 'serious';
  /** Срок в днях; не указан — бессрочно. */
  durationDays?: number | null;
}

export async function banUser(userId: string, reason: string, options: BanOptions = {}): Promise<void> {
  await post('/api/bans', { userId, reason, ...options });
}

export async function unbanUser(userId: string): Promise<void> {
  await del(`/api/bans/${userId}`);
}

/** Снять ограничение на бронзовую галочку, наложенное @restorebot (только админ). */
export async function clearUserRestrictions(userId: string): Promise<void> {
  await del(`/api/bans/${userId}/restrictions`);
}

// ---------- УДАЛЕНИЕ АККАУНТА (АДМИН) ----------
export interface DeletedAccount {
  id: string;
  userId: string;
  username: string;
  reason: string | null;
  deletedBy: string | null;
  snapshot: {
    posts?: number;
    comments?: number;
    messages?: number;
    channels?: number;
    warnings?: number;
    wasBanned?: boolean;
    badgeLevel?: number;
    reputation?: number;
  } | null;
  createdAt: string;
}

/** Полное удаление аккаунта администратором (каскадом уходит весь его контент). */
export async function deleteUserAccount(userId: string, reason: string): Promise<DeletedAccount["snapshot"]> {
  const result = await post<{ ok: boolean; deleted: { snapshot: DeletedAccount["snapshot"] } }>(
    `/api/admin/users/${userId}/delete`,
    { reason },
  );
  invalidateUsersCache();
  return result.deleted.snapshot;
}

/** Журнал удалённых аккаунтов (админ). */
export async function getDeletedAccounts(): Promise<DeletedAccount[]> {
  const { deleted } = await get<{ deleted: DeletedAccount[] }>("/api/admin/deleted-accounts");
  return deleted;
}

// ---------- ИДЕЛЬ ПРЕМИУМ ----------
export interface PremiumState {
  premium: boolean;
  permanent: boolean;
  until: string | null;
  trialUsed: boolean;
  messageColor: string | null;
}

export interface PremiumInfo {
  colors: string[];
  trialDays: number;
}

/** Публичная информация: палитра цветов и срок триала. */
export async function getPremiumInfo(): Promise<PremiumInfo> {
  return get<PremiumInfo>("/api/premium");
}

/** Своё состояние подписки. */
export async function getMyPremium(): Promise<PremiumState> {
  const { premium } = await get<{ premium: PremiumState }>("/api/premium/me");
  return premium;
}

/** Цвет текста своих сообщений, комментариев и постов (только для подписчиков). */
export async function setMessageColor(color: string | null): Promise<User> {
  const { user } = await put<{ user: User }>("/api/premium/color", { color });
  invalidateUsersCache();
  return user;
}

/** Выдать подписку вручную (админ). */
export async function grantPremium(
  userId: string,
  options: { days?: number; permanent?: boolean } = {},
): Promise<PremiumState> {
  const { premium } = await post<{ premium: PremiumState }>(`/api/admin/users/${userId}/premium`, options);
  invalidateUsersCache();
  return premium;
}

/** Снять подписку (админ). */
export async function revokePremium(userId: string): Promise<PremiumState> {
  const { premium } = await del<{ premium: PremiumState }>(`/api/admin/users/${userId}/premium`);
  invalidateUsersCache();
  return premium;
}

// ---------- ВАРНЫ ----------
export interface WarningsSummary {
  warnings: Warning[];
  count: number;
  reputation: number;
}

export async function getMyWarnings(): Promise<WarningsSummary> {
  return get<WarningsSummary>("/api/warnings/me");
}

export async function getUserWarnings(userId: string): Promise<WarningsSummary> {
  return get<WarningsSummary>(`/api/warnings/${userId}`);
}

export async function warnUser(
  userId: string,
  reason: string,
  options: { category?: Warning["category"]; ruleNumber?: number | null } = {},
): Promise<{ warningsCount: number; reputation: number; banned: boolean }> {
  return post("/api/warn", { userId, reason, ...options });
}

// ---------- BLOCKS ----------
export async function getBlockedUsers(): Promise<User[]> {
  const { users } = await get<{ users: User[] }>("/api/blocks");
  return users;
}

export async function blockUser(userId: string): Promise<void> {
  await post(`/api/blocks/${userId}`);
}

export async function unblockUser(userId: string): Promise<void> {
  await del(`/api/blocks/${userId}`);
}

export async function getBlockStatus(
  userId: string,
): Promise<{ iBlockedThem: boolean; theyBlockedMe: boolean }> {
  return get(`/api/blocks/status/${userId}`);
}

// ---------- EVENTS ----------
export async function getEvents(): Promise<AppEvent[]> {
  const { events } = await get<{ events: AppEvent[] }>("/api/events");
  return events;
}

export async function getEvent(id: string): Promise<AppEvent> {
  const { event } = await get<{ event: AppEvent }>(`/api/events/${id}`);
  return event;
}

export async function createEvent(input: Omit<AppEvent, "id" | "active" | "finalized" | "winnerId" | "createdAt"> & { active?: boolean }): Promise<AppEvent> {
  const { event } = await post<{ event: AppEvent }>("/api/events", input);
  return event;
}

export async function setEventActive(id: string, active: boolean): Promise<void> {
  await put(`/api/events/${id}/active`, { active });
}

export async function deleteEvent(id: string): Promise<void> {
  await del(`/api/events/${id}`);
}

export async function getEventSubmissions(id: string): Promise<EventSubmission[]> {
  const { submissions } = await get<{ submissions: EventSubmission[] }>(`/api/events/${id}/submissions`);
  return submissions;
}

export async function getMySubmission(id: string): Promise<EventSubmission | null> {
  const { submission } = await get<{ submission: EventSubmission | null }>(
    `/api/events/${id}/submissions/mine`,
  );
  return submission;
}

export async function submitPixelWar(id: string, drawingUrl: string): Promise<void> {
  await post(`/api/events/${id}/submit/pixelwar`, { drawingUrl });
}

export async function submitWordWar(id: string, answers: number[]): Promise<{ score: number }> {
  return post(`/api/events/${id}/submit/wordwar`, { answers });
}

export async function setEventWinner(id: string, winnerId: string): Promise<void> {
  await put(`/api/events/${id}/winner`, { winnerId });
}

export async function finalizeEvent(id: string): Promise<AppEvent> {
  const { event } = await post<{ event: AppEvent }>(`/api/events/${id}/finalize`);
  return event;
}

export async function getLeaderboard(): Promise<{ userId: string; username: string; points: number }[]> {
  const { leaderboard } = await get<{ leaderboard: { userId: string; username: string; points: number }[] }>(
    "/api/events/leaderboard/points",
  );
  return leaderboard;
}

// ---------- NOTIFICATIONS ----------
export interface NotificationEvent {
  id: string;
  type: "like" | "comment" | "follow" | "friend_request";
  userId: string;
  targetUserId: string;
  postId?: string;
  commentId?: string;
  text?: string;
  createdAt: string;
}

export async function getNotifications(): Promise<NotificationEvent[]> {
  const { notifications } = await get<{ notifications: NotificationEvent[] }>("/api/notifications");
  return notifications;
}

// ---------- ADMIN ----------
export interface AdminStats {
  users: number;
  posts: number;
  comments: number;
  channels: number;
  events: number;
  aktiviki: number;
}

export async function getAdminStats(): Promise<AdminStats> {
  const { stats } = await get<{ stats: AdminStats }>("/api/admin/stats");
  return stats;
}

export async function isCensorEnabled(): Promise<boolean> {
  const { enabled } = await get<{ enabled: boolean }>("/api/admin/censor");
  return enabled;
}

export async function setCensorEnabled(enabled: boolean): Promise<void> {
  await put("/api/admin/censor", { enabled });
}

// ---------- ГАЛОЧКИ (ВЕРИФИКАЦИЯ) ----------
export interface BadgeTargets {
  users: User[];
  channels: Channel[];
}

/** Пользователи (включая ботов) и каналы с уровнями галочек — только для админа. */
export async function getBadgeTargets(): Promise<BadgeTargets> {
  return get<BadgeTargets>("/api/admin/badges");
}

/** Выдать/сменить уровень галочки: 0 — нет, 1 — бронза, 2 — серебро, 3 — синий. */
export async function setBadgeLevel(
  targetType: "user" | "channel",
  targetId: string,
  level: number,
): Promise<{ badge: { targetId: string; previous: number; level: number; restricted?: boolean } }> {
  const result = await put<{ badge: { targetId: string; previous: number; level: number; restricted?: boolean } }>(
    "/api/admin/badge",
    { targetType, targetId, level },
  );
  invalidateUsersCache();
  return result;
}

/** Уровень галочки канала (через роут самого канала). */
export async function setChannelBadgeLevel(channelId: string, level: number): Promise<void> {
  await put(`/api/channels/${channelId}/badge`, { level });
}
