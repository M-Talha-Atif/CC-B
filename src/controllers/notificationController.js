const { db } = require("../config/database");
const {
  notifications,
  users,
  comments,
  chatroomIdentities,
} = require("../models/schema");
const { eq, and, desc, sql } = require("drizzle-orm");

const NotificationController = {
  async getNotifications(req, res) {
    try {
      const userId = req.user.id;
      const { limit = 20, offset = 0 } = req.query;

      // Get notifications with actor info and their chatroom identity
      const userNotifications = await db
        .select({
          id: notifications.id,
          type: notifications.type,
          message: notifications.message,
          metadata: notifications.metadata,
          isRead: notifications.isRead,
          createdAt: notifications.createdAt,
          postId: notifications.postId,
          commentId: notifications.commentId,
          actorId: notifications.actorId,
          actorFirstName: users.firstName,
          actorLastName: users.lastName,
          actorProfilePicture: users.profilePicture,
          // Get the actor's chatroom username for this specific post
          chatroomUsername: chatroomIdentities.chatroomUsername,
          chatroomColor: chatroomIdentities.color,
          chatroomWord: chatroomIdentities.word,
        })
        .from(notifications)
        .leftJoin(users, eq(notifications.actorId, users.id))
        // Join with chatroomIdentities to get the ACTOR's chatroom identity for the post
        .leftJoin(
          chatroomIdentities,
          and(
            eq(chatroomIdentities.userId, notifications.actorId),
            eq(chatroomIdentities.postId, notifications.postId)
          )
        )
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt))
        .limit(parseInt(limit))
        .offset(parseInt(offset));

      // Get unread count
      const unreadResult = await db
        .select({ count: sql`count(*)` })
        .from(notifications)
        .where(
          and(eq(notifications.userId, userId), eq(notifications.isRead, false))
        );

      const unreadCount =
        unreadResult.length > 0 ? parseInt(unreadResult[0].count) : 0;

      res.json({
        notifications: userNotifications,
        unreadCount: unreadCount,
        hasMore: userNotifications.length === parseInt(limit),
      });
    } catch (error) {
      console.error("Error fetching notifications:", error);
      res.status(500).json({ error: "Failed to fetch notifications" });
    }
  },

  async markAsRead(req, res) {
    try {
      const userId = req.user.id;
      const { notificationId } = req.params;

      await db
        .update(notifications)
        .set({
          isRead: true,
          readAt: new Date(),
        })
        .where(
          and(
            eq(notifications.id, notificationId),
            eq(notifications.userId, userId)
          )
        );

      res.json({ message: "Notification marked as read" });
    } catch (error) {
      console.error("Error marking notification as read:", error);
      res.status(500).json({ error: "Failed to mark notification as read" });
    }
  },

  async markAllAsRead(req, res) {
    try {
      const userId = req.user.id;

      await db
        .update(notifications)
        .set({
          isRead: true,
          readAt: new Date(),
        })
        .where(
          and(eq(notifications.userId, userId), eq(notifications.isRead, false))
        );

      res.json({ message: "All notifications marked as read" });
    } catch (error) {
      console.error("Error marking all notifications as read:", error);
      res
        .status(500)
        .json({ error: "Failed to mark all notifications as read" });
    }
  },

  async getUnreadCount(req, res) {
    try {
      const userId = req.user.id;

      const result = await db
        .select({ count: sql`count(*)` })
        .from(notifications)
        .where(
          and(eq(notifications.userId, userId), eq(notifications.isRead, false))
        );

      const unreadCount = result.length > 0 ? parseInt(result[0].count) : 0;

      res.json({ unreadCount });
    } catch (error) {
      console.error("Error fetching unread count:", error);
      res.status(500).json({ error: "Failed to fetch unread count" });
    }
  },

  async deleteNotification(req, res) {
    try {
      const userId = req.user.id;
      const { notificationId } = req.params;

      await db
        .delete(notifications)
        .where(
          and(
            eq(notifications.id, notificationId),
            eq(notifications.userId, userId)
          )
        );

      res.json({ message: "Notification deleted" });
    } catch (error) {
      console.error("Error deleting notification:", error);
      res.status(500).json({ error: "Failed to delete notification" });
    }
  },
};

module.exports = NotificationController;
