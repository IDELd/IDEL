const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, (req, res) => {
  const userId = req.userId;
  const events = [];

  const postIds = db.prepare("SELECT id, created_at FROM posts WHERE user_id = ?").all(userId);
  const postById = new Map(postIds.map((p) => [p.id, p]));

  if (postIds.length > 0) {
    const placeholders = postIds.map(() => "?").join(",");
    const likes = db
      .prepare(`SELECT * FROM likes WHERE post_id IN (${placeholders}) AND user_id != ?`)
      .all(...postIds.map((p) => p.id), userId);
    likes.forEach((like) => {
      const post = postById.get(like.post_id);
      events.push({
        id: `like_${like.post_id}_${like.user_id}`,
        type: "like",
        userId: like.user_id,
        targetUserId: userId,
        postId: like.post_id,
        createdAt: post?.created_at || new Date().toISOString(),
      });
    });

    const comments = db
      .prepare(`SELECT * FROM comments WHERE post_id IN (${placeholders}) AND user_id != ?`)
      .all(...postIds.map((p) => p.id), userId);
    comments.forEach((comment) => {
      events.push({
        id: `comment_${comment.id}`,
        type: "comment",
        userId: comment.user_id,
        targetUserId: userId,
        postId: comment.post_id,
        commentId: comment.id,
        text: comment.content || undefined,
        createdAt: comment.created_at,
      });
    });
  }

  const follows = db
    .prepare("SELECT * FROM follows WHERE following_id = ? AND follower_id != ?")
    .all(userId, userId);
  follows.forEach((follow) => {
    events.push({
      id: `follow_${follow.follower_id}_${follow.following_id}`,
      type: "follow",
      userId: follow.follower_id,
      targetUserId: userId,
      createdAt: follow.created_at,
    });
  });

  const friendRequests = db
    .prepare("SELECT * FROM friend_requests WHERE to_user_id = ? AND status = 'pending' AND from_user_id != ?")
    .all(userId, userId);
  friendRequests.forEach((r) => {
    events.push({
      id: `friend_${r.id}`,
      type: "friend_request",
      userId: r.from_user_id,
      targetUserId: userId,
      createdAt: r.created_at,
    });
  });

  events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ notifications: events.slice(0, 50) });
});

module.exports = router;
