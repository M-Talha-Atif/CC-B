const { db } = require("../config/database");
const { notifications, users } = require("../models/schema");
const { eq, and, desc } = require("drizzle-orm");
const { emitToUser } = require("./socketService");

const NotificationService = {
  async createNotification({
    userId,
    actorId,
    type,
    postId = null,
    commentId = null,
    parentCommentId = null,
    message,
    metadata = {},
  }) {
    try {
      // Don't notify yourself
      if (userId === actorId) return null;

      // Create notification in database
      const [notification] = await db
        .insert(notifications)
        .values({
          userId,
          actorId,
          type,
          postId,
          commentId,
          parentCommentId,
          message,
          metadata,
        })
        .returning();

      // Get actor details
      const [actor] = await db
        .select({
          firstName: users.firstName,
          lastName: users.lastName,
          profilePicture: users.profilePicture,
        })
        .from(users)
        .where(eq(users.id, actorId))
        .limit(1);

      // Prepare notification payload
      const notificationPayload = {
        ...notification,
        actor: {
          firstName: actor?.firstName,
          lastName: actor?.lastName,
          profilePicture: actor?.profilePicture,
        },
      };

      // Send real-time notification via WebSocket
      emitToUser(userId, "new_notification", notificationPayload);

      return notification;
    } catch (error) {
      console.error("Error creating notification:", error);
      return null;
    }
  },

  // Specific notification creators
  async notifyPostLike(
    postOwnerId,
    actorId,
    postId,
    postSubject,
    postCategories
  ) {
    return this.createNotification({
      userId: postOwnerId,
      actorId,
      type: "post_like",
      postId,
      message: "liked your post",
      metadata: {
        postSubject,
        postCategories, // Add this
      },
    });
  },

  async notifyPostComment(
    postOwnerId,
    actorId,
    postId,
    commentContent,
    postSubject,
    postCategories // Add this parameter
  ) {
    return this.createNotification({
      userId: postOwnerId,
      actorId,
      type: "post_comment",
      postId,
      message: "commented on your post",
      metadata: {
        postSubject,
        postCategories, // Add this
        commentPreview: commentContent.substring(0, 100),
      },
    });
  },
  
  async notifyCommentLike(commentOwnerId, actorId, commentId, postId) {
    return this.createNotification({
      userId: commentOwnerId,
      actorId,
      type: "comment_like",
      commentId,
      postId,
      message: "liked your comment",
    });
  },

  async notifyCommentReply(
    commentOwnerId,
    actorId,
    commentId,
    parentCommentId,
    postId,
    replyContent
  ) {
    return this.createNotification({
      userId: commentOwnerId,
      actorId,
      type: "comment_reply",
      commentId,
      parentCommentId,
      postId,
      message: "replied to your comment",
      metadata: {
        replyPreview: replyContent.substring(0, 100),
      },
    });
  },
};

module.exports = NotificationService;
