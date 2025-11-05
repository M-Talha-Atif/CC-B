const express = require("express");
const router = express.Router();
const cronJobService = require("../services/cronJobServices");

router.get("/stats", async (req, res) => {
  try {
    const stats = await cronJobService.getStats();
    const jobStatus = cronJobService.getJobStatus();

    res.json({
      success: true,
      data: {
        stats,
        jobStatus,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error getting cron stats:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get cron job statistics",
    });
  }
});

// Manually trigger post management
router.post("/run/post-management", async (req, res) => {
  try {
    await cronJobService.managePostsAndComments();
    res.json({
      success: true,
      message: "Post management executed successfully",
    });
  } catch (error) {
    console.error("Error running post management:", error);
    res.status(500).json({
      success: false,
      error: "Failed to run post management",
    });
  }
});

// Manually trigger comment management
router.post("/run/comment-management", async (req, res) => {
  try {
    await cronJobService.manageCommentAccess();
    res.json({
      success: true,
      message: "Comment management executed successfully",
    });
  } catch (error) {
    console.error("Error running comment management:", error);
    res.status(500).json({
      success: false,
      error: "Failed to run comment management",
    });
  }
});

router.post("/run/cleanup-rejected-users", async (req, res) => {
  try {
    const deletedCount = await cronJobService.cleanupRejectedUsers();
    res.json({
      success: true,
      message: `Cleaned up ${deletedCount} rejected users`,
      deletedCount,
    });
  } catch (error) {
    console.error("Error running rejected users cleanup:", error);
    res.status(500).json({
      success: false,
      error: "Failed to run rejected users cleanup",
    });
  }
});

module.exports = router;
