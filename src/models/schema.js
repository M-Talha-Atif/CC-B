const {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  decimal,
  integer,
  json,
  nullable,
} = require("drizzle-orm/pg-core");

const { sql } = require("drizzle-orm");
const { uniqueIndex } = require("drizzle-orm/pg-core");
const { index } = require("drizzle-orm/pg-core");

const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: text("password"),
  userType: varchar("user_type", { length: 50 }).notNull().default("creative"),
  firstName: varchar("first_name", { length: 255 }),
  lastName: varchar("last_name", { length: 255 }),
  profilePicture: text("profile_picture"),
  googleAuth: boolean("google_auth").default(false),
  lastLoginAt: timestamp("last_login_at"),
  

  // post relevant meta-data
  likedPostsCount: integer("liked_posts_count").default(0),

  // Profile information
  businessName: varchar("business_name", { length: 255 }),
  website: text("website"),
  instagram: varchar("instagram", { length: 255 }),
  creativeDomains: json("creative_domains"),
  phone: varchar("phone", { length: 20 }),

  // Verification status
  emailVerified: boolean("email_verified").default(false),
  phoneVerified: boolean("phone_verified").default(false),

  // Profile completion
  profileCompleted: boolean("profile_completed").default(false),

  // USER APPROVAL STATUS - NEW FIELD
  status: varchar("status", { length: 20 }).notNull().default("pending"), // pending, approved, rejected

  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),

  // Referral system
  personalReferralCode: varchar("personal_referral_code", {
    length: 50,
  }).unique(),
  referredBy: uuid("referred_by").references(() => users.id),
  assignedReferralCode: varchar("assigned_referral_code", { length: 50 }),

  // Points system
  points: decimal("points", { precision: 10, scale: 2 }).default("0.00"),

  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),

  isAnonymous: boolean("is_anonymous").default(false),
  encryptedData: text("encrypted_data"),
  anonymousId: varchar("anonymous_id", { length: 100 }).unique(),
  anonymousActivatedAt: timestamp("anonymous_activated_at"),
  originalDataBackup: text("original_data_backup"),
});

const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  type: varchar("type", { length: 50 }).notNull(), // 'post_like', 'post_comment', 'comment_like', 'comment_reply'
  actorId: uuid("actor_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(), // Who triggered the notification
  postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
  commentId: uuid("comment_id").references(() => comments.id, {
    onDelete: "cascade",
  }),
  parentCommentId: uuid("parent_comment_id").references(() => comments.id, {
    onDelete: "cascade",
  }),

  // Notification content
  message: text("message").notNull(),
  metadata: json("metadata").default({}), // Extra data like post content preview, etc.

  // Status
  isRead: boolean("is_read").default(false),
  readAt: timestamp("read_at"),

  createdAt: timestamp("created_at").defaultNow(),
});

const onboardingProgress = pgTable("onboarding_progress", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull()
    .unique(), // One progress record per user

  // Current step tracking
  currentStep: varchar("current_step", { length: 50 })
    .notNull()
    .default("landing"),
  completedSteps: json("completed_steps").default([]), // Array of completed step names

  // Form data for each step (stored as JSON for flexibility)
  formData: json("form_data").default({}),

  // Individual step completion flags for quick queries
  emailPasswordCompleted: boolean("email_password_completed").default(false),
  referralCodeCompleted: boolean("referral_code_completed").default(false),
  businessNameCompleted: boolean("business_name_completed").default(false),
  websiteCompleted: boolean("website_completed").default(false),
  instagramCompleted: boolean("instagram_completed").default(false),
  creativeDomainCompleted: boolean("creative_domain_completed").default(false),
  phoneNumberCompleted: boolean("phone_number_completed").default(false),
  otpVerificationCompleted: boolean("otp_verification_completed").default(
    false
  ),

  // Onboarding completion
  onboardingCompleted: boolean("onboarding_completed").default(false),
  completedAt: timestamp("completed_at"),

  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Enhanced admin referral codes table
const adminReferralCodes = pgTable("admin_referral_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  assignedToUserId: uuid("assigned_to_user_id").references(() => users.id),
  createdByAdminId: uuid("created_by_admin_id")
    .references(() => users.id)
    .notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true),
  expiresAt: timestamp("expires_at"),

  // Assignment tracking
  assignedAt: timestamp("assigned_at"), // When was it assigned
  previousAssignedTo: uuid("previous_assigned_to").references(() => users.id), // Track reassignments

  // Usage limits
  maxUsages: integer("max_usages"), // Optional usage limit
  currentUsages: integer("current_usages").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

const referralUsage = pgTable("referral_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  referralCode: varchar("referral_code", { length: 50 }).notNull(),
  codeType: varchar("code_type", { length: 20 }).notNull(), // 'admin' or 'user'
  usedByUserId: uuid("used_by_user_id")
    .references(() => users.id)
    .notNull(),
  codeOwnerId: uuid("code_owner_id").references(() => users.id),
  adminCreatorId: uuid("admin_creator_id").references(() => users.id),

  // Points distributed
  pointsToUser: decimal("points_to_user", { precision: 10, scale: 2 }).default(
    "0.00"
  ),
  pointsToCodeOwner: decimal("points_to_code_owner", {
    precision: 10,
    scale: 2,
  }).default("0.00"),
  pointsToAdmin: decimal("points_to_admin", {
    precision: 10,
    scale: 2,
  }).default("0.00"),

  status: varchar("status", { length: 20 }).default("pending"),
  rejectionReason: text("rejection_reason"),
  referralLevel: integer("referral_level").default(1),

  usedAt: timestamp("used_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Enhanced points transactions
const pointsTransactions = pgTable("points_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  type: varchar("type", { length: 50 }).notNull(),

  // Balance tracking
  previousBalance: decimal("previous_balance", { precision: 10, scale: 2 }),
  newBalance: decimal("new_balance", { precision: 10, scale: 2 }),

  createdAt: timestamp("created_at").defaultNow(),
});

// Audit log for referral code assignments/unassignments
const referralCodeAuditLog = pgTable("referral_code_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  referralCodeId: uuid("referral_code_id")
    .references(() => adminReferralCodes.id)
    .notNull(),
  action: varchar("action", { length: 50 }).notNull(), // 'assigned', 'unassigned', 'created', 'deactivated'
  performedByUserId: uuid("performed_by_user_id")
    .references(() => users.id)
    .notNull(),
  affectedUserId: uuid("affected_user_id").references(() => users.id), // User who was assigned/unassigned

  // Details
  previousState: json("previous_state"), // Store previous state for rollback
  newState: json("new_state"), // Store new state
  pointsAffected: decimal("points_affected", {
    precision: 10,
    scale: 2,
  }).default("0.00"),

  reason: text("reason"), // Optional reason for the action
  metadata: json("metadata"), // Additional metadata

  createdAt: timestamp("created_at").defaultNow(),
});

// OTP codes (unchanged)
const otpCodes = pgTable("otp_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  phone: varchar("phone", { length: 20 }).notNull(),
  code: varchar("code", { length: 6 }).notNull(),
  userId: uuid("user_id").references(() => users.id),
  isUsed: boolean("is_used").default(false),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  usedAt: timestamp("used_at"),
});

const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  isUsed: boolean("is_used").default(false),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  content: text("content").notNull(),
  categories: json("categories").notNull(),
  type: varchar("type", { length: 20 }).default("text"),
  pollOptions: json("poll_options"),
  likes: integer("likes").default(0),
  saves: integer("saves").default(0),
  commentsCount: integer("commentsCount").default(0),
  quotesCount: integer("quotes_count").default(0),
  isActive: boolean("is_active").default(true),
  latestReportAt: timestamp("latest_report_at"),

  // reported times
  reportCount: integer("report_count").default(0),

  // NEW FIELDS FOR CRON JOB FUNCTIONALITY
  commentsEnabled: boolean("comments_enabled").default(false), // Whether comments are enabled
  commentsEnabledAt: timestamp("comments_enabled_at"), // When comments were enabled
  commentsDisabledAt: timestamp("comments_disabled_at"), // When comments were disabled
  eligibleForDeletion: boolean("eligible_for_deletion").default(true), // Whether post can be deleted by cron
  cronProcessed: boolean("cron_processed").default(false), // Whether cron has processed this post

  // NEW FIELD FOR THRESHOLD TRACKING
  thresholdMetAt: timestamp("threshold_met_at"), // When post met its threshold requirement
  thresholdMet: boolean("threshold_met").default(false), // Whether threshold has been met

  // NEW FIELD FOR AUTHOR-ONLY VISIBILITY
  visibleToAuthorOnly: boolean("visible_to_author_only").default(false), // Whether post is only visible to author

  openedBy: uuid("opened_by").references(() => users.id), // Who first opened/commented in chatroom
  openedByUsername: varchar("opened_by_username", { length: 100 }), // Their chatroom username

  isQuotePost: boolean("is_quote_post").default(false),
  quotedPostId: uuid("quoted_post_id").references(() => posts.id, {
    onDelete: "set null",
  }),
  quotedPostSnapshot: json("quoted_post_snapshot"), // Store snapshot of quoted post data

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

const postRateLimits = pgTable(
  "post_rate_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),

    // Hourly tracking
    hourKey: varchar("hour_key", { length: 50 }).notNull(), // Format: userId_YYYY-MM-DD-HH
    postCount: integer("post_count").default(0).notNull(),

    // Reset time
    hourStartTime: timestamp("hour_start_time").notNull(),
    hourEndTime: timestamp("hour_end_time").notNull(),

    // Timestamps
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    // Composite unique constraint: one record per user per hour
    uniqueUserHour: uniqueIndex("unique_user_hour").on(
      table.userId,
      table.hourKey
    ),
    // Index for cleanup queries
    hourEndTimeIdx: index("hour_end_time_idx").on(table.hourEndTime),
  })
);

// Post interactions table
const postInteractions = pgTable("post_interactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  postId: uuid("post_id")
    .references(() => posts.id)
    .notNull(),
  type: varchar("type", { length: 20 }).notNull(), // 'like' or 'save'
  createdAt: timestamp("created_at").defaultNow(),
});

// Poll votes table
const pollVotes = pgTable("poll_votes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id)
    .notNull(),
  postId: uuid("post_id")
    .references(() => posts.id)
    .notNull(),
  optionIndex: integer("option_index").notNull(),
  voteTimestamp: timestamp("vote_timestamp").defaultNow(), // ADD THIS LINE

  createdAt: timestamp("created_at").defaultNow(),
});

const chatroomIdentities = pgTable("chatroom_identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  postId: uuid("post_id")
    .references(() => posts.id, { onDelete: "cascade" })
    .notNull(),
  chatroomUsername: varchar("chatroom_username", { length: 100 }).notNull(),
  color: varchar("color", { length: 50 }).notNull(),
  word: varchar("word", { length: 50 }).notNull(),
  hasCommented: boolean("has_commented").default(false), // Track if user has commented
  createdAt: timestamp("created_at").defaultNow(),
});

// Update the existing comments table to include chatroom_username
const comments = pgTable("comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id")
    .references(() => posts.id, { onDelete: "cascade" })
    .notNull(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  content: text("content").notNull(),
  reportCount: integer("report_count").default(0),
  latestReportAt: timestamp("latest_report_at"),

  // Reply functionality
  parentCommentId: uuid("parent_comment_id").references(() => comments.id, {
    onDelete: "cascade",
  }),

  // Interaction counts
  likes: integer("likes").default(0),

  // User mentions (stored as JSON array of user IDs)
  mentions: json("mentions").default([]),

  // Chatroom username used when posting this comment
  chatroomUsername: varchar("chatroom_username", { length: 100 }),

  // Status
  isActive: boolean("is_active").default(true),

  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Comment interactions table
const commentInteractions = pgTable("comment_interactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  commentId: uuid("comment_id")
    .references(() => comments.id, { onDelete: "cascade" })
    .notNull(),
  type: varchar("type", { length: 20 }).notNull(), // 'like'
  createdAt: timestamp("created_at").defaultNow(),
});

const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  isUsed: boolean("is_used").default(false),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

const creativeInquiries = pgTable("creative_inquiries", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),

  // Creative selection data
  creativeDomain: varchar("creative_domain", { length: 50 }).notNull(),
  selectedService: text("selected_service").notNull(),
  proposalCount: integer("proposal_count").notNull(),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),

  // Wedding details from chat
  location: text("location").notNull(),
  weddingDate: varchar("wedding_date", { length: 20 }).notNull(),
  budget: varchar("budget", { length: 50 }).notNull(),
  guestCount: integer("guest_count").notNull(),

  // Chat conversation data
  chatMessages: json("chat_messages").notNull(),

  // Payment integration
  stripeSessionId: varchar("stripe_session_id", { length: 255 }),
  stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),

  // ADD THIS NEW FIELD FOR STRIPE CUSTOMER SUPPORT
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),

  paymentStatus: varchar("payment_status", { length: 20 }).default("pending"),
  paidAt: timestamp("paid_at"),

  // Status tracking
  status: varchar("status", { length: 20 }).default("draft"),
  processedAt: timestamp("processed_at"),

  // Matching/proposal tracking
  proposalsSent: integer("proposals_sent").default(0),
  proposalsMatched: integer("proposals_matched").default(0),

  // Metadata
  metadata: json("metadata").default({}),

  // Timestamps
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Creative proposals/matches table
const creativeProposals = pgTable("creative_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  inquiryId: uuid("inquiry_id")
    .references(() => creativeInquiries.id, { onDelete: "cascade" })
    .notNull(),
  creativeUserId: uuid("creative_user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),

  // Proposal details
  proposalMessage: text("proposal_message"),
  proposalAmount: decimal("proposal_amount", { precision: 10, scale: 2 }),
  availability: json("availability").default({}), // Store availability info

  // Status
  status: varchar("status", { length: 20 }).default("sent"), // sent, viewed, accepted, rejected
  viewedAt: timestamp("viewed_at"),
  respondedAt: timestamp("responded_at"),

  // Communication
  lastContactedAt: timestamp("last_contacted_at"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

const reportedPosts = pgTable("reported_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id")
    .references(() => posts.id, { onDelete: "cascade" })
    .notNull(),
  reportedBy: uuid("reported_by")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),

  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  // Composite unique index: one report per user per post
  uniqueUserPost: uniqueIndex("unique_user_post_report").on(
    table.reportedBy,
    table.postId
  ),
  // Index for quick lookups
  postIdIdx: index("report_post_id_idx").on(table.postId),
  // ADD THIS NEW INDEX for sorting by latest report
  latestReportIdx: index("latest_report_idx").on(table.postId, table.createdAt),
}));

const reportedComments = pgTable("reported_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  commentId: uuid("comment_id")
    .references(() => comments.id, { onDelete: "cascade" })
    .notNull(),
  reportedBy: uuid("reported_by")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  // Composite unique index: one report per user per comment
  uniqueUserComment: uniqueIndex("unique_user_comment_report").on(
    table.reportedBy,
    table.commentId
  ),
  // Index for quick lookups
  commentIdIdx: index("report_comment_id_idx").on(table.commentId),
}));


module.exports = {
  users,
  notifications,
  adminReferralCodes,
  referralUsage,
  pointsTransactions,
  referralCodeAuditLog,
  otpCodes,
  emailVerificationTokens,
  posts,
  postRateLimits,
  postInteractions,
  pollVotes,
  onboardingProgress,
  comments,
  commentInteractions,
  sql,
  passwordResetTokens,
  chatroomIdentities,
  creativeInquiries,
  creativeProposals,
  reportedPosts,
  reportedComments
};
