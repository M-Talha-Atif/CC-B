const { db } = require("../config/database");
const { notifications, users } = require("../models/schema");
const { eq, and, desc } = require("drizzle-orm");
const { emitToUser } = require("./socketService");
const { generateSlug, buildCategoriesPath } = require("../utils/slug");


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
  // async notifyPostLike(
  //   postOwnerId,
  //   actorId,
  //   postId,
  //   postSubject,
  //   postCategories
  // ) {
  //   return this.createNotification({
  //     userId: postOwnerId,
  //     actorId,
  //     type: "post_like",
  //     postId,
  //     message: "liked your post",
  //     metadata: {
  //       postSubject,
  //       postCategories, // Add this
  //     },
  //   });
  // },

  async notifyPostComment(
    postOwnerId,
    actorId,
    commentId,
    postId,
    commentContent,
    post
  ) {
    const slug = generateSlug(post.subject);
    const categoriesPath = buildCategoriesPath(post.categories);

    console.log(slug)

    return this.createNotification({
      userId: postOwnerId,
      actorId,
      type: "post_comment",
      commentId,
      postId,
      message: "commented on your post",
      metadata: {
        postSlug: slug,
        categoriesPath,
        commentPreview: commentContent.substring(0, 100),
        // target: commentsCount > 0 ? "chatroom" : "feed",
        target: "chatroom",

      },
    });
  },

  async notifyCommentLike(
    commentOwnerId,
    actorId,
    commentId,
    postId,
    post
  ) {
    const slug = generateSlug(post.subject);
    const categoriesPath = buildCategoriesPath(post.categories);

    return this.createNotification({
      userId: commentOwnerId,
      actorId,
      type: "comment_like",
      commentId,
      postId,
      message: "liked your comment",
      metadata: {
        postSlug: slug,
        categoriesPath,
        target: "chatroom", // comment likes always go to chatroom
      },
    });
  },

  async notifyCommentReply(
    commentOwnerId,
    actorId,
    commentId,
    parentCommentId,
    postId,
    replyContent,
    post
  ) {
    const slug = generateSlug(post.subject);
    const categoriesPath = buildCategoriesPath(post.categories);
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
        postSlug: slug,
        categoriesPath,
        target: "chatroom", // comment replies always go to chatroom
      },
    });
  },
};

module.exports = NotificationService;
