const { db } = require("../config/database");
const {
  posts,
  postInteractions,
  pollVotes,
  users,
  comments,
  commentInteractions,
  chatroomIdentities,
  postRateLimits,
} = require("../models/schema");
const {
  eq,
  desc,
  and,
  sql,
  inArray,
  isNull,
  ne,
  or,
  gt,
  gte,
  lte,
} = require("drizzle-orm");
const chatroomUsernameService = require("../services/chatroomServices");
const {
  calculateChatroomTimeRemainingAsync,
} = require("../services/cronJobServices");
const NotificationService = require("../services/notificationService");
const helpers = require("../utils/helpers");

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

function calculateThresholdTimeRemaining(post) {
  // 48 hours in milliseconds
  const THRESHOLD_DURATION = 1 * 60 * 60 * 1000;

  // If post has already met threshold, return 0
  if (post.thresholdMet) {
    return 0;
  }

  const createdAt = new Date(post.createdAt);
  const now = new Date();
  const elapsed = now - createdAt;
  const remaining = THRESHOLD_DURATION - elapsed;

  // Return remaining time in milliseconds, minimum 0
  return Math.max(0, remaining);
}

function calculateChatroomTimeRemaining(post) {
  if (!post.commentsEnabled || !post.commentsEnabledAt) {
    return null;
  }

  const enabledAt = new Date(post.commentsEnabledAt);
  const expiresAt = new Date(enabledAt.getTime() + 1 * 60 * 60 * 1000); // 48 hours
  const now = new Date();
  const timeLeft = Math.max(0, Math.floor((expiresAt - now) / (1000 * 60))); // minutes

  return timeLeft;
}

const getThresholdRequirement = (categories) => {
  if (!categories || !Array.isArray(categories)) return 1;

  // Check if any category contains "couples" (case insensitive)
  const hasCouplsCategory = categories.some((cat) =>
    cat.toLowerCase().includes("couples")
  );

  return hasCouplsCategory ? 1 : 1;
};

const calculateRelevanceScore = (post, searchTerm) => {
  let score = 0;
  const lowerSearchTerm = searchTerm.toLowerCase();
  const lowerSubject = post.subject.toLowerCase();
  const lowerContent = post.content.toLowerCase();

  // Subject matches get higher score
  if (lowerSubject.includes(lowerSearchTerm)) {
    score += 10;
    // Exact match gets bonus
    if (lowerSubject === lowerSearchTerm) score += 5;
    // Title starts with search term gets bonus
    if (lowerSubject.startsWith(lowerSearchTerm)) score += 3;
  }

  // Content matches
  if (lowerContent.includes(lowerSearchTerm)) {
    score += 5;
  }

  // Popular posts get slight boost
  score += Math.min(post.likes * 0.1, 5);
  score += Math.min(post.saves * 0.2, 3);
  score += Math.min(post.commentsCount * 0.1, 2);

  return Math.round(score * 10) / 10;
};

const checkPostRateLimit = async (userId, db) => {
  const now = new Date();
  const { hourStart, hourEnd } = helpers.getHourBoundaries(now);
  const hourKey = helpers.getRateLimitKey(userId, now);

  const MAX_POSTS_PER_HOUR = 3;

  try {
    const existingLimit = await db
      .select()
      .from(postRateLimits)
      .where(
        and(
          eq(postRateLimits.userId, userId),
          eq(postRateLimits.hourKey, hourKey)
        )
      )
      .limit(1);

    if (existingLimit.length > 0) {
      const record = existingLimit[0];

      // Check if hour has expired
      if (record.hourEndTime <= now) {
        return {
          allowed: true,
          currentCount: 0,
          limit: MAX_POSTS_PER_HOUR,
          resetAt: hourEnd,
        };
      }

      // Check if at limit
      if (record.postCount >= MAX_POSTS_PER_HOUR) {
        return {
          allowed: false,
          currentCount: record.postCount,
          limit: MAX_POSTS_PER_HOUR,
          resetAt: record.hourEndTime,
        };
      }

      // Under limit
      return {
        allowed: true,
        currentCount: record.postCount,
        limit: MAX_POSTS_PER_HOUR,
        resetAt: record.hourEndTime,
      };
    }

    // First post of the hour
    return {
      allowed: true,
      currentCount: 0,
      limit: MAX_POSTS_PER_HOUR,
      resetAt: hourEnd,
    };
  } catch (error) {
    console.error("Rate limit check error:", error);
    // Fail open - allow post but log error
    return {
      allowed: true,
      currentCount: 0,
      limit: MAX_POSTS_PER_HOUR,
      resetAt: null,
      error: true,
    };
  }
};

const incrementPostRateLimit = async (userId, db) => {
  const now = new Date();
  const { hourStart, hourEnd } = helpers.getHourBoundaries(now);
  const hourKey = helpers.getRateLimitKey(userId, now);

  try {
    // Use upsert to handle both insert and update
    await db
      .insert(postRateLimits)
      .values({
        userId,
        hourKey,
        postCount: 1,
        hourStartTime: hourStart,
        hourEndTime: hourEnd,
      })
      .onConflictDoUpdate({
        target: [postRateLimits.userId, postRateLimits.hourKey],
        set: {
          postCount: sql`${postRateLimits.postCount} + 1`,
          updatedAt: new Date(),
        },
      });

    console.log(`Rate limit incremented for user ${userId}, hour ${hourKey}`);
  } catch (error) {
    console.error("Error incrementing rate limit:", error);
    // Don't throw - we don't want to fail the post creation
  }
};

const PostController = {
  async getFeed(req, res) {
    try {
      const {
        category = "New",
        page = 1,
        limit = 10,
        search = "",
        sortBy = "newest",
      } = req.query;

      const userAuthenticated = !!(req.user && req.user.id);
      const userId = userAuthenticated ? req.user.id : null;
      const offset = (page - 1) * limit;

      console.log(
        `Fetching feed - Category: ${category}, Page: ${page}, Limit: ${limit}, Search: "${search}", Sort: ${sortBy}, Auth: ${userAuthenticated}, UserId: ${userId}`
      );

      // Base condition - only active posts
      let whereCondition = eq(posts.isActive, true);
      let orderBy = desc(posts.createdAt); // Default ordering

      // UPDATED: Add visibility filter - exclude posts that are author-only unless we're in My Posts for the author
      if (category !== "My Posts") {
        whereCondition = and(
          whereCondition,
          eq(posts.visibleToAuthorOnly, false)
        );
      }

      // IMPROVED: Apply search filter with full-text search on both subject and content
      if (search && search.trim()) {
        const searchTerm = search.trim().toLowerCase();
        whereCondition = and(
          whereCondition,
          or(
            sql`LOWER(${posts.subject}) LIKE LOWER(${"%" + searchTerm + "%"})`,
            sql`LOWER(${posts.content}) LIKE LOWER(${"%" + searchTerm + "%"})`
          )
        );
      }

      const getSortOrder = (sortBy, category) => {
        switch (sortBy) {
          case "oldest":
            return asc(posts.createdAt);
          case "likes":
            return desc(posts.likes);
          case "saves":
            return desc(posts.saves);
          case "newest":
          default:
            if (category === "Popular" && sortBy !== "newest") {
              return desc(posts.likes);
            } else if (category === "Couples") {
              return desc(posts.likes);
            } else if (
              [
                "Creatives",
                "Photography",
                "Videography",
                "Florist",
                "Planner",
              ].includes(category)
            ) {
              // For creatives, sort by thresholdMetAt first, then by createdAt
              return desc(posts.thresholdMetAt);
            } else if (category === "Chatrooms") {
              return desc(posts.commentsEnabledAt);
            }
            return desc(posts.createdAt);
        }
      };

      orderBy = getSortOrder(sortBy, category);

      // OPTIMIZATION: Category filter optimization with indexed queries
      const applyCategoryFilter = async (
        category,
        whereCondition,
        userAuthenticated,
        userId
      ) => {
        switch (category) {
          case "New":
            // NEW: Only show posts that haven't met threshold yet OR are author-only for the author
            if (userAuthenticated && userId) {
              return and(
                whereCondition,
                eq(posts.isActive, true),
                or(
                  // Posts that haven't met threshold (public view)
                  and(
                    eq(posts.thresholdMet, false),
                    eq(posts.visibleToAuthorOnly, false)
                  ),
                  // Author's own posts that are author-only
                  and(
                    eq(posts.userId, userId),
                    eq(posts.visibleToAuthorOnly, true)
                  )
                )
              );
            } else {
              // For unauthenticated users, only show posts that haven't met threshold
              return and(
                whereCondition,
                eq(posts.isActive, true),
                eq(posts.thresholdMet, false),
                eq(posts.visibleToAuthorOnly, false)
              );
            }

          case "Popular":
            return and(
              whereCondition,
              eq(posts.thresholdMet, true),
              eq(posts.visibleToAuthorOnly, false), // Only show public posts that met threshold
              gte(posts.likes, 3) // Ensure post has 3 or more likes for Popular feed
            );

          case "Couples":
            return and(
              whereCondition,
              eq(posts.thresholdMet, true),
              eq(posts.visibleToAuthorOnly, false), // Only show public posts that met threshold
              sql`${posts.categories}::text LIKE '%Couples%'`
            );

          case "Creatives":
            return and(
              whereCondition,
              eq(posts.thresholdMet, true),
              eq(posts.visibleToAuthorOnly, false), // Only show public posts that met threshold
              sql`${posts.categories}::text NOT LIKE '%Couples%'`
            );

          case "Photography":
            return and(
              whereCondition,
              eq(posts.thresholdMet, true),
              eq(posts.visibleToAuthorOnly, false),
              sql`${posts.categories}::text LIKE '%Photographer%'` // Changed to match DB value
            );

          case "Videography":
            return and(
              whereCondition,
              eq(posts.thresholdMet, true),
              eq(posts.visibleToAuthorOnly, false),
              sql`${posts.categories}::text LIKE '%Videographer%'` // Changed to match DB value
            );

          case "Florist":
            return and(
              whereCondition,
              eq(posts.thresholdMet, true),
              eq(posts.visibleToAuthorOnly, false), // Only show public posts that met threshold
              sql`${posts.categories}::text LIKE '%Florist%'`
            );

          case "Planner":
            return and(
              whereCondition,
              eq(posts.thresholdMet, true),
              eq(posts.visibleToAuthorOnly, false), // Only show public posts that met threshold
              sql`${posts.categories}::text LIKE '%Planner%'`
            );

          case "My Posts":
            if (!userAuthenticated || !userId) {
              throw new Error("Authentication required for My Posts");
            }

            // UPDATED: Show ONLY user's own posts that have met threshold (public posts only)
            return and(
              whereCondition,
              eq(posts.userId, userId), // Only posts by this user
              eq(posts.thresholdMet, true), // Only posts that met threshold
              eq(posts.visibleToAuthorOnly, false) // Only public posts
            );

          case "Saved":
            if (!userAuthenticated || !userId) {
              throw new Error("Authentication required for Saved posts");
            }
            // This will be handled separately due to the join requirement
            return whereCondition;

          case "Chatrooms":
            return and(
              whereCondition,
              eq(posts.commentsEnabled, true), // Comments must be currently enabled
              isNull(posts.commentsDisabledAt), // Comments must NOT have been disabled (this ensures it's still active)
              eq(posts.thresholdMet, true), // Must have met threshold
              eq(posts.visibleToAuthorOnly, false), // Must be public
              gte(posts.commentsCount, 1), // Must have 1 or more comments
              // FIXED: Check if first comment was within the last hour (not just any activity)
              sql`EXISTS (
    SELECT 1 FROM ${comments} c 
    WHERE c.post_id = ${posts.id} 
    AND c.is_active = true 
    AND c.created_at = (
      SELECT MIN(c2.created_at) 
      FROM ${comments} c2 
      WHERE c2.post_id = ${posts.id} 
      AND c2.is_active = true
    )
    AND c.created_at > NOW() - INTERVAL '1 hour'
  )`
            );
          default:
            return and(
              whereCondition,
              eq(posts.thresholdMet, true),
              eq(posts.visibleToAuthorOnly, false), // Only show public posts that met threshold
              sql`${posts.categories}::text LIKE ${"%" + category + "%"}`
            );
        }
      };

      if (category === "Bookmark") {
        if (!userAuthenticated || !userId) {
          return res.status(401).json({ error: "Authentication required" });
        }

        // First get all saved posts with their saved timestamps, ordered by most recent save first
        const savedInteractions = await db
          .select({
            postId: postInteractions.postId,
            savedAt: postInteractions.createdAt, // This is when the user saved the post
          })
          .from(postInteractions)
          .where(
            and(
              eq(postInteractions.userId, userId),
              eq(postInteractions.type, "save")
            )
          )
          .orderBy(desc(postInteractions.createdAt)); // Most recent saves first

        if (savedInteractions.length === 0) {
          return res.json({
            posts: [],
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              hasMore: false,
              total: 0,
            },
          });
        }

        // Create a map of postId to savedAt timestamp for later use
        const savedPostMap = new Map();
        savedInteractions.forEach((interaction) => {
          savedPostMap.set(interaction.postId, interaction.savedAt);
        });

        // Get all saved post IDs in the order they were saved (most recent first)
        const savedPostIds = savedInteractions.map(
          (interaction) => interaction.postId
        );

        // Apply search filter if present
        let filteredPostIds = savedPostIds;
        if (search && search.trim()) {
          const searchTerm = search.trim().toLowerCase();

          // Get posts that match the search criteria
          const searchMatchingPosts = await db
            .select({ id: posts.id })
            .from(posts)
            .where(
              and(
                inArray(posts.id, savedPostIds),
                eq(posts.isActive, true),
                or(
                  sql`LOWER(${posts.subject}) LIKE LOWER(${
                    "%" + searchTerm + "%"
                  })`,
                  sql`LOWER(${posts.content}) LIKE LOWER(${
                    "%" + searchTerm + "%"
                  })`
                )
              )
            );

          const searchMatchingIds = searchMatchingPosts.map((post) => post.id);

          // Filter savedPostIds to only include those that match search, maintaining save order
          filteredPostIds = savedPostIds.filter((id) =>
            searchMatchingIds.includes(id)
          );
        }

        // Get total count of filtered saved posts
        const totalCount = filteredPostIds.length;

        // Get paginated post IDs (already in correct order - most recently saved first)
        const paginatedPostIds = filteredPostIds.slice(
          offset,
          offset + parseInt(limit)
        );

        if (paginatedPostIds.length === 0) {
          return res.json({
            posts: [],
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              hasMore: false,
              total: totalCount,
            },
          });
        }

        // Get the posts data for these IDs
        const savedPosts = await db
          .select({
            id: posts.id,
            subject: posts.subject,
            content: posts.content,
            categories: posts.categories,
            type: posts.type,
            pollOptions: posts.pollOptions,
            likes: posts.likes,
            saves: posts.saves,
            commentsCount: posts.commentsCount,
            createdAt: posts.createdAt,
            thresholdMet: posts.thresholdMet,
            thresholdMetAt: posts.thresholdMetAt,
            visibleToAuthorOnly: posts.visibleToAuthorOnly,
            userId: posts.userId,
            userFirstName: users.firstName,
            userLastName: users.lastName,
            userBusinessName: users.businessName,
            userProfilePicture: users.profilePicture,
            isQuotePost: posts.isQuotePost,
            quotesCount: posts.quotesCount,
            quotedPostId: posts.quotedPostId,
            quotedPostSnapshot: posts.quotedPostSnapshot,
            commentsEnabled: posts.commentsEnabled,
            commentsEnabledAt: posts.commentsEnabledAt,
            commentsDisabledAt: posts.commentsDisabledAt,
          })
          .from(posts)
          .leftJoin(users, eq(posts.userId, users.id))
          .where(
            and(inArray(posts.id, paginatedPostIds), eq(posts.isActive, true))
          );

        // Sort the posts in the same order as the paginatedPostIds array (most recently saved first)
        const sortedPosts = paginatedPostIds
          .map((postId) => savedPosts.find((post) => post.id === postId))
          .filter((post) => post); // Remove any undefined posts

        // Get user interactions and poll votes
        const postIds = sortedPosts.map((post) => post.id);
        let interactionMap = {};
        let pollVoteMap = {};

        if (userAuthenticated && userId) {
          const [userInteractions, userPollVotes] = await Promise.all([
            db
              .select()
              .from(postInteractions)
              .where(
                and(
                  eq(postInteractions.userId, userId),
                  inArray(postInteractions.postId, postIds)
                )
              ),
            db
              .select()
              .from(pollVotes)
              .where(
                and(
                  eq(pollVotes.userId, userId),
                  inArray(pollVotes.postId, postIds)
                )
              ),
          ]);

          userInteractions.forEach((interaction) => {
            if (!interactionMap[interaction.postId]) {
              interactionMap[interaction.postId] = {};
            }
            interactionMap[interaction.postId][interaction.type] = true;
          });

          userPollVotes.forEach((vote) => {
            pollVoteMap[vote.postId] = vote.optionIndex;
          });
        }

        // Format the posts with savedAt timestamp
        const formattedPosts = sortedPosts.map((post, index) => {
          const hasVoted =
            post.type === "poll" && pollVoteMap[post.id] !== undefined;
          const chatroomTimeRemaining = calculateChatroomTimeRemaining(post);
          const thresholdTimeRemaining = calculateThresholdTimeRemaining(post);

          let formattedPollOptions = null;
          if (post.type === "poll" && post.pollOptions) {
            const totalVotes = post.pollOptions.reduce(
              (sum, option) => sum + (option.votes || 0),
              0
            );

            formattedPollOptions = post.pollOptions.map((option, index) => ({
              text: option.text,
              percentage:
                totalVotes > 0
                  ? Math.round((option.votes / totalVotes) * 100 * 10) / 10
                  : 0,
              votes: option.votes || 0,
              isUserChoice: hasVoted && pollVoteMap[post.id] === index,
            }));
          }

          // Calculate ranking for Couples category
          let couplesRanking = null;
          if (category === "Couples") {
            couplesRanking = offset + index + 1; // 1-based ranking
          }

          let quotedPost = null;
          if (post.isQuotePost && post.quotedPostSnapshot) {
            try {
              // FIX: Handle both string and object cases
              let quotedPostData;
              if (typeof post.quotedPostSnapshot === "string") {
                quotedPostData = JSON.parse(post.quotedPostSnapshot);
              } else if (typeof post.quotedPostSnapshot === "object") {
                quotedPostData = post.quotedPostSnapshot;
              } else {
                throw new Error("Invalid quotedPostSnapshot format");
              }

              quotedPost = quotedPostData;

              // Format quoted post poll options if needed
              if (quotedPost.type === "poll" && quotedPost.pollOptions) {
                const totalVotes = quotedPost.pollOptions.reduce(
                  (sum, option) => sum + (option.votes || 0),
                  0
                );
                quotedPost.pollOptions = quotedPost.pollOptions.map(
                  (option) => ({
                    text: option.text,
                    percentage:
                      totalVotes > 0
                        ? Math.round((option.votes / totalVotes) * 100 * 10) /
                          10
                        : 0,
                    votes: option.votes || 0,
                    isUserChoice: false,
                  })
                );
                quotedPost.totalVotes = totalVotes;
              }
            } catch (error) {
              console.error("Error parsing quoted post snapshot:", error);
              quotedPost = null;
            }
          }

          return {
            ...post,
            pollOptions: formattedPollOptions,
            totalVotes:
              formattedPollOptions?.reduce(
                (sum, option) => sum + option.votes,
                0
              ) || 0,
            timeAgo: getTimeAgo(post.createdAt),
            userDisplayName:
              post.userBusinessName ||
              `${post.userFirstName} ${post.userLastName}`.trim(),
            isLiked: interactionMap[post.id]?.like || false,
            isSaved: true, // Since these are all saved posts
            hasVoted: hasVoted,
            userVotedOption: pollVoteMap[post.id] || null,
            commentsCount: post.commentsCount || 0,
            quotesCount: post.quotesCount || 0,
            isQuotePost: post.isQuotePost || false,
            quotedPostId: post.quotedPostId,
            quotedPost: quotedPost,
            recentComment: null,
            chatroomData: post.commentsEnabled
              ? {
                  timeRemaining: chatroomTimeRemaining,
                  isActive: chatroomTimeRemaining > 0,
                  activeMembers: 0,
                  totalMessages: 0,
                }
              : null,
            thresholdData: {
              timeRemaining: thresholdTimeRemaining,
              isActive: thresholdTimeRemaining > 0 && !post.thresholdMet,
              thresholdMet: post.thresholdMet,
              requiredLikes: getThresholdRequirement(post.categories),
              currentLikes: post.likes,
              thresholdMetAt: post.thresholdMetAt,
            },
            visibilityStatus: {
              isAuthorOnly: post.visibleToAuthorOnly,
              isPublic: !post.visibleToAuthorOnly && post.thresholdMet,
              isOwner: userAuthenticated && userId === post.userId,
            },
            savedAt: savedPostMap.get(post.id), // Include the savedAt timestamp
            // Add couples ranking
            couplesRanking: couplesRanking,
          };
        });

        const hasMore = offset + formattedPosts.length < totalCount;

        return res.json({
          posts: formattedPosts,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            hasMore: hasMore,
            total: totalCount,
          },
        });
      } else {
        whereCondition = await applyCategoryFilter(
          category,
          whereCondition,
          userAuthenticated,
          userId
        );
      }

      // OPTIMIZATION: Single query for total count with better indexing
      const totalCountQuery = await db
        .select({ count: sql`COUNT(*)`.as("count") })
        .from(posts)
        .leftJoin(users, eq(posts.userId, users.id))
        .where(whereCondition);

      const totalCount = parseInt(totalCountQuery[0]?.count || 0);

      // Special handling for Couples category - limit to top 10 and ensure proper ordering
      let queryLimit = parseInt(limit);
      let queryOffset = offset;
      let maxResults = totalCount;

      if (category === "Couples") {
        const maxCouplesPost = 10;
        maxResults = Math.min(totalCount, maxCouplesPost);

        if (offset >= maxCouplesPost) {
          return res.json({
            posts: [],
            pagination: {
              page: parseInt(page),
              limit: parseInt(limit),
              hasMore: false,
              total: maxResults,
            },
          });
        }
        queryLimit = Math.min(queryLimit, maxCouplesPost - offset);

        // Force ordering by likes for Couples category
        orderBy = desc(posts.likes);
      }

      // OPTIMIZATION: Main query with optimized joins and selections
      const feedPosts = await db
        .select({
          id: posts.id,
          subject: posts.subject,
          content: posts.content,
          categories: posts.categories,
          type: posts.type,
          pollOptions: posts.pollOptions,
          likes: posts.likes,
          saves: posts.saves,
          commentsCount: posts.commentsCount,
          createdAt: posts.createdAt,
          thresholdMet: posts.thresholdMet,
          thresholdMetAt: posts.thresholdMetAt,
          visibleToAuthorOnly: posts.visibleToAuthorOnly, // NEW: Include visibility status
          userId: posts.userId,
          userFirstName: users.firstName,
          userLastName: users.lastName,
          userBusinessName: users.businessName,
          userProfilePicture: users.profilePicture,
          isQuotePost: posts.isQuotePost,
          quotedPostId: posts.quotedPostId,
          quotedPostSnapshot: posts.quotedPostSnapshot,
          quotesCount: posts.quotesCount,
          commentsEnabled: posts.commentsEnabled,
          commentsEnabledAt: posts.commentsEnabledAt,
          commentsDisabledAt: posts.commentsDisabledAt,
        })
        .from(posts)
        .leftJoin(users, eq(posts.userId, users.id))
        .where(whereCondition)
        .orderBy(orderBy)
        .limit(queryLimit)
        .offset(queryOffset);

      if (feedPosts.length === 0) {
        return res.json({
          posts: [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            hasMore: false,
            total: maxResults,
          },
        });
      }

      // OPTIMIZATION: Batch process user interactions only for authenticated users
      const postIds = feedPosts.map((post) => post.id);
      let interactionMap = {};
      let pollVoteMap = {};
      let recentCommentsMap = {};
      let chatroomStats = {};

      // Only fetch user-specific data for authenticated users
      if (userAuthenticated && userId) {
        // Get user interactions in parallel
        const [userInteractions, userPollVotes] = await Promise.all([
          db
            .select()
            .from(postInteractions)
            .where(
              and(
                eq(postInteractions.userId, userId),
                inArray(postInteractions.postId, postIds)
              )
            ),
          db
            .select()
            .from(pollVotes)
            .where(
              and(
                eq(pollVotes.userId, userId),
                inArray(pollVotes.postId, postIds)
              )
            ),
        ]);

        // Map interactions
        userInteractions.forEach((interaction) => {
          if (!interactionMap[interaction.postId]) {
            interactionMap[interaction.postId] = {};
          }
          interactionMap[interaction.postId][interaction.type] = true;
        });

        userPollVotes.forEach((vote) => {
          pollVoteMap[vote.postId] = vote.optionIndex;
        });
      }

      // UPDATED: Only fetch recent comments for "My Posts" category
      let recentComments = [];
      if (category === "My Posts" && userAuthenticated && userId) {
        recentComments = await db
          .select({
            id: comments.id,
            postId: comments.postId,
            content: comments.content,
            createdAt: comments.createdAt,
            userId: comments.userId,
            userFirstName: users.firstName,
            userLastName: users.lastName,
            userBusinessName: users.businessName,
            chatroomUsername: chatroomIdentities.chatroomUsername,
            parentCommentId: comments.parentCommentId, // Include parent comment ID
            isActive: comments.isActive,
          })
          .from(comments)
          .leftJoin(users, eq(comments.userId, users.id))
          .leftJoin(
            chatroomIdentities,
            and(
              eq(chatroomIdentities.userId, comments.userId),
              eq(chatroomIdentities.postId, comments.postId)
            )
          )
          .where(
            and(
              inArray(comments.postId, postIds),
              eq(comments.userId, userId),
              eq(comments.isActive, true)
            )
          )
          .orderBy(desc(comments.createdAt));
      }

      // OPTIMIZATION: Batch fetch chatroom stats (only if not My Posts)
      let activeMembersData = [];
      let totalMessagesData = [];

      if (category !== "My Posts") {
        [activeMembersData, totalMessagesData] = await Promise.all([
          // Active members (last 24 hours)
          db
            .select({
              postId: comments.postId,
              userId: comments.userId,
            })
            .from(comments)
            .where(
              and(
                inArray(comments.postId, postIds),
                eq(comments.isActive, true),
                sql`${comments.createdAt} > NOW() - INTERVAL '24 hours'`
              )
            )
            .groupBy(comments.postId, comments.userId),

          // Total messages
          db
            .select({
              postId: comments.postId,
              count: sql`COUNT(*)`.as("count"),
            })
            .from(comments)
            .where(
              and(
                inArray(comments.postId, postIds),
                eq(comments.isActive, true)
              )
            )
            .groupBy(comments.postId),
        ]);
      }

      // Process recent comments (only for My Posts)
      if (category === "My Posts") {
        recentComments.forEach((comment) => {
          if (!recentCommentsMap[comment.postId]) {
            const userDisplayName =
              comment.chatroomUsername ||
              comment.userBusinessName ||
              `${comment.userFirstName} ${comment.userLastName}`.trim();

            recentCommentsMap[comment.postId] = {
              ...comment,
              timeAgo: getTimeAgo(comment.createdAt),
              userDisplayName: userDisplayName,
            };
          }
        });
      }

      // Process chatroom stats (only if not My Posts)
      if (category !== "My Posts") {
        const activeMembersCount = {};
        activeMembersData.forEach((member) => {
          if (!activeMembersCount[member.postId]) {
            activeMembersCount[member.postId] = new Set();
          }
          activeMembersCount[member.postId].add(member.userId);
        });

        const totalMessagesCount = {};
        totalMessagesData.forEach((msg) => {
          totalMessagesCount[msg.postId] = parseInt(msg.count);
        });

        // Combine chatroom stats
        postIds.forEach((postId) => {
          chatroomStats[postId] = {
            activeMembers: activeMembersCount[postId]?.size || 0,
            totalMessages: totalMessagesCount[postId] || 0,
          };
        });
      }

      // OPTIMIZATION: Format posts with better performance and couples ranking
      const formattedPosts = feedPosts.map((post, index) => {
        const hasVoted =
          post.type === "poll" && pollVoteMap[post.id] !== undefined;
        const chatroomTimeRemaining = calculateChatroomTimeRemaining(post);
        const thresholdTimeRemaining = calculateThresholdTimeRemaining(post);

        // Calculate ranking for Couples category
        let couplesRanking = null;
        if (category === "Couples") {
          couplesRanking = offset + index + 1; // 1-based ranking
        }

        let formattedPollOptions = null;
        if (post.type === "poll" && post.pollOptions) {
          const totalVotes = post.pollOptions.reduce(
            (sum, option) => sum + (option.votes || 0),
            0
          );

          formattedPollOptions = post.pollOptions.map((option, index) => {
            const votes = option.votes || 0;
            const percentage =
              totalVotes > 0
                ? Math.round((votes / totalVotes) * 100 * 10) / 10
                : 0;

            return {
              text: option.text,
              percentage: percentage,
              votes: votes,
              isUserChoice: hasVoted && pollVoteMap[post.id] === index,
            };
          });
        }

        let quotedPost = null;
        if (post.isQuotePost && post.quotedPostSnapshot) {
          try {
            quotedPost = JSON.parse(post.quotedPostSnapshot);

            // Format quoted post poll options if it's a poll
            if (quotedPost.type === "poll" && quotedPost.pollOptions) {
              const totalVotes = quotedPost.pollOptions.reduce(
                (sum, option) => sum + (option.votes || 0),
                0
              );

              quotedPost.pollOptions = quotedPost.pollOptions.map((option) => ({
                text: option.text,
                percentage:
                  totalVotes > 0
                    ? Math.round((option.votes / totalVotes) * 100 * 10) / 10
                    : 0,
                votes: option.votes || 0,
                isUserChoice: false, // Users can't interact with quoted polls
              }));

              quotedPost.totalVotes = totalVotes;
            }
          } catch (error) {
            console.error("Error parsing quoted post snapshot:", error);
            quotedPost = null;
          }
        }

        return {
          ...post,
          pollOptions: formattedPollOptions,
          totalVotes: formattedPollOptions
            ? formattedPollOptions.reduce(
                (sum, option) => sum + option.votes,
                0
              )
            : 0,
          timeAgo: getTimeAgo(post.createdAt),
          userDisplayName:
            post.userBusinessName ||
            `${post.userFirstName} ${post.userLastName}`.trim(),
          isLiked: interactionMap[post.id]?.like || false,
          isSaved: interactionMap[post.id]?.save || false,
          hasVoted: hasVoted,
          userVotedOption: pollVoteMap[post.id] || null,
          commentsCount: post.commentsCount || 0,
          isQuotePost: post.isQuotePost || false,
          quotedPostId: post.quotedPostId,
          quotedPost: quotedPost,
          quotesCount: post.quotesCount || 0,
          recentComment:
            category === "My Posts" ? recentCommentsMap[post.id] || null : null,
          chatroomData:
            post.commentsEnabled && category !== "My Posts"
              ? {
                  timeRemaining: chatroomTimeRemaining,
                  isActive: chatroomTimeRemaining > 0,
                  activeMembers: chatroomStats[post.id]?.activeMembers || 0,
                  totalMessages: chatroomStats[post.id]?.totalMessages || 0,
                }
              : null,
          thresholdData: {
            timeRemaining: thresholdTimeRemaining,
            isActive: thresholdTimeRemaining > 0 && !post.thresholdMet,
            thresholdMet: post.thresholdMet,
            requiredLikes: getThresholdRequirement(post.categories),
            currentLikes: post.likes,
            thresholdMetAt: post.thresholdMetAt,
          },
          couplesRanking: couplesRanking,
          // NEW: Include visibility status for frontend handling
          visibilityStatus: {
            isAuthorOnly: post.visibleToAuthorOnly,
            isPublic: !post.visibleToAuthorOnly && post.thresholdMet,
            isOwner: userAuthenticated && userId === post.userId,
          },
        };
      });

      // Calculate hasMore for pagination
      const hasMore =
        category === "Couples"
          ? offset + feedPosts.length < maxResults
          : feedPosts.length === parseInt(limit);

      res.json({
        posts: formattedPosts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          hasMore: hasMore,
          total: maxResults,
        },
      });
    } catch (error) {
      console.error("Error fetching feed:", error);
      res.status(500).json({ error: "Failed to fetch feed" });
    }
  },

  async getCoupleFeed(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        search = "",
        sortBy = "newest",
      } = req.query;

      const offset = (page - 1) * limit;

      // Base condition for couples feed
      let whereCondition = and(
        eq(posts.isActive, true),
        eq(posts.thresholdMet, true),
        sql`${posts.categories}::text LIKE '%Couples%'`
      );

      // Apply search filter
      if (search && search.trim()) {
        const searchTerm = search.trim().toLowerCase();
        whereCondition = and(
          whereCondition,
          or(
            sql`LOWER(${posts.subject}) LIKE LOWER(${"%" + searchTerm + "%"})`,
            sql`LOWER(${posts.content}) LIKE LOWER(${"%" + searchTerm + "%"})`
          )
        );
      }

      // Apply sorting
      let orderBy = desc(posts.likes); // Default for couples is by likes
      switch (sortBy) {
        case "oldest":
          orderBy = asc(posts.createdAt);
          break;
        case "likes":
          orderBy = desc(posts.likes);
          break;
        case "saves":
          orderBy = desc(posts.saves);
          break;
        case "newest":
          orderBy = desc(posts.createdAt);
          break;
      }

      // Limit couples posts to top 10
      const maxCouplesPost = 10;
      if (offset >= maxCouplesPost) {
        return res.json({
          posts: [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            hasMore: false,
            total: 0,
          },
        });
      }

      const queryLimit = Math.min(parseInt(limit), maxCouplesPost - offset);

      // Get total count
      const totalCountQuery = await db
        .select({ count: sql`COUNT(*)`.as("count") })
        .from(posts)
        .where(whereCondition);

      const totalCount = Math.min(
        parseInt(totalCountQuery[0]?.count || 0),
        maxCouplesPost
      );

      // Get posts
      const feedPosts = await db
        .select({
          id: posts.id,
          subject: posts.subject,
          content: posts.content,
          categories: posts.categories,
          type: posts.type,
          pollOptions: posts.pollOptions,
          likes: posts.likes,
          saves: posts.saves,
          commentsCount: posts.commentsCount,
          createdAt: posts.createdAt,
          thresholdMet: posts.thresholdMet,
          thresholdMetAt: posts.thresholdMetAt,
          userId: posts.userId,
          userFirstName: users.firstName,
          userLastName: users.lastName,
          userBusinessName: users.businessName,
          userProfilePicture: users.profilePicture,
          commentsEnabled: posts.commentsEnabled,
          commentsEnabledAt: posts.commentsEnabledAt,
        })
        .from(posts)
        .leftJoin(users, eq(posts.userId, users.id))
        .where(whereCondition)
        .orderBy(orderBy)
        .limit(queryLimit)
        .offset(offset);

      if (feedPosts.length === 0) {
        return res.json({
          posts: [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            hasMore: false,
            total: totalCount,
          },
        });
      }

      // Get recent comments for couples posts
      const postIds = feedPosts.map((post) => post.id);
      const recentComments = await db
        .select({
          id: comments.id,
          postId: comments.postId,
          content: comments.content,
          createdAt: comments.createdAt,
          userId: comments.userId,
          userFirstName: users.firstName,
          userLastName: users.lastName,
          userBusinessName: users.businessName,
          chatroomUsername: chatroomIdentities.chatroomUsername,
        })
        .from(comments)
        .leftJoin(users, eq(comments.userId, users.id))
        .leftJoin(
          chatroomIdentities,
          and(
            eq(chatroomIdentities.userId, comments.userId),
            eq(chatroomIdentities.postId, comments.postId)
          )
        )
        .where(
          and(
            inArray(comments.postId, postIds),
            eq(comments.isActive, true),
            isNull(comments.parentCommentId)
          )
        )
        .orderBy(desc(comments.createdAt));

      // Process recent comments
      const recentCommentsMap = {};
      recentComments.forEach((comment) => {
        if (!recentCommentsMap[comment.postId]) {
          const userDisplayName =
            comment.chatroomUsername ||
            comment.userBusinessName ||
            `${comment.userFirstName} ${comment.userLastName}`.trim();

          recentCommentsMap[comment.postId] = {
            ...comment,
            timeAgo: getTimeAgo(comment.createdAt),
            userDisplayName: userDisplayName,
            isReply: !!comment.parentCommentId,
          };
        }
      });

      // Format posts for non-authenticated users
      const formattedPosts = feedPosts.map((post) => {
        const chatroomTimeRemaining = calculateChatroomTimeRemaining(post);
        const thresholdTimeRemaining = calculateThresholdTimeRemaining(post);

        let formattedPollOptions = null;
        if (post.type === "poll" && post.pollOptions) {
          const totalVotes = post.pollOptions.reduce(
            (sum, option) => sum + (option.votes || 0),
            0
          );

          formattedPollOptions = post.pollOptions.map((option) => {
            const votes = option.votes || 0;
            const percentage =
              totalVotes > 0
                ? Math.round((votes / totalVotes) * 100 * 10) / 10
                : 0;

            return {
              text: option.text,
              percentage: percentage,
              votes: votes,
              isUserChoice: false, // Non-authenticated users haven't voted
            };
          });
        }

        return {
          ...post,
          pollOptions: formattedPollOptions,
          totalVotes: formattedPollOptions
            ? formattedPollOptions.reduce(
                (sum, option) => sum + option.votes,
                0
              )
            : 0,
          timeAgo: getTimeAgo(post.createdAt),
          userDisplayName:
            post.userBusinessName ||
            `${post.userFirstName} ${post.userLastName}`.trim(),
          isLiked: false,
          isSaved: false,
          hasVoted: false,
          userVotedOption: null,
          commentsCount: post.commentsCount || 0,
          recentComment: recentCommentsMap[post.id] || null,
          chatroomData: post.commentsEnabled
            ? {
                timeRemaining: chatroomTimeRemaining,
                isActive: chatroomTimeRemaining > 0,
                activeMembers: 0,
                totalMessages: 0,
              }
            : null,
          thresholdData: {
            timeRemaining: thresholdTimeRemaining,
            isActive: false,
            thresholdMet: post.thresholdMet,
            requiredLikes: getThresholdRequirement(post.categories),
            currentLikes: post.likes,
            thresholdMetAt: post.thresholdMetAt,
          },
        };
      });

      const hasMore = offset + feedPosts.length < totalCount;

      res.json({
        posts: formattedPosts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          hasMore: hasMore,
          total: totalCount,
        },
      });
    } catch (error) {
      console.error("Error fetching couple feed:", error);
      res.status(500).json({ error: "Failed to fetch couple feed" });
    }
  },

  async globalSearch(req, res) {
    try {
      const {
        query: searchQuery = "",
        page = 1,
        limit = 10,
        sortBy = "newest",
        categories = "", // comma-separated categories to filter by
      } = req.query;

      // Check if search query is provided
      if (!searchQuery || searchQuery.trim().length < 2) {
        return res.status(400).json({
          error: "Search query must be at least 2 characters long",
        });
      }

      // UPDATED: Handle both authenticated and unauthenticated users
      const userAuthenticated = !!(req.user && req.user.id);
      const userId = userAuthenticated ? req.user.id : null;
      const offset = (page - 1) * limit;

      console.log(
        `Global search - Query: "${searchQuery}", Page: ${page}, Limit: ${limit}, Sort: ${sortBy}, Categories: "${categories}", Auth: ${userAuthenticated}, UserId: ${
          userId || "none"
        }`
      );

      // Base condition - only active posts that are visible
      let whereCondition = and(
        eq(posts.isActive, true),
        eq(posts.visibleToAuthorOnly, false), // Only public posts for global search
        eq(posts.thresholdMet, true) // Only posts that have met threshold
      );

      // Add search filter - search in both subject and content
      const searchTerm = searchQuery.trim().toLowerCase();
      whereCondition = and(
        whereCondition,
        or(
          sql`LOWER(${posts.subject}) LIKE LOWER(${"%" + searchTerm + "%"})`,
          sql`LOWER(${posts.content}) LIKE LOWER(${"%" + searchTerm + "%"})`
        )
      );

      // Add category filter if provided
      if (categories && categories.trim()) {
        const categoryList = categories
          .split(",")
          .map((cat) => cat.trim())
          .filter((cat) => cat);
        if (categoryList.length > 0) {
          const categoryConditions = categoryList.map(
            (category) =>
              sql`${posts.categories}::text LIKE ${"%" + category + "%"}`
          );

          if (categoryConditions.length === 1) {
            whereCondition = and(whereCondition, categoryConditions[0]);
          } else {
            whereCondition = and(whereCondition, or(...categoryConditions));
          }
        }
      }

      // Get sort order
      const getSortOrder = (sortBy) => {
        switch (sortBy) {
          case "oldest":
            return asc(posts.createdAt);
          case "likes":
            return desc(posts.likes);
          case "saves":
            return desc(posts.saves);
          case "newest":
          default:
            return desc(posts.createdAt);
        }
      };

      const orderBy = getSortOrder(sortBy);

      // Get total count
      const totalCountQuery = await db
        .select({ count: sql`COUNT(*)`.as("count") })
        .from(posts)
        .where(whereCondition);

      const totalCount = parseInt(totalCountQuery[0]?.count || 0);

      // Main search query
      const searchResults = await db
        .select({
          id: posts.id,
          subject: posts.subject,
          content: posts.content,
          categories: posts.categories,
          type: posts.type,
          pollOptions: posts.pollOptions,
          likes: posts.likes,
          saves: posts.saves,
          commentsCount: posts.commentsCount,
          createdAt: posts.createdAt,
          thresholdMet: posts.thresholdMet,
          thresholdMetAt: posts.thresholdMetAt,
          visibleToAuthorOnly: posts.visibleToAuthorOnly,
          userId: posts.userId,
          userFirstName: users.firstName,
          userLastName: users.lastName,
          userBusinessName: users.businessName,
          userProfilePicture: users.profilePicture,
          isQuotePost: posts.isQuotePost,
          quotedPostId: posts.quotedPostId,
          quotedPostSnapshot: posts.quotedPostSnapshot,
          quotesCount: posts.quotesCount,
          commentsEnabled: posts.commentsEnabled,
          commentsEnabledAt: posts.commentsEnabledAt,
          commentsDisabledAt: posts.commentsDisabledAt,
        })
        .from(posts)
        .leftJoin(users, eq(posts.userId, users.id))
        .where(whereCondition)
        .orderBy(orderBy)
        .limit(parseInt(limit))
        .offset(offset);

      if (searchResults.length === 0) {
        return res.json({
          posts: [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            hasMore: false,
            total: totalCount,
          },
          searchQuery: searchQuery,
        });
      }

      // UPDATED: Only get user interactions and poll votes for authenticated users
      const postIds = searchResults.map((post) => post.id);
      let interactionMap = {};
      let pollVoteMap = {};

      if (userAuthenticated && userId) {
        try {
          const [userInteractions, userPollVotes] = await Promise.all([
            db
              .select()
              .from(postInteractions)
              .where(
                and(
                  eq(postInteractions.userId, userId),
                  inArray(postInteractions.postId, postIds)
                )
              ),
            db
              .select()
              .from(pollVotes)
              .where(
                and(
                  eq(pollVotes.userId, userId),
                  inArray(pollVotes.postId, postIds)
                )
              ),
          ]);

          // Map interactions
          userInteractions.forEach((interaction) => {
            if (!interactionMap[interaction.postId]) {
              interactionMap[interaction.postId] = {};
            }
            interactionMap[interaction.postId][interaction.type] = true;
          });

          userPollVotes.forEach((vote) => {
            pollVoteMap[vote.postId] = vote.optionIndex;
          });
        } catch (error) {
          console.error("Error fetching user interactions:", error);
          // Continue without interactions for this user
        }
      }

      // Format the search results
      const formattedPosts = searchResults.map((post) => {
        const hasVoted =
          post.type === "poll" && pollVoteMap[post.id] !== undefined;
        const chatroomTimeRemaining = calculateChatroomTimeRemaining(post);
        const thresholdTimeRemaining = calculateThresholdTimeRemaining(post);

        let formattedPollOptions = null;
        if (post.type === "poll" && post.pollOptions) {
          const totalVotes = post.pollOptions.reduce(
            (sum, option) => sum + (option.votes || 0),
            0
          );

          formattedPollOptions = post.pollOptions.map((option, index) => ({
            text: option.text,
            percentage:
              totalVotes > 0
                ? Math.round((option.votes / totalVotes) * 100 * 10) / 10
                : 0,
            votes: option.votes || 0,
            isUserChoice: hasVoted && pollVoteMap[post.id] === index,
          }));
        }

        let quotedPost = null;
        if (post.isQuotePost && post.quotedPostSnapshot) {
          try {
            quotedPost =
              typeof post.quotedPostSnapshot === "string"
                ? JSON.parse(post.quotedPostSnapshot)
                : post.quotedPostSnapshot;

            // Format quoted post poll options if needed
            if (quotedPost.type === "poll" && quotedPost.pollOptions) {
              const totalVotes = quotedPost.pollOptions.reduce(
                (sum, option) => sum + (option.votes || 0),
                0
              );
              quotedPost.pollOptions = quotedPost.pollOptions.map((option) => ({
                text: option.text,
                percentage:
                  totalVotes > 0
                    ? Math.round((option.votes / totalVotes) * 100 * 10) / 10
                    : 0,
                votes: option.votes || 0,
                isUserChoice: false, // Quoted posts never show user's vote
              }));
              quotedPost.totalVotes = totalVotes;
            }
          } catch (error) {
            console.error("Error parsing quoted post snapshot:", error);
            quotedPost = null;
          }
        }

        return {
          ...post,
          pollOptions: formattedPollOptions,
          totalVotes: formattedPollOptions
            ? formattedPollOptions.reduce(
                (sum, option) => sum + option.votes,
                0
              )
            : 0,
          timeAgo: getTimeAgo(post.createdAt),
          userDisplayName:
            post.userBusinessName ||
            `${post.userFirstName} ${post.userLastName}`.trim(),
          // UPDATED: Default to false for unauthenticated users
          isLiked: userAuthenticated
            ? interactionMap[post.id]?.like || false
            : false,
          isSaved: userAuthenticated
            ? interactionMap[post.id]?.save || false
            : false,
          hasVoted: userAuthenticated ? hasVoted : false,
          userVotedOption: userAuthenticated
            ? pollVoteMap[post.id] || null
            : null,
          commentsCount: post.commentsCount || 0,
          quotesCount: post.quotesCount || 0,
          isQuotePost: post.isQuotePost || false,
          quotedPostId: post.quotedPostId,
          quotedPost: quotedPost,
          chatroomData: post.commentsEnabled
            ? {
                timeRemaining: chatroomTimeRemaining,
                isActive: chatroomTimeRemaining > 0,
                activeMembers: 0, // Would need separate query for this
                totalMessages: 0, // Would need separate query for this
              }
            : null,
          thresholdData: {
            timeRemaining: thresholdTimeRemaining,
            isActive: thresholdTimeRemaining > 0 && !post.thresholdMet,
            thresholdMet: post.thresholdMet,
            requiredLikes: getThresholdRequirement(post.categories),
            currentLikes: post.likes,
            thresholdMetAt: post.thresholdMetAt,
          },
          visibilityStatus: {
            isAuthorOnly: post.visibleToAuthorOnly,
            isPublic: !post.visibleToAuthorOnly && post.thresholdMet,
            // UPDATED: Default to false for unauthenticated users
            isOwner: userAuthenticated ? userId === post.userId : false,
          },
          // Add search relevance score (simple implementation)
          relevanceScore: calculateRelevanceScore(post, searchTerm),
        };
      });

      // Calculate pagination
      const hasMore = offset + searchResults.length < totalCount;

      res.json({
        posts: formattedPosts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          hasMore: hasMore,
          total: totalCount,
        },
        searchQuery: searchQuery,
        appliedFilters: {
          categories: categories
            ? categories
                .split(",")
                .map((cat) => cat.trim())
                .filter((cat) => cat)
            : [],
          sortBy: sortBy,
        },
        // UPDATED: Include authentication status in response
        userAuthenticated: userAuthenticated,
      });
    } catch (error) {
      console.error("Error in global search:", error);
      res.status(500).json({ error: "Failed to perform search" });
    }
  },

  async createPost(req, res) {
    try {
      const {
        subject,
        content,
        categories,
        type = "text",
        pollOptions,
        quotedPostId,
      } = req.body;

      const userId = req.userData.id;

      // Input validation
      if (!content?.trim()) {
        return res.status(400).json({ error: "Need to input body text" });
      }

      if (!subject?.trim()) {
        return res.status(400).json({ error: "Subject is required" });
      }

      if (!categories || categories.length === 0) {
        return res.status(400).json({ error: "Creative category is required" });
      }

      if (type === "poll" && (!pollOptions || pollOptions.length < 2)) {
        return res.status(400).json({
          error: "Poll must have at least 2 options",
        });
      }

      // ============================================
      // RATE LIMIT CHECK - ONLY CHECK, DON'T INCREMENT YET
      // ============================================
      const rateLimitResult = await checkPostRateLimit(userId, db);

      if (!rateLimitResult.allowed) {
        const resetTime = rateLimitResult.resetAt;
        const minutesUntilReset = Math.ceil((resetTime - new Date()) / 60000);

        return res.status(429).json({
          error: `You have hit the limit allowed for this hour. Please try again later`,
          retryAfter: Math.ceil((resetTime - new Date()) / 1000),
        });
      }

      // 2 second check (existing throttling)
      const twoSecondsAgo = new Date(Date.now() - 2000);
      const recentPost = await db
        .select({ id: posts.id })
        .from(posts)
        .where(
          and(eq(posts.userId, userId), gte(posts.createdAt, twoSecondsAgo))
        )
        .limit(1);

      if (recentPost.length > 0) {
        return res.status(429).json({
          error: "Please wait a moment before posting again.",
        });
      }

      // Handle quote post validation
      let quotedPostSnapshot = null;
      let isQuotePost = false;

      if (quotedPostId) {
        const quotedPost = await db
          .select({
            id: posts.id,
            userId: posts.userId,
            subject: posts.subject,
            content: posts.content,
            categories: posts.categories,
            type: posts.type,
            pollOptions: posts.pollOptions,
            likes: posts.likes,
            saves: posts.saves,
            commentsCount: posts.commentsCount,
            quotesCount: posts.quotesCount,
            createdAt: posts.createdAt,
            thresholdMet: posts.thresholdMet,
            visibleToAuthorOnly: posts.visibleToAuthorOnly,
            userFirstName: users.firstName,
            userLastName: users.lastName,
            userBusinessName: users.businessName,
            userProfilePicture: users.profilePicture,
            userIsAnonymous: users.isAnonymous,
          })
          .from(posts)
          .leftJoin(users, eq(posts.userId, users.id))
          .where(and(eq(posts.id, quotedPostId), eq(posts.isActive, true)))
          .limit(1);

        if (quotedPost.length === 0) {
          return res.status(404).json({ error: "Quoted post not found" });
        }

        const post = quotedPost[0];

        if (post.visibleToAuthorOnly && post.userId !== userId) {
          return res.status(403).json({ error: "Cannot quote this post" });
        }

        const authorDisplayName =
          post.userBusinessName ||
          `${post.userFirstName} ${post.userLastName}`.trim();

        quotedPostSnapshot = {
          id: post.id,
          userId: post.userId,
          subject: post.subject,
          content: post.content,
          categories: post.categories,
          type: post.type,
          pollOptions: post.pollOptions,
          likes: post.likes,
          saves: post.saves,
          commentsCount: post.commentsCount,
          quotesCount: post.quotesCount,
          createdAt: post.createdAt,
          thresholdMet: post.thresholdMet,
          userDisplayName: authorDisplayName,
          userProfilePicture: post.userProfilePicture,
        };

        isQuotePost = true;
      }

      // Check Couples category once per day
      if (categories.includes("Couples")) {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        const existingCouplesPost = await db
          .select({ id: posts.id })
          .from(posts)
          .where(
            and(
              eq(posts.userId, userId),
              sql`${posts.categories}::text ILIKE '%Couples%'`,
              gte(posts.createdAt, startOfDay),
              lte(posts.createdAt, endOfDay)
            )
          )
          .limit(1);

        if (existingCouplesPost.length > 0) {
          return res.status(400).json({
            error: "You can only create one Couples post per day.",
          });
        }
      }

      // Format poll options
      let formattedPollOptions = null;
      if (type === "poll") {
        formattedPollOptions = pollOptions.map((option) => ({
          text: option,
          votes: 0,
        }));
      }

      // Create post
      const result = await db.transaction(
        async (tx) => {
          const [newPost] = await tx
            .insert(posts)
            .values({
              userId,
              subject,
              content,
              categories: JSON.stringify(categories),
              type,
              pollOptions: formattedPollOptions
                ? JSON.stringify(formattedPollOptions)
                : null,
              isQuotePost,
              quotedPostId: quotedPostId || null,
              quotedPostSnapshot: quotedPostSnapshot
                ? JSON.stringify(quotedPostSnapshot)
                : null,
              createdAt: new Date(),
            })
            .returning();

          if (quotedPostId) {
            await tx
              .update(posts)
              .set({
                quotesCount: sql`${posts.quotesCount} + 1`,
                updatedAt: new Date(),
              })
              .where(eq(posts.id, quotedPostId));
          }

          return newPost;
        },
        { isolationLevel: "read committed" }
      );

      // ============================================
      // INCREMENT RATE LIMIT - ONLY AFTER SUCCESSFUL POST CREATION
      // ============================================
      await incrementPostRateLimit(userId, db);

      res.status(201).json({ post: result });
    } catch (error) {
      console.error("Error creating post:", error);
      res.status(500).json({ error: "Failed to create post" });
    }
  },

  async toggleLike(req, res) {
    try {
      const { postId } = req.params;
      const userId = req.userData.id;

      // Get current post data
      const currentPost = await db
        .select({
          id: posts.id,
          userId: posts.userId,
          subject: posts.subject,
          likes: posts.likes,
          thresholdMet: posts.thresholdMet,
          commentsEnabled: posts.commentsEnabled,
          createdAt: posts.createdAt,
        })
        .from(posts)
        .where(eq(posts.id, postId))
        .limit(1);

      if (currentPost.length === 0) {
        return res.status(404).json({ error: "Post not found" });
      }

      const post = currentPost[0];

      // Check if user already liked this post
      const existing = await db
        .select()
        .from(postInteractions)
        .where(
          and(
            eq(postInteractions.userId, userId),
            eq(postInteractions.postId, postId),
            eq(postInteractions.type, "like")
          )
        )
        .limit(1);

      const isCurrentlyLiked = existing.length > 0;

      if (isCurrentlyLiked) {
        // UNLIKE LOGIC
        const newLikes = post.likes - 1;

        // CRITICAL CHECK: Prevent unliking if this would break the threshold
        if (post.thresholdMet && newLikes < 1) {
          return res.status(400).json({
            error:
              "Cannot unlike - this would cause the post to lose its threshold status",
            message: "This like is required to maintain the post's threshold",
            canUnlike: false,
          });
        }

        // Safe to unlike - proceed
        await db
          .delete(postInteractions)
          .where(eq(postInteractions.id, existing[0].id));

        await db
          .update(posts)
          .set({
            likes: newLikes,
            updatedAt: new Date(),
          })
          .where(eq(posts.id, postId));

        // NO NOTIFICATION ON UNLIKE

        res.json({
          liked: false,
          message: "Post unliked",
          likes: newLikes,
          canUnlike: true,
        });
      } else {
        // LIKE LOGIC
        await db.insert(postInteractions).values({
          userId,
          postId,
          type: "like",
        });

        const newLikes = post.likes + 1;
        const postCreatedAt = new Date(post.createdAt);
        const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
        const isPostWithin48Hours = postCreatedAt >= fortyEightHoursAgo;

        let updateData = {
          likes: newLikes,
          updatedAt: new Date(),
        };

        let thresholdJustMet = false;
        let commentsJustEnabled = false;

        // Update threshold status if just met
        if (!post.thresholdMet && newLikes >= 1) {
          updateData.thresholdMet = true;
          updateData.thresholdMetAt = new Date();
          thresholdJustMet = true;
          console.log(
            `🎯 INSTANT: Threshold met for post ${postId} (${newLikes}/1 likes)`
          );
        }

        // Enable comments if threshold met and post is within 48 hours
        if (!post.commentsEnabled && newLikes >= 1 && isPostWithin48Hours) {
          updateData.commentsEnabled = true;
          updateData.commentsEnabledAt = new Date();
          commentsJustEnabled = true;
          console.log(
            `💬 INSTANT: Comments enabled for post ${postId} (${newLikes} likes)`
          );
        }

        await db.update(posts).set(updateData).where(eq(posts.id, postId));

        // === NOTIFICATION LOGIC - ONLY ON LIKE ===
        // Don't notify if user is liking their own post
        // if (post.userId !== userId) {
        //   const NotificationService = require("../services/notificationService");
        //   await NotificationService.notifyPostLike(
        //     post.userId,
        //     userId,
        //     postId,
        //     post.subject
        //   );
        // }

        res.json({
          liked: true,
          message: "Post liked",
          likes: newLikes,
          thresholdMet: newLikes >= 1,
          commentsEnabled: newLikes >= 1 && isPostWithin48Hours,
          thresholdJustMet,
          commentsJustEnabled,
          canUnlike: newLikes > 1,
        });
      }
    } catch (error) {
      console.error("Error toggling like:", error);
      res.status(500).json({ error: "Failed to toggle like" });
    }
  },

  async checkPostingEligibility(req, res) {
    try {
      const userId = req.userData.id;

      // Count how many posts the user has liked
      const likeCount = await db
        .select({ count: sql`count(*)` })
        .from(postInteractions)
        .where(
          and(
            eq(postInteractions.userId, userId),
            eq(postInteractions.type, "like")
          )
        );

      const totalLikes = parseInt(likeCount[0].count) || 0;
      const canPost = totalLikes >= 5;

      return res.json({
        success: true,
        canPost,
        likesCount: totalLikes,
        likesRequired: 5,
        likesRemaining: Math.max(0, 5 - totalLikes),
      });
    } catch (error) {
      console.error("Error checking posting eligibility:", error);
      res.status(500).json({ error: "Failed to check posting eligibility" });
    }
  },

  async toggleSave(req, res) {
    try {
      const { postId } = req.params;
      const userId = req.userData.id; // Use real user ID

      // Check if already saved
      const existing = await db
        .select()
        .from(postInteractions)
        .where(
          and(
            eq(postInteractions.userId, userId),
            eq(postInteractions.postId, postId),
            eq(postInteractions.type, "save")
          )
        )
        .limit(1);

      if (existing.length > 0) {
        // Unsave
        await db
          .delete(postInteractions)
          .where(eq(postInteractions.id, existing[0].id));

        await db
          .update(posts)
          .set({ saves: sql`${posts.saves} - 1` })
          .where(eq(posts.id, postId));

        res.json({ saved: false, message: "Post unsaved" });
      } else {
        // Save - Insert with current timestamp to ensure proper ordering
        await db.insert(postInteractions).values({
          userId,
          postId,
          type: "save",
          createdAt: new Date(),
        });

        await db
          .update(posts)
          .set({ saves: sql`${posts.saves} + 1` })
          .where(eq(posts.id, postId));

        res.json({ saved: true, message: "Post saved" });
      }
    } catch (error) {
      console.error("Error toggling save:", error);
      res.status(500).json({ error: "Failed to toggle save" });
    }
  },

  getTimeAgo(date) {
    const now = new Date();
    const diffTime = Math.abs(now - new Date(date));
    const diffHours = Math.floor(diffTime / (1000 * 60 * 60));
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours} hours ago`;
    if (diffDays === 1) return "1 day ago";
    return `${diffDays} days ago`;
  },

  async getPost(req, res) {
    try {
      const { postId } = req.params;
      const userId = req.user?.id; // Use optional chaining - will be undefined if not authenticated

      const [post] = await db
        .select({
          id: posts.id,
          subject: posts.subject,
          content: posts.content,
          categories: posts.categories,
          type: posts.type,
          pollOptions: posts.pollOptions,
          likes: posts.likes,
          saves: posts.saves,
          createdAt: posts.createdAt,
          userId: posts.userId,
          userFirstName: users.firstName,
          userLastName: users.lastName,
          userBusinessName: users.businessName,
          userProfilePicture: users.profilePicture,
          commentsEnabled: posts.commentsEnabled,
          commentsEnabledAt: posts.commentsEnabledAt,
          commentsDisabledAt: posts.commentsDisabledAt,
          openedBy: posts.openedBy,
          openedByUsername: posts.openedByUsername,
          commentsCount: posts.commentsCount,
          quotesCount: posts.quotesCount,
          thresholdMet: posts.thresholdMet,
          thresholdMetAt: posts.thresholdMetAt,
          // Quote fields
          isQuotePost: posts.isQuotePost,
          quotedPostId: posts.quotedPostId,
          quotedPostSnapshot: posts.quotedPostSnapshot,
        })
        .from(posts)
        .leftJoin(users, eq(posts.userId, users.id))
        .where(eq(posts.id, postId))
        .limit(1);

      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }

      // Check user interactions only if user is authenticated
      let interactionMap = {};
      let userVoteInfo = null; // NEW: Store user's vote info including timestamp

      if (userId) {
        const userInteractions = await db
          .select()
          .from(postInteractions)
          .where(
            and(
              eq(postInteractions.userId, userId),
              eq(postInteractions.postId, postId)
            )
          );

        userInteractions.forEach((interaction) => {
          interactionMap[interaction.type] = true;
        });

        // NEW: Get user's vote information including timestamp if they voted on this poll
        if (post.type === "poll") {
          const [userVote] = await db
            .select({
              optionIndex: pollVotes.optionIndex,
              voteTimestamp: pollVotes.voteTimestamp,
            })
            .from(pollVotes)
            .where(
              and(eq(pollVotes.userId, userId), eq(pollVotes.postId, postId))
            )
            .limit(1);

          if (userVote) {
            userVoteInfo = {
              optionIndex: userVote.optionIndex,
              voteTimestamp: userVote.voteTimestamp.getTime(), // Convert to Unix timestamp
            };
          }
        }
      }

      // Get chatroom statistics if comments are enabled
      let chatroomStats = {
        activeMembers: 0,
        totalMessages: 0,
      };

      if (post.commentsEnabled) {
        // Get active members (users who commented in the last 24 hours)
        const [activeMembersResult] = await db
          .select({
            count: sql`COUNT(DISTINCT ${comments.userId})`.as("count"),
          })
          .from(comments)
          .where(
            and(
              eq(comments.postId, postId),
              eq(comments.isActive, true),
              sql`${comments.createdAt} > NOW() - INTERVAL '24 hours'`
            )
          );

        // Get total message count
        const [totalMessagesResult] = await db
          .select({ count: sql`COUNT(*)`.as("count") })
          .from(comments)
          .where(and(eq(comments.postId, postId), eq(comments.isActive, true)));

        chatroomStats = {
          activeMembers: activeMembersResult?.count || 0,
          totalMessages: totalMessagesResult?.count || 0,
        };
      }

      // Calculate chatroom time remaining ONLY if comments exist
      let chatroomData = null;
      if (post.commentsEnabled) {
        if (post.commentsCount > 0) {
          // Timer has started because there are comments
          const [firstComment] = await db
            .select({ createdAt: comments.createdAt })
            .from(comments)
            .where(
              and(eq(comments.postId, postId), eq(comments.isActive, true))
            )
            .orderBy(comments.createdAt)
            .limit(1);

          if (firstComment) {
            const firstCommentTime = new Date(firstComment.createdAt);
            const expiresAt = new Date(
              firstCommentTime.getTime() + 1 * 60 * 60 * 1000
            );
            const now = new Date();
            const timeRemaining = Math.max(0, expiresAt - now); // milliseconds

            chatroomData = {
              timeRemaining: timeRemaining,
              isActive: timeRemaining > 0,
              activeMembers: chatroomStats.activeMembers,
              totalMessages: chatroomStats.totalMessages,
              timerStarted: true,
            };
          }
        } else {
          // Comments enabled but no comments yet - timer hasn't started
          chatroomData = {
            timeRemaining: null, // No timer yet
            isActive: true, // Comments are enabled
            activeMembers: chatroomStats.activeMembers,
            totalMessages: chatroomStats.totalMessages,
            timerStarted: false,
          };
        }
      }

      // NEW: Process poll options with user vote information
      let processedPollOptions = post.pollOptions;
      let hasVoted = false;

      if (post.type === "poll" && post.pollOptions && userVoteInfo) {
        hasVoted = true;
        processedPollOptions = post.pollOptions.map((option, index) => ({
          ...option,
          isUserChoice: index === userVoteInfo.optionIndex,
        }));
      }

      const formattedPost = {
        ...post,
        timeAgo: getTimeAgo(post.createdAt),
        userDisplayName:
          post.userBusinessName ||
          `${post.userFirstName} ${post.userLastName}`.trim(),
        quotesCount: post.quotesCount || 0,
        // Default to false if user is not authenticated
        isLiked: interactionMap.like || false,
        isSaved: interactionMap.save || false,
        chatroomData: chatroomData,
        // Quote data
        isQuotePost: post.isQuotePost || false,
        quotedPostId: post.quotedPostId || null,
        quotedPostSnapshot: post.quotedPostSnapshot || null,
        // NEW: Poll voting information
        hasVoted: hasVoted,
        pollOptions: processedPollOptions,
        voteTimestamp: userVoteInfo?.voteTimestamp || null, // Include vote timestamp if user voted
      };

      res.json({ post: formattedPost });
    } catch (error) {
      console.error("Error fetching post:", error);
      res.status(500).json({ error: "Failed to fetch post" });
    }
  },

  async votePoll(req, res) {
    try {
      const { postId } = req.params;
      const { optionIndex } = req.body;
      const userId = req.user.id;

      // Validate input
      if (typeof optionIndex !== "number" || optionIndex < 0) {
        return res.status(400).json({ error: "Invalid option index" });
      }

      // Get the post and verify it's a poll
      const [post] = await db
        .select()
        .from(posts)
        .where(eq(posts.id, postId))
        .limit(1);

      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }

      if (
        post.type !== "poll" ||
        !post.pollOptions ||
        !Array.isArray(post.pollOptions)
      ) {
        return res.status(400).json({ error: "Invalid poll" });
      }

      if (optionIndex >= post.pollOptions.length) {
        return res.status(400).json({ error: "Option index out of range" });
      }

      // Check if user has already voted
      const [existingVote] = await db
        .select()
        .from(pollVotes)
        .where(and(eq(pollVotes.userId, userId), eq(pollVotes.postId, postId)))
        .limit(1);

      const now = new Date();
      const voteTimestamp = now.getTime();

      if (existingVote) {
        // Check if vote is within 30-second edit window
        const timeSinceVote =
          now.getTime() - existingVote.voteTimestamp.getTime();
        if (timeSinceVote > 30000) {
          // 30 seconds
          return res
            .status(400)
            .json({ error: "Vote editing window has expired" });
        }

        // Update existing vote
        await db
          .update(pollVotes)
          .set({
            optionIndex,
            voteTimestamp: now, // Update timestamp for new edit window
          })
          .where(eq(pollVotes.id, existingVote.id));
      } else {
        // Create new vote
        await db.insert(pollVotes).values({
          userId,
          postId,
          optionIndex,
          voteTimestamp: now,
        });
      }

      // Recalculate poll results
      const votes = await db
        .select()
        .from(pollVotes)
        .where(eq(pollVotes.postId, postId));

      const updatedPollOptions = post.pollOptions.map((option, index) => {
        const optionVotes = votes.filter(
          (vote) => vote.optionIndex === index
        ).length;
        const percentage =
          votes.length > 0 ? Math.round((optionVotes / votes.length) * 100) : 0;

        return {
          ...option,
          votes: optionVotes,
          percentage,
          isUserChoice: index === optionIndex,
        };
      });

      // Update post with new poll data
      await db
        .update(posts)
        .set({
          pollOptions: updatedPollOptions,
          updatedAt: now,
        })
        .where(eq(posts.id, postId));

      res.json({
        success: true,
        message: existingVote
          ? "Vote updated successfully"
          : "Vote recorded successfully",
        hasVoted: true,
        pollOptions: updatedPollOptions,
        totalVotes: votes.length,
        voteTimestamp, // Return the timestamp so frontend can set up edit window
      });
    } catch (error) {
      console.error("Error voting on poll:", error);
      res.status(500).json({ error: "Failed to record vote" });
    }
  },

  async getPostPublic(req, res) {
    try {
      const { postId } = req.params;

      const [post] = await db
        .select({
          id: posts.id,
          subject: posts.subject,
          content: posts.content,
          categories: posts.categories,
          type: posts.type,
          pollOptions: posts.pollOptions,
          likes: posts.likes,
          saves: posts.saves,
          createdAt: posts.createdAt,
          userId: posts.userId,
          userFirstName: users.firstName,
          userLastName: users.lastName,
          userBusinessName: users.businessName,
          userProfilePicture: users.profilePicture,
          commentsEnabled: posts.commentsEnabled,
          commentsEnabledAt: posts.commentsEnabledAt,
          commentsDisabledAt: posts.commentsDisabledAt,
          openedBy: posts.openedBy,
          openedByUsername: posts.openedByUsername,
          // ADD THESE FIELDS:
          isQuotePost: posts.isQuotePost,
          quotedPostId: posts.quotedPostId,
          quotedPostSnapshot: posts.quotedPostSnapshot,
          thresholdMet: posts.thresholdMet,
          thresholdMetAt: posts.thresholdMetAt,
          commentsCount: posts.commentsCount,
          quotesCount: posts.quotesCount,
        })
        .from(posts)
        .leftJoin(users, eq(posts.userId, users.id))
        .where(eq(posts.id, postId))
        .limit(1);

      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }

      // Get chatroom stats if applicable
      let chatroomStats = {
        activeMembers: 0,
        totalMessages: 0,
      };

      if (post.commentsEnabled) {
        const [activeMembersResult] = await db
          .select({ count: sql`COUNT(*)`.as("count") })
          .from(comments)
          .where(
            and(
              eq(comments.postId, postId),
              eq(comments.isActive, true),
              sql`${comments.createdAt} > NOW() - INTERVAL '24 hours'`
            )
          );

        const [totalMessagesResult] = await db
          .select({
            count: sql`COUNT(DISTINCT ${comments.userId})`.as("count"),
          })
          .from(comments)
          .where(and(eq(comments.postId, postId), eq(comments.isActive, true)));

        chatroomStats = {
          activeMembers: activeMembersResult?.count || 0,
          totalMessages: totalMessagesResult?.count || 0,
        };
      }

      const formattedPost = {
        ...post,
        timeAgo: getTimeAgo(post.createdAt),
        userDisplayName:
          post.userBusinessName ||
          `${post.userFirstName} ${post.userLastName}`.trim(),
        chatroomData: post.commentsEnabled
          ? {
              timeRemaining: calculateChatroomTimeRemaining(post),
              isActive: calculateChatroomTimeRemaining(post) > 0,
              activeMembers: chatroomStats.activeMembers,
              totalMessages: chatroomStats.totalMessages,
            }
          : null,
      };

      res.json({ post: formattedPost });
    } catch (error) {
      console.error("Error fetching public post:", error);
      res.status(500).json({ error: "Failed to fetch post" });
    }
  },

  async getPostForQuote(req, res) {
    try {
      const { postId } = req.params;
      const userId = req.user?.id;

      const postData = await db
        .select({
          id: posts.id,
          userId: posts.userId,
          subject: posts.subject,
          content: posts.content,
          categories: posts.categories,
          type: posts.type,
          pollOptions: posts.pollOptions,
          likes: posts.likes,
          saves: posts.saves,
          commentsCount: posts.commentsCount,
          createdAt: posts.createdAt,
          thresholdMet: posts.thresholdMet,
          visibleToAuthorOnly: posts.visibleToAuthorOnly,
          userFirstName: users.firstName,
          userLastName: users.lastName,
          userBusinessName: users.businessName,
          userProfilePicture: users.profilePicture,
        })
        .from(posts)
        .leftJoin(users, eq(posts.userId, users.id))
        .where(and(eq(posts.id, postId), eq(posts.isActive, true)))
        .limit(1);

      if (postData.length === 0) {
        return res.status(404).json({ error: "Post not found" });
      }

      const post = postData[0];

      // Check if post is accessible
      if (post.visibleToAuthorOnly && (!userId || post.userId !== userId)) {
        return res.status(403).json({ error: "Post not accessible" });
      }

      // Format the post for quoting
      let formattedPollOptions = null;
      if (post.type === "poll" && post.pollOptions) {
        const totalVotes = post.pollOptions.reduce(
          (sum, option) => sum + (option.votes || 0),
          0
        );

        formattedPollOptions = post.pollOptions.map((option) => ({
          text: option.text,
          percentage:
            totalVotes > 0
              ? Math.round((option.votes / totalVotes) * 100 * 10) / 10
              : 0,
          votes: option.votes || 0,
        }));
      }

      const formattedPost = {
        id: post.id,
        userId: post.userId,
        subject: post.subject,
        content: post.content,
        categories: post.categories,
        type: post.type,
        pollOptions: formattedPollOptions,
        totalVotes: formattedPollOptions
          ? formattedPollOptions.reduce((sum, option) => sum + option.votes, 0)
          : 0,
        likes: post.likes,
        saves: post.saves,
        commentsCount: post.commentsCount,
        createdAt: post.createdAt,
        timeAgo: getTimeAgo(post.createdAt),
        thresholdMet: post.thresholdMet,
        userDisplayName:
          post.userBusinessName ||
          `${post.userFirstName} ${post.userLastName}`.trim(),
        userProfilePicture: post.userProfilePicture,
      };

      res.json({ post: formattedPost });
    } catch (error) {
      console.error("Error fetching post for quote:", error);
      res.status(500).json({ error: "Failed to fetch post" });
    }
  },

  async deletePost(req, res) {
    try {
      const { postId } = req.params;
      const userId = req.user.id;

      // Validate post ID
      if (!postId || typeof postId !== "string") {
        return res.status(400).json({
          success: false,
          message: "Invalid post ID",
        });
      }

      // Start a transaction
      const result = await db.transaction(async (tx) => {
        // First, get the post to check ownership and creation time
        const post = await tx
          .select({
            id: posts.id,
            userId: posts.userId,
            createdAt: posts.createdAt,
            subject: posts.subject,
            isActive: posts.isActive,
          })
          .from(posts)
          .where(and(eq(posts.id, postId), eq(posts.isActive, true)))
          .limit(1);

        if (!post || post.length === 0) {
          throw new Error("Post not found or already deleted");
        }

        const postData = post[0];

        // Check if user owns the post
        if (postData.userId !== userId) {
          throw new Error("Unauthorized: You can only delete your own posts");
        }

        // Check if post is within 48-hour deletion window
        const now = new Date();
        const postCreatedAt = new Date(postData.createdAt);
        const fortyEightHours = 48 * 60 * 60 * 1000; // 48 hours in milliseconds
        const timePassed = now - postCreatedAt;

        if (timePassed > fortyEightHours) {
          throw new Error("Post deletion window has expired (48 hours)");
        }

        // Delete related records first (foreign key constraints)

        // Delete poll votes
        await tx.delete(pollVotes).where(eq(pollVotes.postId, postId));

        // Delete post interactions (likes, saves)
        await tx
          .delete(postInteractions)
          .where(eq(postInteractions.postId, postId));

        // Delete comments and their interactions
        // First get all comment IDs for this post
        const postComments = await tx
          .select({ id: comments.id })
          .from(comments)
          .where(eq(comments.postId, postId));

        if (postComments.length > 0) {
          const commentIds = postComments.map((comment) => comment.id);

          // Delete comment interactions
          for (const commentId of commentIds) {
            await tx
              .delete(commentInteractions)
              .where(eq(commentInteractions.commentId, commentId));
          }

          // Delete comments
          await tx.delete(comments).where(eq(comments.postId, postId));
        }

        // Finally, delete the post (soft delete by setting isActive to false)
        // Or hard delete if preferred
        const deletedPost = await tx
          .update(posts)
          .set({
            isActive: false,
            updatedAt: new Date(),
          })
          .where(eq(posts.id, postId))
          .returning({
            id: posts.id,
            subject: posts.subject,
          });

        // Alternative: Hard delete (uncomment if preferred)
        // const deletedPost = await tx
        //   .delete(posts)
        //   .where(eq(posts.id, postId))
        //   .returning({
        //     id: posts.id,
        //     subject: posts.subject
        //   });

        return deletedPost[0];
      });

      res.status(200).json({
        success: true,
        message: "Post deleted successfully",
        data: {
          deletedPost: result,
        },
      });
    } catch (error) {
      console.error("Delete post error:", error);

      // Handle specific error messages
      if (error.message.includes("Post not found")) {
        return res.status(404).json({
          success: false,
          message: "Post not found or already deleted",
        });
      }

      if (error.message.includes("Unauthorized")) {
        return res.status(403).json({
          success: false,
          message: "You can only delete your own posts",
        });
      }

      if (error.message.includes("deletion window has expired")) {
        return res.status(400).json({
          success: false,
          message: "Post can only be deleted within 48 hours of creation",
        });
      }

      res.status(500).json({
        success: false,
        message: "Failed to delete post",
        error:
          process.env.NODE_ENV === "development"
            ? error.message
            : "Internal server error",
      });
    }
  },

  async getSavedPosts(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 10 } = req.query;
      const offset = (page - 1) * limit;

      const savedPosts = await db
        .select({
          id: posts.id,
          subject: posts.subject,
          content: posts.content,
          categories: posts.categories,
          type: posts.type,
          pollOptions: posts.pollOptions,
          likes: posts.likes,
          saves: posts.saves,
          createdAt: posts.createdAt,
          userId: posts.userId,
          userFirstName: users.firstName,
          userLastName: users.lastName,
          userBusinessName: users.businessName,
          userProfilePicture: users.profilePicture,
        })
        .from(posts)
        .innerJoin(postInteractions, eq(posts.id, postInteractions.postId))
        .leftJoin(users, eq(posts.userId, users.id))
        .where(
          and(
            eq(postInteractions.userId, userId),
            eq(postInteractions.type, "save"),
            eq(posts.isActive, true)
          )
        )
        .orderBy(desc(postInteractions.createdAt))
        .limit(parseInt(limit))
        .offset(offset);

      const formattedPosts = savedPosts.map((post) => ({
        ...post,
        timeAgo: getTimeAgo(post.createdAt),
        userDisplayName:
          post.userBusinessName ||
          `${post.userFirstName} ${post.userLastName}`.trim(),
        isLiked: false, // Would need separate query to check
        isSaved: true,
      }));

      res.json({
        posts: formattedPosts,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          hasMore: savedPosts.length === parseInt(limit),
        },
      });
    } catch (error) {
      console.error("Error fetching saved posts:", error);
      res.status(500).json({ error: "Failed to fetch saved posts" });
    }
  },

  async openChatroom(req, res) {
    try {
      const { postId } = req.body;
      const userId = req.userData.id; // Use real user ID

      if (!postId) {
        return res.status(400).json({ error: "Post ID is required" });
      }

      // Verify post exists and check threshold
      const [post] = await db
        .select({
          id: posts.id,
          likes: posts.likes,
          thresholdMet: posts.thresholdMet,
          commentsEnabled: posts.commentsEnabled,
          openedBy: posts.openedBy,
          openedByUsername: posts.openedByUsername,
          commentsCount: posts.commentsCount,
        })
        .from(posts)
        .where(and(eq(posts.id, postId), eq(posts.isActive, true)))
        .limit(1);

      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }

      // Get or create chatroom identity
      const chatroomIdentity =
        await chatroomUsernameService.getChatroomUsername(userId, postId);

      // Check if this is the first person to open the chatroom
      let isFirstOpener = false;
      let shouldShowModal = false;

      if (!post.openedBy) {
        isFirstOpener = true;
        shouldShowModal = true;

        // Mark chatroom as opened, but DON'T start timer yet
        await db
          .update(posts)
          .set({
            openedBy: userId,
            openedByUsername: chatroomIdentity.chatroomUsername,
            updatedAt: new Date(),
          })
          .where(eq(posts.id, postId));

        console.log(
          `👤 Chatroom opened for post ${postId} by ${chatroomIdentity.chatroomUsername} (first opener - timer NOT started yet)`
        );
      }

      // Calculate time remaining ONLY if first comment exists
      let timeRemaining = null;
      let timerStarted = false;

      if (post.commentsCount > 0) {
        // Timer has started because there are comments
        const [firstComment] = await db
          .select({ createdAt: comments.createdAt })
          .from(comments)
          .where(and(eq(comments.postId, postId), eq(comments.isActive, true)))
          .orderBy(comments.createdAt)
          .limit(1);

        if (firstComment) {
          const firstCommentTime = new Date(firstComment.createdAt);
          const expiresAt = new Date(
            firstCommentTime.getTime() + 48 * 60 * 60 * 1000
          );
          const now = new Date();

          if (now <= expiresAt) {
            timeRemaining = Math.floor((expiresAt - now) / (1000 * 60)); // minutes
            timerStarted = true;
          } else {
            timeRemaining = 0; // Expired
            timerStarted = true;
          }
        }
      }

      res.status(200).json({
        success: true,
        chatroomInfo: {
          chatroomUsername: chatroomIdentity.chatroomUsername,
          color: chatroomIdentity.color,
          word: chatroomIdentity.word,
          isFirstOpener,
          openedBy: isFirstOpener
            ? chatroomIdentity.chatroomUsername
            : post.openedByUsername,
          hasCommented: chatroomIdentity.hasCommented,
          showModal: shouldShowModal,
          chatroomAlreadyOpen: !isFirstOpener,
          postLikes: post.likes,
          totalComments: post.commentsCount,
          thresholdMet: post.thresholdMet,
          commentsEnabled: post.commentsEnabled,
          // Timer info
          timerStarted: timerStarted,
          timeRemaining: timeRemaining, // null if timer hasn't started, number if started
        },
      });
    } catch (error) {
      console.error("Error opening chatroom:", error);
      res.status(500).json({ error: "Failed to open chatroom" });
    }
  },

  async createComment(req, res) {
    try {
      const {
        postId,
        content,
        parentCommentId = null,
        mentions = [],
      } = req.body;
      const userId = req.user.id;

      if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: "Content is required" });
      }

      // Verify post exists and check if comments are enabled
      const [post] = await db
        .select({
          id: posts.id,
          userId: posts.userId,
          subject: posts.subject,
          commentsEnabled: posts.commentsEnabled,
          commentsEnabledAt: posts.commentsEnabledAt,
          openedBy: posts.openedBy,
          openedByUsername: posts.openedByUsername,
          commentsCount: posts.commentsCount,
        })
        .from(posts)
        .where(and(eq(posts.id, postId), eq(posts.isActive, true)))
        .limit(1);

      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }

      if (!post.commentsEnabled) {
        return res.status(403).json({
          error: "Comments are not enabled for this post",
        });
      }

      // Check if timer has started and expired (only if there are existing comments)
      if (post.commentsCount > 0) {
        const [firstComment] = await db
          .select({ createdAt: comments.createdAt })
          .from(comments)
          .where(and(eq(comments.postId, postId), eq(comments.isActive, true)))
          .orderBy(comments.createdAt)
          .limit(1);

        if (firstComment) {
          const firstCommentTime = new Date(firstComment.createdAt);
          const expiresAt = new Date(
            firstCommentTime.getTime() + 48 * 60 * 60 * 1000
          );
          const now = new Date();

          if (now > expiresAt) {
            return res.status(403).json({
              error:
                "Comment period has expired (48 hours after first comment)",
            });
          }
        }
      }

      // Validate parent comment if replying
      let rootCommentId = null;
      let parentCommentOwner = null;
      if (parentCommentId) {
        const [parentComment] = await db
          .select({
            id: comments.id,
            userId: comments.userId,
            parentCommentId: comments.parentCommentId,
          })
          .from(comments)
          .where(
            and(eq(comments.id, parentCommentId), eq(comments.isActive, true))
          )
          .limit(1);

        if (!parentComment) {
          return res.status(404).json({ error: "Parent comment not found" });
        }

        rootCommentId = parentComment.parentCommentId || parentComment.id;
        parentCommentOwner = parentComment.userId;
      }

      // Get chatroom identity
      const chatroomIdentity =
        await chatroomUsernameService.getChatroomUsername(userId, postId);

      const result = await db.transaction(async (tx) => {
        // Check if this is the FIRST comment (timer starts now!)
        const isFirstComment = post.commentsCount === 0;

        // Create comment
        const [newComment] = await tx
          .insert(comments)
          .values({
            postId,
            userId,
            content: content.trim(),
            parentCommentId,
            mentions: JSON.stringify(mentions),
            chatroomUsername: chatroomIdentity.chatroomUsername,
          })
          .returning();

        // Update post comment count
        const updateData = {
          commentsCount: sql`${posts.commentsCount} + 1`,
          updatedAt: new Date(),
        };

        // If this is the first comment, ensure chatroom opener is set
        // (in case someone commented without opening chatroom first)
        if (isFirstComment && !post.openedBy) {
          updateData.openedBy = userId;
          updateData.openedByUsername = chatroomIdentity.chatroomUsername;
        }

        await tx.update(posts).set(updateData).where(eq(posts.id, postId));

        // Mark user as having commented
        await tx
          .update(chatroomIdentities)
          .set({ hasCommented: true })
          .where(
            and(
              eq(chatroomIdentities.userId, userId),
              eq(chatroomIdentities.postId, postId)
            )
          );

        if (isFirstComment) {
          console.log(
            `🚀 FIRST COMMENT posted on post ${postId} by ${chatroomIdentity.chatroomUsername} - 48-hour timer STARTED!`
          );
        }

        return { newComment, isFirstComment };
      });

      // === NOTIFICATION LOGIC ===

      // 1. Notify post owner about the comment (if commenter is not the post owner)
      if (post.userId !== userId) {
        await NotificationService.notifyPostComment(
          post.userId,
          userId,
          postId,
          content.trim(),
          post.subject
        );
      }

      // 2. If this is a reply, notify the parent comment owner
      if (
        parentCommentId &&
        parentCommentOwner &&
        parentCommentOwner !== userId
      ) {
        await NotificationService.notifyCommentReply(
          parentCommentOwner,
          userId,
          result.newComment.id,
          parentCommentId,
          postId,
          content.trim()
        );
      }

      // Format comment for response
      const formattedComment = {
        id: result.newComment.id,
        content: result.newComment.content,
        parentCommentId: result.newComment.parentCommentId,
        mentions: result.newComment.mentions,
        likes: result.newComment.likes,
        createdAt: result.newComment.createdAt,
        userId: result.newComment.userId,
        chatroomUsername: chatroomIdentity.chatroomUsername,
        userDisplayName: chatroomIdentity.chatroomUsername,
        username: chatroomIdentity.chatroomUsername,
        timeAgo: getTimeAgo(result.newComment.createdAt),
        isLiked: false,
        color: chatroomIdentity.color,
        word: chatroomIdentity.word,
        replies: [],
        rootCommentId,
      };

      // Return timer information
      const responseData = {
        comment: formattedComment,
        chatroomInfo: {
          openedBy: post.openedByUsername || chatroomIdentity.chatroomUsername,
          timerStarted: result.isFirstComment, // TRUE only if this was the first comment
          timeRemaining: result.isFirstComment ? 48 * 60 : null, // 48 hours in minutes, only if timer just started
        },
      };

      res.status(201).json(responseData);
    } catch (error) {
      console.error("Error creating comment:", error);
      res.status(500).json({ error: "Failed to create comment" });
    }
  },

  async getPostStatus(req, res) {
    try {
      const { postId } = req.params;

      const [post] = await db
        .select({
          id: posts.id,
          likes: posts.likes,
          thresholdMet: posts.thresholdMet,
          commentsEnabled: posts.commentsEnabled,
          openedBy: posts.openedBy,
          openedByUsername: posts.openedByUsername,
          commentsCount: posts.commentsCount,
          createdAt: posts.createdAt,
        })
        .from(posts)
        .where(and(eq(posts.id, postId), eq(posts.isActive, true)))
        .limit(1);

      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }

      // Calculate various timers
      const thresholdTimeRemaining = calculateThresholdTimeRemaining(post);
      const chatroomTimeRemaining = await calculateChatroomTimeRemainingAsync(
        postId
      );

      res.json({
        postId: post.id,
        likes: post.likes,
        thresholdMet: post.thresholdMet,
        commentsEnabled: post.commentsEnabled,
        chatroomOpened: !!post.openedBy,
        chatroomTimerStarted: post.commentsCount > 0,
        openedBy: post.openedByUsername,
        commentsCount: post.commentsCount,
        timers: {
          thresholdTimeRemaining:
            thresholdTimeRemaining > 0
              ? Math.floor(thresholdTimeRemaining / (1000 * 60))
              : 0, // minutes
          chatroomTimeRemaining, // minutes or null
        },
      });
    } catch (error) {
      console.error("Error getting post status:", error);
      res.status(500).json({ error: "Failed to get post status" });
    }
  },

  async updateComment(req, res) {
    try {
      const { commentId } = req.params;
      const { content } = req.body;
      const userId = req.user.id;

      // Validate content
      if (!content || content.trim().length === 0) {
        return res.status(400).json({ error: "Content is required" });
      }

      // Check content length limit (250 characters)
      if (content.length > 250) {
        return res.status(400).json({
          error: "Comment is too long",
          message: "Comments must be 250 characters or less",
        });
      }

      // Find the comment and verify ownership
      const [comment] = await db
        .select({
          id: comments.id,
          userId: comments.userId,
          postId: comments.postId,
          content: comments.content,
          isActive: comments.isActive,
          createdAt: comments.createdAt,
        })
        .from(comments)
        .where(and(eq(comments.id, commentId), eq(comments.isActive, true)))
        .limit(1);

      if (!comment) {
        return res.status(404).json({ error: "Comment not found" });
      }

      // Check if user owns the comment
      if (comment.userId !== userId) {
        return res
          .status(403)
          .json({ error: "You can only edit your own comments" });
      }

      // Check if comment is still within edit time window (48 hours)
      const editTimeLimit = 48 * 60 * 60 * 1000; // 48 hours in milliseconds
      const now = new Date();
      const commentAge = now - new Date(comment.createdAt);

      if (commentAge > editTimeLimit) {
        return res.status(403).json({
          error: "Edit time expired",
          message: "Comments can only be edited within 48 hours of posting",
        });
      }

      // Verify the post still exists and comments are still enabled
      const [post] = await db
        .select({
          id: posts.id,
          commentsEnabled: posts.commentsEnabled,
          commentsEnabledAt: posts.commentsEnabledAt,
        })
        .from(posts)
        .where(and(eq(posts.id, comment.postId), eq(posts.isActive, true)))
        .limit(1);

      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }

      if (!post.commentsEnabled) {
        return res
          .status(403)
          .json({ error: "Comments are no longer enabled for this post" });
      }

      // Check if comment period has expired
      // if (post.commentsEnabledAt) {
      //   const enabledAt = new Date(post.commentsEnabledAt);
      //   const expiresAt = new Date(enabledAt.getTime() + 48 * 60 * 60 * 1000); // 48 hours

      //   if (now > expiresAt) {
      //     return res.status(403).json({
      //       error: "Comment period has expired",
      //       message:
      //         "Comments are only available for 48 hours after being enabled",
      //     });
      //   }
      // }

      // Update the comment
      const [updatedComment] = await db
        .update(comments)
        .set({
          content: content.trim(),
          updatedAt: new Date(),
        })
        .where(eq(comments.id, commentId))
        .returning();

      // Get chatroom identity for response formatting
      const chatroomIdentity =
        await chatroomUsernameService.getChatroomUsername(
          userId,
          comment.postId
        );

      // Format comment for response
      const formattedComment = {
        id: updatedComment.id,
        content: updatedComment.content,
        parentCommentId: updatedComment.parentCommentId,
        mentions: updatedComment.mentions,
        likes: updatedComment.likes,
        createdAt: updatedComment.createdAt,
        updatedAt: updatedComment.updatedAt,
        userId: updatedComment.userId,
        chatroomUsername: chatroomIdentity.chatroomUsername,
        userDisplayName: chatroomIdentity.chatroomUsername,
        username: chatroomIdentity.chatroomUsername,
        timeAgo: getTimeAgo(updatedComment.createdAt),
        isLiked: false, // You might want to check this based on user interactions
        color: chatroomIdentity.color,
        word: chatroomIdentity.word,
        isEdited: true,
      };

      res.json({
        message: "Comment updated successfully",
        comment: formattedComment,
      });
    } catch (error) {
      console.error("Error updating comment:", error);
      res.status(500).json({ error: "Failed to update comment" });
    }
  },

  async deleteComment(req, res) {
    try {
      const { commentId } = req.params;
      const userId = req.user.id;

      // Find the comment and verify ownership
      const [comment] = await db
        .select({
          id: comments.id,
          userId: comments.userId,
          postId: comments.postId,
          parentCommentId: comments.parentCommentId,
          isActive: comments.isActive,
          createdAt: comments.createdAt,
        })
        .from(comments)
        .where(and(eq(comments.id, commentId), eq(comments.isActive, true)))
        .limit(1);

      if (!comment) {
        return res.status(404).json({ error: "Comment not found" });
      }

      // Check if user owns the comment
      if (comment.userId !== userId) {
        return res
          .status(403)
          .json({ error: "You can only delete your own comments" });
      }

      // Check if comment is still within delete time window (48 hours)
      const deleteTimeLimit = 48 * 60 * 60 * 1000; // 48 hours in milliseconds
      const now = new Date();
      const commentAge = now - new Date(comment.createdAt);

      if (commentAge > deleteTimeLimit) {
        return res.status(403).json({
          error: "Delete time expired",
          message: "Comments can only be deleted within 48 hours of posting",
        });
      }

      // Check if comment has replies
      const [hasReplies] = await db
        .select({ count: sql`count(*)` })
        .from(comments)
        .where(
          and(
            eq(comments.parentCommentId, commentId),
            eq(comments.isActive, true)
          )
        );

      const replyCount = parseInt(hasReplies.count);

      await db.transaction(async (tx) => {
        await tx
          .update(comments)
          .set({
            isActive: false,
            updatedAt: new Date(),
          })
          .where(eq(comments.id, commentId));

        await tx
          .delete(commentInteractions)
          .where(eq(commentInteractions.commentId, commentId));

        // Update post comments count
        await tx
          .update(posts)
          .set({
            commentsCount: sql`${posts.commentsCount} - 1`,
          })
          .where(eq(posts.id, comment.postId));
      });

      res.json({
        message: "Comment deleted successfully",
        deletedCommentId: commentId,
        hadReplies: replyCount > 0,
      });
    } catch (error) {
      console.error("Error deleting comment:", error);
      res.status(500).json({ error: "Failed to delete comment" });
    }
  },

  async getPublicPostComments(req, res) {
    try {
      const { postId } = req.params;
      const { page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      // Get ALL comments for this post (both top-level and replies)
      // Update the query to exclude deleted/inactive comments:
      const allComments = await db
        .select({
          id: comments.id,
          content: comments.content,
          parentCommentId: comments.parentCommentId,
          mentions: comments.mentions,
          likes: comments.likes,
          createdAt: comments.createdAt,
          userId: comments.userId,
          chatroomUsername: comments.chatroomUsername,
          identityId: chatroomIdentities.id,
          color: chatroomIdentities.color,
          word: chatroomIdentities.word,
        })
        .from(comments)
        .leftJoin(
          chatroomIdentities,
          and(
            eq(chatroomIdentities.userId, comments.userId),
            eq(chatroomIdentities.postId, comments.postId)
          )
        )
        .where(
          and(
            eq(comments.postId, postId),
            eq(comments.isActive, true),
            ne(comments.content, "[deleted]") // Exclude deleted content
          )
        )
        .orderBy(comments.createdAt);

      // Get top-level comments only for pagination
      const topLevelComments = allComments
        .filter((comment) => comment.parentCommentId === null)
        .slice(offset, offset + parseInt(limit));

      if (topLevelComments.length === 0) {
        return res.json({
          comments: [],
          pagination: { page: 1, totalPages: 0, total: 0 },
        });
      }

      // Helper function to build nested comment tree
      const buildCommentTree = (parentId = null) => {
        return allComments
          .filter((comment) => comment.parentCommentId === parentId)
          .map((comment) => ({
            ...comment,
            timeAgo: getTimeAgo(comment.createdAt),
            userDisplayName: comment.chatroomUsername || "Anonymous",
            username: comment.chatroomUsername || "Anonymous",
            isLiked: false, // No user interactions for public view
            replies: buildCommentTree(comment.id), // Recursively build nested replies
          }));
      };

      // Build the nested structure for top-level comments only
      const formattedComments = topLevelComments.map((comment) => ({
        ...comment,
        timeAgo: getTimeAgo(comment.createdAt),
        userDisplayName: comment.chatroomUsername || "Anonymous",
        username: comment.chatroomUsername || "Anonymous",
        isLiked: false, // No user interactions for public view
        replies: buildCommentTree(comment.id),
      }));

      res.json({
        comments: formattedComments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          hasMore: topLevelComments.length === parseInt(limit),
        },
      });
    } catch (error) {
      console.error("Error fetching public comments:", error);
      res.status(500).json({ error: "Failed to fetch comments" });
    }
  },

  async getPostComments(req, res) {
    try {
      const { postId } = req.params;
      const { page = 1, limit = 20 } = req.query;
      const userId = req.user.id;
      const offset = (page - 1) * limit;

      // Get ALL comments for this post (both top-level and replies)
      // Update the query to exclude deleted/inactive comments:
      const allComments = await db
        .select({
          id: comments.id,
          content: comments.content,
          parentCommentId: comments.parentCommentId,
          mentions: comments.mentions,
          likes: comments.likes,
          createdAt: comments.createdAt,
          userId: comments.userId,
          chatroomUsername: comments.chatroomUsername,
          identityId: chatroomIdentities.id,
          color: chatroomIdentities.color,
          word: chatroomIdentities.word,
        })
        .from(comments)
        .leftJoin(
          chatroomIdentities,
          and(
            eq(chatroomIdentities.userId, comments.userId),
            eq(chatroomIdentities.postId, comments.postId)
          )
        )
        .where(
          and(
            eq(comments.postId, postId),
            eq(comments.isActive, true),
            ne(comments.content, "[deleted]") // Exclude deleted content
          )
        )
        .orderBy(comments.createdAt); // This orders oldest first (ascending)

      // Get top-level comments only for pagination
      const topLevelComments = allComments
        .filter((comment) => comment.parentCommentId === null)
        .slice(offset, offset + parseInt(limit));

      if (topLevelComments.length === 0) {
        return res.json({
          comments: [],
          pagination: { page: 1, totalPages: 0, total: 0 },
        });
      }

      // Get all comment IDs for user interactions
      const allCommentIds = allComments.map((comment) => comment.id);

      // Get user's interactions for ALL comments
      const userInteractions = await db
        .select()
        .from(commentInteractions)
        .where(
          and(
            eq(commentInteractions.userId, userId),
            inArray(commentInteractions.commentId, allCommentIds)
          )
        );

      // Map interactions
      const interactionMap = {};
      userInteractions.forEach((interaction) => {
        interactionMap[interaction.commentId] = {
          ...interactionMap[interaction.commentId],
          [interaction.type]: true,
        };
      });

      // Helper function to build nested comment tree
      const buildCommentTree = (parentId = null) => {
        return allComments
          .filter((comment) => comment.parentCommentId === parentId)
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)) // Sort replies oldest first too
          .map((comment) => ({
            ...comment,
            timeAgo: getTimeAgo(comment.createdAt),
            userDisplayName: comment.chatroomUsername || "Anonymous",
            username: comment.chatroomUsername || "Anonymous",
            isLiked: interactionMap[comment.id]?.like || false,
            replies: buildCommentTree(comment.id), // Recursively build nested replies
          }));
      };

      // Build the nested structure for top-level comments only
      const formattedComments = topLevelComments.map((comment) => ({
        ...comment,
        timeAgo: getTimeAgo(comment.createdAt),
        userDisplayName: comment.chatroomUsername || "Anonymous",
        username: comment.chatroomUsername || "Anonymous",
        isLiked: interactionMap[comment.id]?.like || false,
        replies: buildCommentTree(comment.id),
      }));

      res.json({
        comments: formattedComments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          hasMore: topLevelComments.length === parseInt(limit),
        },
      });
    } catch (error) {
      console.error("Error fetching comments:", error);
      res.status(500).json({ error: "Failed to fetch comments" });
    }
  },

  async getPostCommentCount(req, res) {
    try {
      const { postId } = req.params;

      // Count total comments for this post (excluding deleted/inactive comments)
      const commentCount = await db
        .select({ count: sql`count(*)` })
        .from(comments)
        .where(
          and(
            eq(comments.postId, postId),
            eq(comments.isActive, true),
            ne(comments.content, "[deleted]") // Exclude deleted content
          )
        );

      const totalComments = parseInt(commentCount[0].count) || 0;

      res.json({
        postId,
        commentCount: totalComments,
        hasComments: totalComments > 0,
      });
    } catch (error) {
      console.error("Error fetching comment count:", error);
      res.status(500).json({ error: "Failed to fetch comment count" });
    }
  },

  async toggleCommentLike(req, res) {
    try {
      const { commentId } = req.params;
      const userId = req.user.id;

      // Get comment details first
      const [comment] = await db
        .select({
          id: comments.id,
          userId: comments.userId,
          postId: comments.postId,
          content: comments.content,
        })
        .from(comments)
        .where(eq(comments.id, commentId))
        .limit(1);

      if (!comment) {
        return res.status(404).json({ error: "Comment not found" });
      }

      // Check if already liked
      const existing = await db
        .select()
        .from(commentInteractions)
        .where(
          and(
            eq(commentInteractions.userId, userId),
            eq(commentInteractions.commentId, commentId),
            eq(commentInteractions.type, "like")
          )
        )
        .limit(1);

      if (existing.length > 0) {
        // Unlike
        await db
          .delete(commentInteractions)
          .where(eq(commentInteractions.id, existing[0].id));

        await db
          .update(comments)
          .set({ likes: sql`${comments.likes} - 1` })
          .where(eq(comments.id, commentId));

        res.json({ liked: false, message: "Comment unliked" });
      } else {
        // Like
        await db.insert(commentInteractions).values({
          userId,
          commentId,
          type: "like",
        });

        await db
          .update(comments)
          .set({ likes: sql`${comments.likes} + 1` })
          .where(eq(comments.id, commentId));

        // === NOTIFICATION LOGIC ===
        // Notify comment owner about the like (if liker is not the comment owner)
        if (comment.userId !== userId) {
          await NotificationService.notifyCommentLike(
            comment.userId,
            userId,
            commentId,
            comment.postId
          );
        }

        res.json({ liked: true, message: "Comment liked" });
      }
    } catch (error) {
      console.error("Error toggling comment like:", error);
      res.status(500).json({ error: "Failed to toggle like" });
    }
  },

  async searchChatroomUsers(req, res) {
    try {
      const { postId, query } = req.query;

      if (!postId) {
        return res.status(400).json({ error: "Post ID is required" });
      }

      const users = await chatroomUsernameService.searchChatroomUsernames(
        postId,
        query
      );
      res.json({ users });
    } catch (error) {
      console.error("Error searching chatroom users:", error);
      res.status(500).json({ error: "Failed to search users" });
    }
  },

  async getChatroomUsername(req, res) {
    try {
      const { postId } = req.query;
      const userId = req.user.id;

      console.log(postId, userId);

      const identity = await chatroomUsernameService.getChatroomUsername(
        userId,
        postId
      );

      res.json({
        chatroomUsername: identity.chatroomUsername,
        color: identity.color,
        word: identity.word,
      });
    } catch (error) {
      console.error("Error getting chatroom username:", error);
      res.status(500).json({ error: "Failed to get chatroom username" });
    }
  },
};

module.exports = PostController;
