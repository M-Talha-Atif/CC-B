const { eq, inArray, or, and, sql } = require("drizzle-orm");
const { db } = require("../config/database");
const {
  users,
  adminReferralCodes,
  referralUsage,
  pointsTransactions,
  referralCodeAuditLog,
  otpCodes,
  emailVerificationTokens,
  posts,
  postInteractions,
  pollVotes,
  onboardingProgress,
  comments,
  commentInteractions,
  passwordResetTokens,
  chatroomIdentities,
  creativeInquiries,
  creativeProposals,
} = require("../models/schema");
const adminService = require("../services/adminService");
const emailService = require("../services/emailService");

const AdminController = {
  async createReferralCode(req, res) {
    try {
      const { code, description, expiresAt, assignedToUserId } = req.body;
      const adminId = req.user.id;

      // Convert assignedToUserId to proper type
      const userId =
        assignedToUserId && assignedToUserId !== "admin"
          ? assignedToUserId
          : null;

      const referralCode = await adminService.createReferralCode({
        code,
        description,
        expiresAt,
        createdByAdminId: adminId,
        assignedToUserId: userId,
      });

      res.status(201).json({
        success: true,
        message: "Referral code created successfully",
        data: referralCode,
      });
    } catch (error) {
      console.error("Create referral code error:", error);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },
  async getReferralCodes(req, res) {
    try {
      const {
        page = 1,
        limit = 10,
        isActive,
        assignedStatus,
        search,
      } = req.query;

      const result = await adminService.getReferralCodes({
        page: parseInt(page),
        limit: parseInt(limit),
        isActive: isActive !== undefined ? isActive === "true" : undefined,
        assignedStatus,
        search: search && search.trim() ? search.trim() : undefined,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("Error fetching referral codes:", error);
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  async getReferralCodeById(req, res) {
    try {
      const { id } = req.params;
      const referralCode = await adminService.getReferralCodeById(id);

      res.status(200).json({
        success: true,
        data: referralCode,
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  },

  async updateReferralCode(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      const referralCode = await adminService.updateReferralCode(id, updates);

      res.status(200).json({
        success: true,
        message: "Referral code updated successfully",
        data: referralCode,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  async deleteReferralCode(req, res) {
    try {
      const { id } = req.params;
      await adminService.deleteReferralCode(id);

      res.status(200).json({
        success: true,
        message: "Referral code deleted successfully",
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  async assignReferralCode(req, res) {
    try {
      const { id } = req.params;
      const { userId } = req.body;

      // Validation
      if (!id || !userId) {
        return res.status(400).json({
          success: false,
          message: "Referral code ID and user ID are required",
        });
      }

      // Validate UUID format (optional but recommended)
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id) || !uuidRegex.test(userId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid ID format",
        });
      }

      // Get admin user ID from auth middleware (assuming you have this)
      const adminUserId = req.user?.id;

      const result = await adminService.assignReferralCode(
        id,
        userId,
        adminUserId
      );

      res.status(200).json({
        success: true,
        message: "Referral code assigned successfully",
        data: {
          referralCode: result.referralCode,
          assignedUser: {
            id: result.user.id,
            email: result.user.email,
            firstName: result.user.firstName,
            lastName: result.user.lastName,
          },
          bonusPointsAdded: result.bonusPointsAdded,
        },
      });
    } catch (error) {
      console.error("Error in assignReferralCode controller:", error);

      // Handle specific error types
      if (error.message.includes("not found")) {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      if (error.message.includes("already")) {
        return res.status(409).json({
          success: false,
          message: error.message,
        });
      }

      if (
        error.message.includes("expired") ||
        error.message.includes("inactive")
      ) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message: "Internal server error occurred while assigning referral code",
      });
    }
  },

  async unassignReferralCode(req, res) {
    try {
      const { id } = req.params;

      // Validation
      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Referral code ID is required",
        });
      }

      // Validate UUID format
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid referral code ID format",
        });
      }

      // Get admin user ID from auth middleware
      const adminUserId = req.user?.id;

      const result = await adminService.unassignReferralCode(id, adminUserId);

      res.status(200).json({
        success: true,
        message: "Referral code unassigned successfully",
        data: {
          referralCode: result.referralCode,
          affectedUser: result.user,
          pointsDeducted: result.pointsDeducted,
          affectedReferrals: result.affectedReferrals,
        },
      });
    } catch (error) {
      console.error("Error in unassignReferralCode controller:", error);

      // Handle specific error types
      if (error.message.includes("not found")) {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      if (error.message.includes("not assigned")) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message:
          "Internal server error occurred while unassigning referral code",
      });
    }
  },

  // Additional helper endpoint to get referral code details
  async getReferralCodeDetails(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Referral code ID is required",
        });
      }

      const result = await adminService.getReferralCodeDetails(id);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("Error in getReferralCodeDetails controller:", error);

      if (error.message.includes("not found")) {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      res.status(500).json({
        success: false,
        message:
          "Internal server error occurred while fetching referral code details",
      });
    }
  },

  // Analytics and Reporting
  async getReferralAnalytics(req, res) {
    try {
      const { startDate, endDate, adminId } = req.query;

      const analytics = await adminService.getReferralAnalytics({
        startDate,
        endDate,
        adminId,
      });

      res.status(200).json({
        success: true,
        data: analytics,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  async getReferralUsage(req, res) {
    try {
      const { page = 1, limit = 10, referralCode, userId } = req.query;

      const result = await adminService.getReferralUsage({
        page: parseInt(page),
        limit: parseInt(limit),
        referralCode,
        userId,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  async getPointsLeaderboard(req, res) {
    try {
      const { limit = 50, userType } = req.query;

      const leaderboard = await adminService.getPointsLeaderboard({
        limit: parseInt(limit),
        userType,
      });

      res.status(200).json({
        success: true,
        data: leaderboard,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  async getUserReferralStats(req, res) {
    try {
      const { userId } = req.params;
      const stats = await adminService.getUserReferralStats(userId);

      res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  // User Management
  async getUsers(req, res) {
    try {
      const { page = 1, limit = 10, userType, search } = req.query;

      const result = await adminService.getUsers({
        page: parseInt(page),
        limit: parseInt(limit),
        userType,
        search,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  async getUserById(req, res) {
    try {
      const { id } = req.params;
      const user = await adminService.getUserById(id);

      res.status(200).json({
        success: true,
        data: user,
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  },

  async updateUserPoints(req, res) {
    try {
      const { id } = req.params;
      const { amount, type, description } = req.body;
      const adminId = req.user.id;

      const result = await adminService.updateUserPoints(id, {
        amount,
        type,
        description,
        adminId,
      });

      res.status(200).json({
        success: true,
        message: "User points updated successfully",
        data: result,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  async getUserPointsHistory(req, res) {
    try {
      const { id } = req.params;
      const { page = 1, limit = 10 } = req.query;

      const result = await adminService.getUserPointsHistory(id, {
        page: parseInt(page),
        limit: parseInt(limit),
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  // Bulk Operations
  async bulkCreateReferralCodes(req, res) {
    try {
      const { codes } = req.body; // Array of code objects
      const adminId = req.user.id;

      const result = await adminService.bulkCreateReferralCodes(codes, adminId);

      res.status(201).json({
        success: true,
        message: `${result.created} referral codes created successfully`,
        data: result,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  async bulkAssignReferralCodes(req, res) {
    try {
      const { assignments } = req.body; // Array of { codeId, userId }

      const result = await adminService.bulkAssignReferralCodes(assignments);

      res.status(200).json({
        success: true,
        message: `${result.assigned} referral codes assigned successfully`,
        data: result,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  async getPendingUsers(req, res) {
    try {

       const { page = 1, limit = 10, search = "" } = req.query;
       
      const pendingUsers = await adminService.getPendingUsers({
        page: parseInt(page),
        limit: parseInt(limit),
        search: search.trim(),
      });

      res.status(200).json({
        success: true,
        message: "Pending users fetched successfully",
        data: {
          users: pendingUsers,
          count: pendingUsers.length,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },

  async getApprovedUsers(req, res) {
    try {
      const { page = 1, limit = 10, search = "" } = req.query;

      const approvedUsers = await adminService.getApprovedUsers({
        page: parseInt(page),
        limit: parseInt(limit),
        search: search.trim(),
      });

      res.status(200).json({
        success: true,
        message: "Approved users fetched successfully",
        data: approvedUsers,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },

  async getRejectedUsers(req, res) {
    try {
      const { page = 1, limit = 10, search = "", status = "all" } = req.query;

      // Validate status parameter
      const validStatuses = ["all", "rejected", "referral_rejected"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(
            ", "
          )}`,
        });
      }

      const rejectedUsers = await adminService.getRejectedUsers({
        page: parseInt(page),
        limit: parseInt(limit),
        search: search.trim(),
        status,
      });

      res.status(200).json({
        success: true,
        message: "Rejected users fetched successfully",
        data: rejectedUsers,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },

  async getUserReferralUsage(req, res) {
    try {
      const { userId } = req.params;
      const { page = 1, limit = 50 } = req.query;

      const usageData = await adminService.getUserReferralUsage({
        userId,
        page: parseInt(page),
        limit: parseInt(limit),
      });

      res.status(200).json({
        success: true,
        message: "Referral usage fetched successfully",
        data: usageData,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },

  async getAllUsersWithStatus(req, res) {
    try {
      const users = await adminService.getAllUsersWithStatus();

      res.status(200).json({
        success: true,
        message: "Users fetched successfully",
        data: {
          users,
          count: users.length,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },

  async approveUser(req, res) {
    try {
      const { userId } = req.params;

      // Get pending referral usage for this user
      const [pendingReferral] = await db
        .select()
        .from(referralUsage)
        .where(
          and(
            eq(referralUsage.usedByUserId, userId),
            eq(referralUsage.status, "pending")
          )
        )
        .limit(1);

      if (pendingReferral) {
        // Check current ACTIVE usage count for this code
        const activeUsageCount = await db
          .select({ count: sql`count(*)` })
          .from(referralUsage)
          .where(
            and(
              eq(referralUsage.referralCode, pendingReferral.referralCode),
              eq(referralUsage.codeType, pendingReferral.codeType),
              eq(referralUsage.status, "active")
            )
          );

        const currentCount = Number(activeUsageCount[0].count);
        const REFERRAL_LIMIT = 7;

        if (pendingReferral.codeType === "user" && currentCount >= REFERRAL_LIMIT) {
          // Get user info before rejection
          const [user] = await db
            .select()
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

          // Mark referral as rejected
          await db
            .update(referralUsage)
            .set({
              status: "rejected",
              rejectionReason: "Referral code usage limit reached",
            })
            .where(eq(referralUsage.id, pendingReferral.id));

          // Mark user as rejected (DON'T DELETE)
          await db
            .update(users)
            .set({
              status: "referral_rejected",
              updatedAt: new Date(),
            })
            .where(eq(users.id, userId));


          await emailService.sendEmail(
            user.email,
            "Referral Code Limit Reached",
            `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; text-align: center;">
            <h2 style="color: #333; margin: 0 0 20px 0; font-size: 24px;">Referral Code Limit Reached</h2>
            <p style="color: #666; line-height: 1.6; margin: 0 0 30px 0; font-size: 16px;">
              Please Use a Different Code
            </p>
            <p style="color: #666; line-height: 1.6; margin: 0 0 30px 0; font-size: 14px;">
              The one you entered has reached its usage limit and can't be used anymore.
            </p>
            <a href="${process.env.FRONTEND_URL}/login?flow=creative&step=login-choice&mode=signup" style="display: inline-block; background-color: #000; color: #fff; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-size: 16px;">Sign Up</a>
          </div>
          `
          );

          console.log(
            `User ${userId} marked as rejected due to referral limit`
          );

          // Return error response for frontend to handle
          return res.status(400).json({
            success: false,
            message:
              "Referral code has reached its usage limit. Your account has been rejected. Please sign up again with a valid referral code.",
            errorType: "REFERRAL_LIMIT_REACHED",
            requiresSignup: true,
            showAdminPopup: true,
          });
        }

        // APPROVE: Allocate points (only reaches here if limit NOT reached)
        const referralNumber = currentCount + 1;
        const calculatePoints = (num) => {
          const pointsMap = {
            1: 1.5,
            2: 2.0,
            3: 2.5,
            4: 3.0,
            5: 3.5,
            6: 4.0,
            7: 4.5,
          };
          return pointsMap[num] || 1.5;
        };

        // Point distribution logic
        let pointsToCodeOwner, pointsToUser, pointsToAdmin;

        if (pendingReferral.codeType === "user") {
          // User personal code
          pointsToCodeOwner = calculatePoints(referralNumber);
          pointsToUser = 1;
          pointsToAdmin = 0;
        }
        else {
          // Admin code
          pointsToUser = 1; // Always give 1 point to the new user
          pointsToAdmin = pendingReferral.codeOwnerId ? 0.5 : 1; // 0.5 if assigned, 1 if unassigned
          pointsToCodeOwner = pendingReferral.codeOwnerId ? 1 : 0; // 1 point to code owner if assigned
        }


        // Get current balances
        const [currentUser] = await db
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        const currentUserPoints = parseFloat(currentUser?.points) || 0;

        // Allocate points
        await Promise.all([
          // Update referral usage
          db
            .update(referralUsage)
            .set({
              status: "active",
              pointsToUser,
              pointsToCodeOwner,
              pointsToAdmin,
              referralLevel: referralNumber,
              usedAt: new Date(),
            })
            .where(eq(referralUsage.id, pendingReferral.id)),

          // Give points to user
          db
            .update(users)
            .set({
              points: sql`${users.points} + ${pointsToUser}`,
              updatedAt: new Date(),
            })
            .where(eq(users.id, userId)),

          // Give points to code owner if exists
          pendingReferral.codeOwnerId && pointsToCodeOwner > 0
            ? db
              .update(users)
              .set({
                points: sql`${users.points} + ${pointsToCodeOwner}`,
                updatedAt: new Date(),
              })
              .where(eq(users.id, pendingReferral.codeOwnerId))
            : Promise.resolve(),

          // Give points to admin if applicable
          pendingReferral.adminCreatorId && pointsToAdmin > 0
            ? db
              .update(users)
              .set({
                points: sql`${users.points} + ${pointsToAdmin}`,
                updatedAt: new Date(),
              })
              .where(eq(users.id, pendingReferral.adminCreatorId))
            : Promise.resolve(),

          // Insert points transactions
          db.insert(pointsTransactions).values([
            {
              userId,
              amount: pointsToUser,
              type: "referral_bonus",
              referralUsageId: pendingReferral.id,
              previousBalance: currentUserPoints,
              newBalance: currentUserPoints + pointsToUser,
              description: `Referral bonus for using code: ${pendingReferral.referralCode}`,
            },
            ...(pendingReferral.codeOwnerId && pointsToCodeOwner > 0
              ? [
                {
                  userId: pendingReferral.codeOwnerId,
                  amount: pointsToCodeOwner,
                  type: "referral_bonus",
                  referralUsageId: pendingReferral.id,
                  description: `Referral bonus (level ${referralNumber})`,
                },
              ]
              : []),
            ...(pendingReferral.adminCreatorId && pointsToAdmin > 0
              ? [
                {
                  userId: pendingReferral.adminCreatorId,
                  amount: pointsToAdmin,
                  type: "admin_bonus",
                  referralUsageId: pendingReferral.id,
                  description: "Admin bonus for code creation",
                },
              ]
              : []),
          ]),
        ]);
      }

      // Approve user - this only runs if no referral OR referral passed limit check
      const [updatedUser] = await db
        .update(users)
        .set({
          status: "approved",
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();

      // Send approval email
      await emailService.sendUserApprovalEmail(
        updatedUser.email,
        updatedUser.firstName || updatedUser.name || "User"
      );

      res.status(200).json({
        success: true,
        message: "User approved successfully",
        data: { user: updatedUser },
      });
    } catch (error) {
      console.error("User approval error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Failed to approve user",
      });
    }
  },

  async rejectUser(req, res) {
    try {
      const { userId } = req.params;
      const { rejectionReason } = req.body;

      // Check if rejection is due to referral limit
      const [pendingReferral] = await db
        .select()
        .from(referralUsage)
        .where(
          and(
            eq(referralUsage.usedByUserId, userId),
            eq(referralUsage.status, "pending")
          )
        )
        .limit(1);

      let isReferralLimitRejection = false;

      if (pendingReferral) {
        // Mark referral as rejected
        await db
          .update(referralUsage)
          .set({
            status: "rejected",
            rejectionReason: rejectionReason || "User rejected by admin",
          })
          .where(eq(referralUsage.id, pendingReferral.id));


        console.log(`[RejectUser] Pending referral found for userId ${userId} with code: ${pendingReferral.referralCode} (type: ${pendingReferral.codeType})`);


        if (pendingReferral.codeType !== "admin") {

          const activeCount = await db
            .select({ count: sql`count(*)` })
            .from(referralUsage)
            .where(
              and(
                eq(referralUsage.referralCode, pendingReferral.referralCode),
                eq(referralUsage.status, "active")
              )
            );
            
        // Check if it's a limit rejection

          isReferralLimitRejection = Number(activeCount[0].count) >= 7;

          console.log(`[RejectUser] Active usage count: ${activeCount[0].count}`);
        }

        else {
            console.log(`[RejectUser] Code type is admin, skipping referral limit check.`);
        }

      }

      const updatedUser = await adminService.rejectUser(userId);

      // Send appropriate rejection email
      if (isReferralLimitRejection) {
        await emailService.sendEmail(
          updatedUser.email,
          "Referral Code Limit Reached - CUNO COVO",
          `
          <p>This referral code has used its allowed number of referrals.</p>
          <p>Please request a referral code by replying to this email.</p>
        `
        );
      } else {
        await emailService.sendUserRejectionEmail(
          updatedUser.email,
          updatedUser.name || updatedUser.firstName || "User",
          rejectionReason
        );
      }

      res.status(200).json({
        success: true,
        message: "User rejected successfully",
        data: { user: updatedUser },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },

  async bulkUpdateUserStatus(req, res) {
    try {
      const { userIds, status } = req.body;

      if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "User IDs are required",
        });
      }

      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status",
        });
      }

      const updatedUsers = await adminService.bulkUpdateUserStatus(
        userIds,
        status
      );

      res.status(200).json({
        success: true,
        message: `Users ${status} successfully`,
        data: {
          users: updatedUsers,
          count: updatedUsers.length,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },

  async deleteUser(req, res) {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

      // Check if user exists
      const userExists = await db.select().from(users).where(eq(users.id, id));
      if (!userExists.length) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Start transaction to ensure all deletions are atomic
      await db.transaction(async (tx) => {
        // Delete records in proper order to respect foreign key constraints

        // 1. First delete all dependent records that reference the user but don't have other dependencies
        await tx
          .delete(commentInteractions)
          .where(eq(commentInteractions.userId, id));
        await tx.delete(pollVotes).where(eq(pollVotes.userId, id));
        await tx
          .delete(postInteractions)
          .where(eq(postInteractions.userId, id));
        await tx
          .delete(chatroomIdentities)
          .where(eq(chatroomIdentities.userId, id));

        // 2. Delete comments (this will cascade to replies due to parent_comment_id)
        await tx.delete(comments).where(eq(comments.userId, id));

        // 3. Now we can delete posts (must be done after deleting comments and interactions)
        await tx.delete(posts).where(eq(posts.userId, id));

        // 4. Delete creative proposals and inquiries
        await tx
          .delete(creativeProposals)
          .where(eq(creativeProposals.creativeUserId, id));
        await tx
          .delete(creativeInquiries)
          .where(eq(creativeInquiries.userId, id));

        // 5. Delete referral system records
        await tx
          .delete(pointsTransactions)
          .where(eq(pointsTransactions.userId, id));
        await tx
          .delete(pointsTransactions)
          .where(eq(pointsTransactions.performedByUserId, id));
        await tx.delete(pointsTransactions).where(
          inArray(
            pointsTransactions.referralUsageId,
            tx
              .select({ id: referralUsage.id })
              .from(referralUsage)
              .where(
                or(
                  eq(referralUsage.usedByUserId, id),
                  eq(referralUsage.codeOwnerId, id),
                  eq(referralUsage.adminCreatorId, id)
                )
              )
          )
        );

        await tx
          .delete(referralUsage)
          .where(eq(referralUsage.usedByUserId, id));
        await tx.delete(referralUsage).where(eq(referralUsage.codeOwnerId, id));
        await tx
          .delete(referralUsage)
          .where(eq(referralUsage.adminCreatorId, id));

        await tx
          .delete(referralCodeAuditLog)
          .where(eq(referralCodeAuditLog.performedByUserId, id));
        await tx
          .delete(referralCodeAuditLog)
          .where(eq(referralCodeAuditLog.affectedUserId, id));

        await tx
          .delete(adminReferralCodes)
          .where(eq(adminReferralCodes.assignedToUserId, id));
        await tx
          .delete(adminReferralCodes)
          .where(eq(adminReferralCodes.createdByAdminId, id));
        await tx
          .delete(adminReferralCodes)
          .where(eq(adminReferralCodes.previousAssignedTo, id));

        // 6. Delete auth-related records
        await tx.delete(otpCodes).where(eq(otpCodes.userId, id));
        await tx
          .delete(passwordResetTokens)
          .where(eq(passwordResetTokens.userId, id));
        await tx
          .delete(emailVerificationTokens)
          .where(eq(emailVerificationTokens.userId, id));

        // 7. Delete onboarding progress
        await tx
          .delete(onboardingProgress)
          .where(eq(onboardingProgress.userId, id));

        // 8. Update referral relationships (set referredBy to null for users referred by this user)
        await tx
          .update(users)
          .set({ referredBy: null })
          .where(eq(users.referredBy, id));

        // 9. Finally, delete the user
        await tx.delete(users).where(eq(users.id, id));
      });

      res.status(200).json({
        success: true,
        message: "User deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message, // Include error message for debugging
      });
    }
  },
};

module.exports = AdminController;
