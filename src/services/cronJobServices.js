const cron = require("node-cron");
const { db } = require("../config/database");
const { 
  posts, 
  comments, 
  users, 
  postRateLimits, // ADD THIS IMPORT
  referralUsage, 
  onboardingProgress 
} = require("../models/schema");
const { eq, and, lt, gte, sql, inArray, isNull } = require("drizzle-orm");

class CronJobService {
  constructor() {
    this.jobs = new Map();
  }

  // Initialize all cron jobs
  init() {
    console.log("🕐 Initializing cron jobs...");

    // Run every minute to check posts
    this.scheduleJob(
      "post-management",
      "* * * * *",
      this.managePostsAndComments.bind(this)
    );

    this.scheduleJob(
      "rate-limit-cleanup",
      "0 * * * *",
      this.cleanupExpiredRateLimits.bind(this)
    );

    this.scheduleJob(
      "cleanup-rejected-users",
      "*/15 * * * *",
      this.cleanupRejectedUsers.bind(this)
    );

    console.log("✅ Cron jobs initialized successfully");
  }

  // Schedule a new cron job
  scheduleJob(name, schedule, callback) {
    if (this.jobs.has(name)) {
      console.log(`⚠️ Job ${name} already exists, stopping previous job`); // FIXED: Template literal syntax
      this.jobs.get(name).stop();
    }

    const job = cron.schedule(schedule, callback, {
      scheduled: true,
      timezone: "UTC",
    });

    this.jobs.set(name, job);
    console.log(`📅 Scheduled job: ${name} with schedule: ${schedule}`); // FIXED: Template literal syntax
  }

  // Main function to manage posts and comments
  async managePostsAndComments() {
    try {
      await this.checkAndUpdateThresholds();
      await this.enableCommentsForQualifiedPosts();
      await this.hideUnqualifiedPosts();
      await this.disableExpiredChatrooms();
    } catch (error) {
      console.error("❌ Error in post and comment management:", error);
    }
  }

  // Check and update threshold status for posts - uses 1 like threshold
  async checkAndUpdateThresholds() {
    try {
      // Find posts that haven't met threshold yet
      const postsToCheck = await db
        .select({
          id: posts.id,
          categories: posts.categories,
          likes: posts.likes,
          subject: posts.subject,
          thresholdMet: posts.thresholdMet,
          commentsEnabled: posts.commentsEnabled,
          createdAt: posts.createdAt,
        })
        .from(posts)
        .where(and(eq(posts.isActive, true), eq(posts.thresholdMet, false)));

      let updatedCount = 0;
      const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

      for (const post of postsToCheck) {
        const likesCount = post.likes || 0;
        const requiredLikes = 1;
        const thresholdMet = likesCount >= requiredLikes;
        const postCreatedAt = new Date(post.createdAt);
        const isPostWithin48Hours = postCreatedAt >= fortyEightHoursAgo;

        if (thresholdMet) {
          const updateData = {
            thresholdMet: true,
            thresholdMetAt: new Date(),
            updatedAt: new Date(),
          };

          // ENABLE COMMENTS IMMEDIATELY when threshold is met (if post is within 48 hours)
          if (!post.commentsEnabled && isPostWithin48Hours) {
            updateData.commentsEnabled = true;
            updateData.commentsEnabledAt = new Date();
          }

          await db.update(posts).set(updateData).where(eq(posts.id, post.id));
          updatedCount++;
        }
      }

      return updatedCount;
    } catch (error) {
      console.error("❌ Error checking thresholds:", error);
      throw error;
    }
  }

  async cleanupExpiredRateLimits() {
    try {
      const now = new Date();

      // Delete all rate limit records where the hour has ended
      const deleted = await db
        .delete(postRateLimits)
        .where(lt(postRateLimits.hourEndTime, now))
        .returning();

      if (deleted.length > 0) {
        console.log(
          `🧹 Cleaned up ${deleted.length} expired rate limit records`
        );
      } else {
        console.log("🧹 No expired rate limit records to clean up");
      }

      return deleted.length;
    } catch (error) {
      console.error("❌ Error cleaning up rate limits:", error);
      return 0;
    }
  }

  async cleanupRejectedUsers() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setHours(cutoffDate.getHours() - 3); // 3 hours ago

      // FIXED: Properly format the date for SQL comparison
      const cutoffDateISO = cutoffDate.toISOString();

      // Find rejected users older than 3 hours
      const rejectedUsers = await db
        .select({
          id: users.id,
          email: users.email,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(
          and(
            eq(users.status, "referral_rejected"),
            sql`${users.updatedAt} < ${cutoffDateISO}::timestamp` // FIXED: Proper SQL date comparison
          )
        );

      console.log(`Found ${rejectedUsers.length} rejected users to clean up`); // FIXED: Template literal

      let deletedCount = 0;
      for (const user of rejectedUsers) {
        // Delete referral usage first
        await db
          .delete(referralUsage)
          .where(eq(referralUsage.usedByUserId, user.id));

        // Delete onboarding progress
        await db
          .delete(onboardingProgress)
          .where(eq(onboardingProgress.userId, user.id));

        // Delete the user (CASCADE will handle other relations)
        await db.delete(users).where(eq(users.id, user.id));

        console.log(`Deleted rejected user: ${user.email}`); // FIXED: Template literal
        deletedCount++;
      }

      console.log(`Cleanup completed: ${deletedCount} rejected users deleted`); // FIXED: Template literal
      return deletedCount;
    } catch (error) {
      console.error("Error cleaning up rejected users:", error);
      throw error;
    }
  }

  // Enable comments for posts that meet threshold but don't have comments enabled
  async enableCommentsForQualifiedPosts() {
    try {
      // Find posts that have met threshold but don't have comments enabled
      const postsNeedingComments = await db
        .select({
          id: posts.id,
          subject: posts.subject,
          likes: posts.likes,
          thresholdMet: posts.thresholdMet,
          commentsEnabled: posts.commentsEnabled,
        })
        .from(posts)
        .where(
          and(
            eq(posts.isActive, true),
            eq(posts.thresholdMet, true),
            eq(posts.commentsEnabled, false),
            gte(posts.likes, 1)
          )
        );

      let enabledCount = 0;
      for (const post of postsNeedingComments) {
        await db
          .update(posts)
          .set({
            commentsEnabled: true,
            commentsEnabledAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(posts.id, post.id));

        enabledCount++;
      }

      return enabledCount;
    } catch (error) {
      console.error("❌ Error enabling comments for qualified posts:", error);
      throw error;
    }
  }

  // Hide posts that haven't met like requirements within 1 hour
  async hideUnqualifiedPosts() {
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);

    try {
      // Find posts older than 1 hour that haven't been processed and haven't met threshold
      const unqualifiedPosts = await db
        .select({
          id: posts.id,
          categories: posts.categories,
          likes: posts.likes,
          createdAt: posts.createdAt,
          subject: posts.subject,
          thresholdMet: posts.thresholdMet,
          userId: posts.userId,
        })
        .from(posts)
        .where(
          and(
            eq(posts.isActive, true),
            eq(posts.eligibleForDeletion, true),
            eq(posts.cronProcessed, false),
            eq(posts.thresholdMet, false),
            lt(posts.createdAt, oneHourAgo)
          )
        );

      let hiddenCount = 0;
      for (const post of unqualifiedPosts) {
        const likesCount = post.likes || 0;

        // Mark post as processed and restrict visibility to author only
        await db
          .update(posts)
          .set({
            cronProcessed: true,
            visibleToAuthorOnly: true,
            updatedAt: new Date(),
          })
          .where(eq(posts.id, post.id));

        hiddenCount++;
      }

      return hiddenCount;
    } catch (error) {
      console.error("❌ Error hiding unqualified posts:", error);
      throw error;
    }
  }

  // FIXED: Disable comments for chatrooms where 1 hour has passed since first comment
  async disableExpiredChatrooms() {
    try {
      // Find posts that have comments enabled and have at least one comment
      const activeChatrooms = await db
        .select({
          id: posts.id,
          subject: posts.subject,
          commentsEnabled: posts.commentsEnabled,
          commentsCount: posts.commentsCount,
          commentsEnabledAt: posts.commentsEnabledAt,
        })
        .from(posts)
        .where(
          and(
            eq(posts.isActive, true),
            eq(posts.commentsEnabled, true),
            isNull(posts.commentsDisabledAt),
            sql`${posts.commentsCount} > 0` // FIXED: Use sql instead of sq
          )
        );

      let disabledCount = 0;
      const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);

      for (const post of activeChatrooms) {
        // Get the first comment timestamp for this post
        const [firstComment] = await db
          .select({
            createdAt: comments.createdAt,
          })
          .from(comments)
          .where(and(eq(comments.postId, post.id), eq(comments.isActive, true)))
          .orderBy(comments.createdAt)
          .limit(1);

        if (firstComment && firstComment.createdAt < oneHourAgo) {
          // Chatroom has expired (1 hour since first comment)
          await db
            .update(posts)
            .set({
              commentsEnabled: false,
              commentsDisabledAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(posts.id, post.id));

          console.log(
            `🔒 Disabled chatroom for post "${post.subject}" (1h after first comment)`
          );
          disabledCount++;
        }
      }

      return disabledCount;
    } catch (error) {
      console.error("❌ Error disabling expired chatrooms:", error);
      throw error;
    }
  }

  // Get cron job statistics
  async getStats() {
    try {
      const stats = await db
        .select({
          totalPosts: sql`COUNT(*)`, // FIXED: Use sql instead of sq
          activePosts: sql`COUNT(CASE WHEN ${posts.isActive} = true THEN 1 END)`,
          hiddenPosts: sql`COUNT(CASE WHEN ${posts.visibleToAuthorOnly} = true THEN 1 END)`,
          postsWithActiveComments: sql`COUNT(CASE WHEN ${posts.commentsEnabled} = true AND ${posts.commentsDisabledAt} IS NULL THEN 1 END)`,
          postsWithDisabledComments: sql`COUNT(CASE WHEN ${posts.commentsEnabled} = false AND ${posts.commentsDisabledAt} IS NOT NULL THEN 1 END)`,
          processedPosts: sql`COUNT(CASE WHEN ${posts.cronProcessed} = true THEN 1 END)`,
          thresholdMetPosts: sql`COUNT(CASE WHEN ${posts.thresholdMet} = true THEN 1 END)`,
          activeChatrooms: sql`COUNT(CASE WHEN ${posts.commentsEnabled} = true AND ${posts.commentsDisabledAt} IS NULL AND ${posts.commentsCount} > 0 THEN 1 END)`,
          expiredChatrooms: sql`COUNT(CASE WHEN ${posts.commentsEnabled} = false AND ${posts.commentsDisabledAt} IS NOT NULL THEN 1 END)`,
        })
        .from(posts);

      return stats[0];
    } catch (error) {
      console.error("❌ Error getting cron job stats:", error);
      throw error;
    }
  }

  // Stop all cron jobs
  stopAll() {
    console.log("🛑 Stopping all cron jobs...");
    this.jobs.forEach((job, name) => {
      job.stop();
      console.log(`⏹️  Stopped job: ${name}`); // FIXED: Template literal
    });
    this.jobs.clear();
  }

  // Get job status
  getJobStatus() {
    const status = {};
    this.jobs.forEach((job, name) => {
      status[name] = {
        running: job.running,
        scheduled: job.scheduled,
      };
    });
    return status;
  }
}

module.exports = new CronJobService();

// Helper function to calculate chatroom time remaining based on first comment (1 hour window)
async function calculateChatroomTimeRemainingAsync(postId) {
  try {
    // Get the first comment for this post
    const [firstComment] = await db
      .select({
        createdAt: comments.createdAt,
      })
      .from(comments)
      .where(and(eq(comments.postId, postId), eq(comments.isActive, true)))
      .orderBy(comments.createdAt)
      .limit(1);

    if (!firstComment) {
      return null; // No comments yet, timer hasn't started
    }

    const firstCommentTime = new Date(firstComment.createdAt);
    const expiresAt = new Date(
      firstCommentTime.getTime() + 1 * 60 * 60 * 1000 // 1 hour from first comment
    );
    const now = new Date();

    // Calculate remaining time in minutes
    const timeLeft = Math.max(0, Math.floor((expiresAt - now) / (1000 * 60)));

    return timeLeft;
  } catch (error) {
    console.error("Error calculating chatroom time remaining:", error);
    return 0;
  }
}

// Synchronous version for immediate calculation
function calculateChatroomTimeRemaining(post) {
  if (!post.firstCommentAt) {
    return null;
  }

  const firstCommentTime = new Date(post.firstCommentAt);
  const expiresAt = new Date(
    firstCommentTime.getTime() + 1 * 60 * 60 * 1000
  );
  const now = new Date();

  const timeLeft = Math.max(0, Math.floor((expiresAt - now) / (1000 * 60)));

  return timeLeft;
}

// Time remaining calculation for threshold - 1 hour
function calculateThresholdTimeRemaining(post) {
  const THRESHOLD_DURATION = 1 * 60 * 60 * 1000; // 1 hour

  if (post.thresholdMet) {
    return 0;
  }

  const createdAt = new Date(post.createdAt);
  const now = new Date();
  const elapsed = now - createdAt;
  const remaining = THRESHOLD_DURATION - elapsed;

  return Math.max(0, Math.floor(remaining / (1000 * 60)));
}

function getTimeAgo(date) {
  if (!date) return null;

  const diffMs = Date.now() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
}

// Export helper functions
module.exports.calculateChatroomTimeRemainingAsync =
  calculateChatroomTimeRemainingAsync;
module.exports.calculateThresholdTimeRemaining =
  calculateThresholdTimeRemaining;
module.exports.calculateChatroomTimeRemaining = calculateChatroomTimeRemaining;
module.exports.getTimeAgo = getTimeAgo;