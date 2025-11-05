const express = require("express");
const router = express.Router();
const NotificationController = require("../controllers/notificationController");
const { authenticateToken } = require("../middleware/auth");

router.use(authenticateToken);

router.get("/", NotificationController.getNotifications);
router.get("/unread-count", NotificationController.getUnreadCount);
router.patch("/:notificationId/read", NotificationController.markAsRead);
router.patch("/read-all", NotificationController.markAllAsRead);
router.delete("/:notificationId", NotificationController.deleteNotification);

module.exports = router;
