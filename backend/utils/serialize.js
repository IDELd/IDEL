const db = require("../db");
const { readText } = require("../modules/messageStore");
const premium = require("../modules/premium");

/**
 * @param {object} row строка таблицы users
 * @param {{includePasswordHash?: boolean, includeModeration?: boolean,
 *   warningsCount?: number}} options
 *   includeModeration добавляет поля модерации (ранг, варны, ограничения,
 *   данные бана). Их видит только сам пользователь и администратор.
 *   warningsCount позволяет передать заранее посчитанное значение, чтобы
 *   списочные запросы не делали по одному COUNT на пользователя.
 */
function serializeUser(row, { includePasswordHash = false, includeModeration = false, warningsCount } = {}) {
  if (!row) return null;
  const badgeLevel = row.badge_level ?? 0;
  const premiumActive = premium.isPremium(row);
  const user = {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    coverUrl: row.cover_url,
    isAdmin: !!row.is_admin,
    // verified остаётся производным от уровня галочки, чтобы старый интерфейс
    // продолжал работать без изменений.
    verified: badgeLevel > 0 || !!row.verified,
    isBot: !!row.is_bot,
    aktiviki: row.aktiviki,
    badgeLevel,
    // ИДЕЛЬ ПРЕМИУМ: значок и переливающийся ник видят все, цвет текста тоже.
    premium: premiumActive,
    premiumUntil: row.premium_until || null,
    messageColor: premiumActive ? row.message_color || null : null,
    createdAt: row.created_at,
  };
  if (includePasswordHash) user.passwordHash = row.password_hash;

  if (includeModeration) {
    let total = warningsCount;
    if (total === undefined) {
      const counted = db
        .prepare("SELECT COUNT(*) AS c FROM warnings WHERE user_id = ?")
        .get(row.id);
      total = counted ? counted.c : 0;
    }
    user.reputation = row.reputation ?? 100;
    user.warningsCount = total;
    user.premiumTrialUsed = !!row.premium_trial_used;
    user.restrictions = parseJsonObject(row.restrictions);
    user.seriousBanned = !!row.serious_banned;
    user.banReason = row.ban_reason || null;
    user.banRuleNumber = row.ban_rule_number ?? null;
    // Почта видна только самому пользователю и администрации.
    user.email = row.email || null;
  }
  return user;
}

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function serializePost(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    content: row.content,
    imageUrl: row.image_url,
    drawingUrl: row.drawing_url,
    censored: !!row.censored,
    createdAt: row.created_at,
  };
}

function serializeVideo(row) {
  if (!row) return null;
  return {
    id: row.id,
    postId: row.id, // populated by caller when needed
    videoUrl: row.video_url,
    thumbnailUrl: row.video_thumbnail_url,
    duration: row.video_duration,
  };
}

function serializeComment(row) {
  if (!row) return null;
  return {
    id: row.id,
    postId: row.post_id,
    userId: row.user_id,
    content: row.content,
    voiceUrl: row.voice_url,
    duration: row.duration,
    // Расшифровка голосового (ИДЕЛЬ ПРЕМИУМ, распознаётся при записи).
    transcript: row.transcript || null,
    censored: !!row.censored,
    createdAt: row.created_at,
  };
}

function serializeChannel(row, viewer = null) {
  if (!row) return null;
  const isOwner = !!viewer && viewer.id === row.owner_id;
  const isMember = !!viewer && !!row.is_member;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ownerId: row.owner_id,
    badgeLevel: row.badge_level ?? 0,
    // public — виден всем, private — только владельцу и участникам.
    visibility: row.visibility || "public",
    // owner — только владелец, members — участники, anyone — любой пользователь.
    postPolicy: row.post_policy || "owner",
    isOwner,
    isMember,
    // Может ли текущий зритель публиковать (учитывает и бан).
    canPost: viewer
      ? (isOwner ||
         viewer.is_admin ||
         (row.post_policy === "anyone") ||
         (row.post_policy === "members" && isMember)) &&
        !row.viewer_banned
      : false,
    createdAt: row.created_at,
  };
}

function serializeChannelMember(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    username: row.username,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    badgeLevel: row.badge_level ?? 0,
    role: row.role || "member",
    createdAt: row.created_at,
  };
}

/** Группа: общий чат на много участников. viewer — текущий зритель или null. */
function serializeGroup(row, viewer = null) {
  if (!row) return null;
  const myRole = row.my_role || null;
  const isOwner = myRole === "owner" || (!!viewer && viewer.id === row.owner_id);
  const isMember = !!myRole || isOwner;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    avatarUrl: row.avatar_url || null,
    visibility: row.visibility || "public",
    ownerId: row.owner_id,
    pinnedMessageId: row.pinned_message_id || null,
    memberCount: row.member_count ?? 0,
    myRole: myRole || null,
    isOwner,
    isMember,
    isBanned: !!row.is_banned,
    createdAt: row.created_at,
  };
}

function serializeGroupMember(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    username: row.username,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    badgeLevel: row.badge_level ?? 0,
    role: row.role || "member",
    banned: !!row.banned,
    createdAt: row.created_at,
  };
}

/** Сообщение группы; автор уже подтянут JOIN-ом в строке. */
function serializeGroupMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    groupId: row.group_id,
    userId: row.user_id,
    text: readText(row.text),
    imageUrl: row.image_url || null,
    censored: !!row.censored,
    authorUsername: row.author_username || null,
    authorFullName: row.author_full_name || null,
    authorAvatarUrl: row.author_avatar_url || null,
    authorBadgeLevel: row.author_badge_level ?? 0,
    createdAt: row.created_at,
  };
}

function serializeChannelPost(row) {
  if (!row) return null;
  return {
    id: row.id,
    channelId: row.channel_id,
    userId: row.user_id,
    content: row.content,
    imageUrl: row.image_url,
    drawingUrl: row.drawing_url,
    censored: !!row.censored,
    createdAt: row.created_at,
  };
}

function serializeFriendRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

function serializeMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    chatId: row.chat_id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    // В БД текст хранится зашифрованным — расшифровываем при отдаче клиенту.
    text: readText(row.text),
    imageUrl: row.image_url || null,
    read: !!row.read,
    createdAt: row.created_at,
  };
}

function serializeVerificationRequest(row) {
  if (!row) return null;
  // Для бот-заявок в ai_details лежит {type:'bot', answers:[...]},
  // для обычных — массив [фактор, очки, максимум].
  let details = null;
  let answers = null;
  let kind = "user";
  try {
    const parsed = row.ai_details ? JSON.parse(row.ai_details) : null;
    if (Array.isArray(parsed)) {
      details = parsed;
    } else if (parsed && typeof parsed === "object") {
      if (parsed.type === "bot") kind = "bot";
      if (Array.isArray(parsed.answers)) answers = parsed.answers;
      if (Array.isArray(parsed.details)) details = parsed.details;
    }
  } catch {
    details = null;
  }
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    aiScore: row.ai_score ?? null,
    aiDetails: details,
    kind,
    answers,
    createdAt: row.created_at,
  };
}

function serializeReport(row) {
  if (!row) return null;
  return {
    id: row.id,
    reporterUserId: row.reporter_user_id,
    reportedUserId: row.reported_user_id,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
  };
}

function serializeBan(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    reason: row.reason,
    bannedBy: row.banned_by,
    mode: row.mode || "normal",
    ruleNumber: row.rule_number ?? null,
    expiresAt: row.expires_at || null,
    isAuto: !!row.is_auto,
    createdAt: row.created_at,
  };
}

function serializeWarning(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    reason: row.reason,
    category: row.category || "other",
    ruleNumber: row.rule_number ?? null,
    issuedBy: row.issued_by || null,
    createdAt: row.created_at,
  };
}

function serializeRule(row) {
  if (!row) return null;
  let config = null;
  try {
    config = row.detector_config ? JSON.parse(row.detector_config) : null;
  } catch {
    config = null;
  }
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    description: row.description,
    // Автоматор правила: null — только ручное рассмотрение.
    detector: row.detector || null,
    detectorConfig: config,
    enabled: row.enabled === undefined ? true : !!row.enabled,
    action: row.action || "warn",
    banDays: row.ban_days ?? null,
    // Удалять нарушающий пост/комментарий/сообщение при срабатывании.
    deleteContent: !!row.delete_content,
    updatedAt: row.updated_at,
  };
}

function serializeAppeal(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    banReason: row.ban_reason,
    appealText: row.appeal_text,
    status: row.status,
    decidedBy: row.decided_by || null,
    decisionComment: row.decision_comment || null,
    createdAt: row.created_at,
    decidedAt: row.decided_at || null,
  };
}

function serializeForbiddenWord(row) {
  if (!row) return null;
  return {
    id: row.id,
    word: row.word,
    category: row.category || "other",
    createdAt: row.created_at,
  };
}

function serializeEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    theme: row.theme,
    questions: JSON.parse(row.questions || "[]"),
    reward: row.reward,
    participationReward: row.participation_reward,
    startAt: row.start_at,
    endAt: row.end_at,
    active: !!row.active,
    finalized: !!row.finalized,
    winnerId: row.winner_id,
    createdAt: row.created_at,
  };
}

function serializeSubmission(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    userId: row.user_id,
    drawingUrl: row.drawing_url,
    answers: row.answers ? JSON.parse(row.answers) : null,
    score: row.score,
    createdAt: row.created_at,
  };
}

function serializeNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    actorUserId: row.actor_user_id,
    text: row.text,
    createdAt: row.created_at,
  };
}

module.exports = {
  serializeUser,
  serializePost,
  serializeVideo,
  serializeComment,
  serializeChannel,
  serializeChannelPost,
  serializeChannelMember,
  serializeGroup,
  serializeGroupMember,
  serializeGroupMessage,
  serializeFriendRequest,
  serializeMessage,
  serializeVerificationRequest,
  serializeReport,
  serializeBan,
  serializeWarning,
  serializeRule,
  serializeAppeal,
  serializeForbiddenWord,
  serializeEvent,
  serializeSubmission,
  serializeNotification,
};
