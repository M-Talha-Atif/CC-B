const { db } = require("../config/database");
const {
  users,
  adminReferralCodes,
  referralUsage,
  pointsTransactions,
  referralCodeAuditLog,
} = require("../models/schema");
const {
  eq,
  and,
  desc,
  asc,
  sql,
  or,
  like,
  isNull,
  isNotNull,
  ne,
  ilike,
  inArray,
} = require("drizzle-orm");
const crypto = require("crypto");

const AdminService = {
  // Referral Code Management
  async createReferralCode(data) {
    const { code, description, expiresAt, createdByAdminId, assignedToUserId } =
      data;

    // Check if code already exists
    const existing = await db
      .select()
      .from(adminReferralCodes)
      .where(eq(adminReferralCodes.code, code))
      .limit(1);

    if (existing.length > 0) {
      throw new Error("Referral code already exists");
    }

    // If assigning to a user, validate user exists
    if (assignedToUserId) {
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, assignedToUserId))
        .limit(1);

      if (user.length === 0) {
        throw new Error("User not found");
      }
    }

    // Create the referral code
    const [referralCode] = await db
      .insert(adminReferralCodes)
      .values({
        code,
        description,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdByAdminId,
        assignedToUserId: assignedToUserId || null,
        assignedAt: assignedToUserId ? new Date() : null, // Set assignedAt if user is assigned
      })
      .returning();

    // If assigning to user, update their assignedReferralCode
    if (assignedToUserId) {
      await db
        .update(users)
        .set({
          assignedReferralCode: code,
          updatedAt: new Date(),
        })
        .where(eq(users.id, assignedToUserId));

      // Create audit log entry
      await db.insert(referralCodeAuditLog).values({
        referralCodeId: referralCode.id,
        action: "assigned",
        performedByUserId: createdByAdminId,
        affectedUserId: assignedToUserId,
        newState: { assignedToUserId, code },
        reason: "Code created and assigned to user",
        createdAt: new Date(),
      });
    }

    return referralCode;
  },

  async getReferralCodes(filters) {
    const { page = 1, limit = 10, isActive, assignedStatus, search } = filters;
    const offset = (page - 1) * limit;

    let whereConditions = [];

    // Filter by active status
    if (isActive !== undefined) {
      whereConditions.push(eq(adminReferralCodes.isActive, isActive));
    }

    // Filter by assignment status
    if (assignedStatus === "assigned") {
      whereConditions.push(isNotNull(adminReferralCodes.assignedToUserId));
    } else if (assignedStatus === "unassigned") {
      whereConditions.push(isNull(adminReferralCodes.assignedToUserId));
    }

    // Enhanced search functionality
    if (search && search.trim()) {
      const searchTerm = search.toLowerCase().trim();
      const searchPattern = `%${searchTerm}%`;

      // Check if searching for unassigned codes
      if (searchTerm === "admin" || searchTerm === "unassigned") {
        // Show codes that are not assigned to any user (assignedToUserId is null)
        whereConditions.push(isNull(adminReferralCodes.assignedToUserId));
      } else {
        // Regular search across code, description, and user fields
        whereConditions.push(
          or(
            ilike(adminReferralCodes.code, searchPattern),
            ilike(adminReferralCodes.description, searchPattern),
            ilike(users.email, searchPattern),
            ilike(users.firstName, searchPattern),
            ilike(users.lastName, searchPattern)
          )
        );
      }
    }

    // Build the main query
    const query = db
      .select({
        id: adminReferralCodes.id,
        code: adminReferralCodes.code,
        description: adminReferralCodes.description,
        isActive: adminReferralCodes.isActive,
        expiresAt: adminReferralCodes.expiresAt,
        createdAt: adminReferralCodes.createdAt,
        assignedToUserId: adminReferralCodes.assignedToUserId,
        createdByAdminId: adminReferralCodes.createdByAdminId,
        assignedUser: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        },
      })
      .from(adminReferralCodes)
      .leftJoin(users, eq(adminReferralCodes.assignedToUserId, users.id));

    // Apply where conditions
    if (whereConditions.length > 0) {
      query.where(and(...whereConditions));
    }

    // Get paginated data
    const data = await query
      .orderBy(desc(adminReferralCodes.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count for pagination with same conditions
    const countQuery = db
      .select({ count: sql`count(*)`.mapWith(Number) })
      .from(adminReferralCodes)
      .leftJoin(users, eq(adminReferralCodes.assignedToUserId, users.id));

    if (whereConditions.length > 0) {
      countQuery.where(and(...whereConditions));
    }

    const [{ count }] = await countQuery;

    return {
      data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / limit),
      },
    };
  },

  async getReferralCodeById(id) {
    const [referralCode] = await db
      .select({
        id: adminReferralCodes.id,
        code: adminReferralCodes.code,
        description: adminReferralCodes.description,
        isActive: adminReferralCodes.isActive,
        expiresAt: adminReferralCodes.expiresAt,
        createdAt: adminReferralCodes.createdAt,
        assignedUser: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          points: users.points,
        },
      })
      .from(adminReferralCodes)
      .leftJoin(users, eq(adminReferralCodes.assignedToUserId, users.id))
      .where(eq(adminReferralCodes.id, id))
      .limit(1);

    if (!referralCode) {
      throw new Error("Referral code not found");
    }

    // Get usage statistics
    const usageStats = await this.getReferralCodeUsageStats(referralCode.code);

    return {
      ...referralCode,
      usageStats,
    };
  },

  async updateReferralCode(id, updates) {
    const [referralCode] = await db
      .update(adminReferralCodes)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(adminReferralCodes.id, id))
      .returning();

    if (!referralCode) {
      throw new Error("Referral code not found");
    }

    return referralCode;
  },

  async deleteReferralCode(id) {
    // Check if code has been used
    const usage = await db
      .select()
      .from(referralUsage)
      .where(
        eq(
          referralUsage.referralCode,
          db
            .select({ code: adminReferralCodes.code })
            .from(adminReferralCodes)
            .where(eq(adminReferralCodes.id, id))
        )
      )
      .limit(1);

    if (usage.length > 0) {
      throw new Error("Cannot delete referral code that has been used");
    }

    const [deleted] = await db
      .delete(adminReferralCodes)
      .where(eq(adminReferralCodes.id, id))
      .returning();

    if (!deleted) {
      throw new Error("Referral code not found");
    }

    return deleted;
  },

  // Assign/Unassign Operations
  // adminService.js - Fixed implementation with proper point management

  async assignReferralCode(codeId, userId) {
    // Start a transaction to ensure data consistency
    return await db.transaction(async (tx) => {
      try {
        // Verify user exists with proper parameter binding
        const [user] = await tx
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        if (!user) {
          throw new Error("User not found");
        }

        // Check if user already has an assigned admin referral code
        const existingAssignment = await tx
          .select()
          .from(adminReferralCodes)
          .where(eq(adminReferralCodes.assignedToUserId, userId))
          .limit(1);

        if (existingAssignment.length > 0) {
          throw new Error("User already has an assigned referral code");
        }

        // Check if the referral code exists and is available
        const [existingCode] = await tx
          .select()
          .from(adminReferralCodes)
          .where(eq(adminReferralCodes.id, codeId))
          .limit(1);

        if (!existingCode) {
          throw new Error("Referral code not found");
        }

        if (existingCode.assignedToUserId) {
          throw new Error("Referral code is already assigned to another user");
        }

        if (!existingCode.isActive) {
          throw new Error("Referral code is inactive");
        }

        // Check if code has expired
        if (existingCode.expiresAt && new Date() > existingCode.expiresAt) {
          throw new Error("Referral code has expired");
        }

        // Update referral code assignment
        const [referralCode] = await tx
          .update(adminReferralCodes)
          .set({
            assignedToUserId: userId,
            updatedAt: new Date(),
          })
          .where(eq(adminReferralCodes.id, codeId))
          .returning();

        // Update user's assigned referral code
        const [updatedUser] = await tx
          .update(users)
          .set({
            assignedReferralCode: referralCode.code,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId))
          .returning();

        // Add assignment bonus points to user (optional)
        const assignmentBonus = 10.0; // You can make this configurable

        await tx
          .update(users)
          .set({
            points: sql`${users.points} + ${assignmentBonus}`,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));

        // Record points transaction
        await tx.insert(pointsTransactions).values({
          userId: userId,
          amount: assignmentBonus.toString(),
          type: "referral_code_assignment",
          description: `Bonus points for being assigned referral code: ${referralCode.code}`,
          createdAt: new Date(),
        });

        return {
          referralCode,
          user: updatedUser,
          bonusPointsAdded: assignmentBonus,
        };
      } catch (error) {
        console.error("Error in assignReferralCode:", error);
        throw error;
      }
    });
  },

  async unassignReferralCode(codeId) {
    return await db.transaction(async (tx) => {
      try {
        // Get the referral code with user info
        const [referralCode] = await tx
          .select()
          .from(adminReferralCodes)
          .where(eq(adminReferralCodes.id, codeId))
          .limit(1);

        if (!referralCode) {
          throw new Error("Referral code not found");
        }

        if (!referralCode.assignedToUserId) {
          throw new Error("Referral code is not assigned to any user");
        }

        // Get user's current points and assignment bonus
        const [user] = await tx
          .select()
          .from(users)
          .where(eq(users.id, referralCode.assignedToUserId))
          .limit(1);

        if (!user) {
          throw new Error("Assigned user not found");
        }

        // Check if this referral code has been used and calculate points to deduct
        const referralUsages = await tx
          .select()
          .from(referralUsage)
          .where(eq(referralUsage.referralCode, referralCode.code));

        // Calculate total points earned from this referral code
        let totalPointsToDeduct = 0;
        const assignmentBonus = 10.0; // Should match the bonus given during assignment

        // Add assignment bonus to deduction
        totalPointsToDeduct += assignmentBonus;

        // Add points earned from referral usage
        for (const usage of referralUsages) {
          totalPointsToDeduct += parseFloat(usage.pointsToCodeOwner || 0);
        }

        // Ensure user has enough points (don't allow negative balance)
        const currentPoints = parseFloat(user.points || 0);
        const finalDeduction = Math.min(totalPointsToDeduct, currentPoints);

        // Update referral code - remove assignment
        const [updatedCode] = await tx
          .update(adminReferralCodes)
          .set({
            assignedToUserId: null,
            updatedAt: new Date(),
          })
          .where(eq(adminReferralCodes.id, codeId))
          .returning();

        // Update user - remove assigned code and deduct points
        await tx
          .update(users)
          .set({
            assignedReferralCode: null,
            points: sql`GREATEST(${users.points} - ${finalDeduction}, 0)`, // Prevent negative points
            updatedAt: new Date(),
          })
          .where(eq(users.id, referralCode.assignedToUserId));

        // Record points deduction transaction
        if (finalDeduction > 0) {
          await tx.insert(pointsTransactions).values({
            userId: referralCode.assignedToUserId,
            amount: (-finalDeduction).toString(),
            type: "referral_code_unassignment",
            description: `Points deducted for unassigning referral code: ${referralCode.code}`,
            createdAt: new Date(),
          });
        }

        // If there were referral usages, we might want to handle them
        // Option 1: Mark them as "unassigned" but keep the records for audit
        // Option 2: Delete them (more complex, affects other users)
        // For now, we'll keep them but could add a status field

        if (referralUsages.length > 0) {
          // Update referral usage records to reflect unassignment
          await tx
            .update(referralUsage)
            .set({
              // You might want to add a status field to track this
              // status: 'code_unassigned',
              updatedAt: new Date(),
            })
            .where(eq(referralUsage.referralCode, referralCode.code));
        }

        return {
          referralCode: updatedCode,
          pointsDeducted: finalDeduction,
          affectedReferrals: referralUsages.length,
          user: {
            id: user.id,
            email: user.email,
            previousPoints: currentPoints,
            newPoints: Math.max(0, currentPoints - finalDeduction),
          },
        };
      } catch (error) {
        console.error("Error in unassignReferralCode:", error);
        throw error;
      }
    });
  },

  // Helper function to get referral code details with usage stats
  async getReferralCodeDetails(codeId) {
    try {
      const [code] = await db
        .select({
          id: adminReferralCodes.id,
          code: adminReferralCodes.code,
          assignedToUserId: adminReferralCodes.assignedToUserId,
          description: adminReferralCodes.description,
          isActive: adminReferralCodes.isActive,
          expiresAt: adminReferralCodes.expiresAt,
          createdAt: adminReferralCodes.createdAt,
          // User details if assigned
          userEmail: users.email,
          userFirstName: users.firstName,
          userLastName: users.lastName,
          userPoints: users.points,
        })
        .from(adminReferralCodes)
        .leftJoin(users, eq(adminReferralCodes.assignedToUserId, users.id))
        .where(eq(adminReferralCodes.id, codeId))
        .limit(1);

      if (!code) {
        throw new Error("Referral code not found");
      }

      // Get usage statistics
      const usageStats = await db
        .select({
          totalUsages: sql`COUNT(*)`,
          totalPointsDistributed: sql`SUM(${referralUsage.pointsToCodeOwner})`,
        })
        .from(referralUsage)
        .where(eq(referralUsage.referralCode, code.code));

      return {
        ...code,
        usageStats: usageStats[0] || {
          totalUsages: 0,
          totalPointsDistributed: 0,
        },
      };
    } catch (error) {
      console.error("Error getting referral code details:", error);
      throw error;
    }
  },

  // Point Distribution Logic
  async processReferralCodeUsage(code, usedByUserId) {
    return await db.transaction(async (tx) => {
      // Check if it's an admin referral code
      const [adminCode] = await tx
        .select()
        .from(adminReferralCodes)
        .where(
          and(
            eq(adminReferralCodes.code, code),
            eq(adminReferralCodes.isActive, true)
          )
        )
        .limit(1);

      let pointsDistribution;
      let referralLevel = 1;

      if (adminCode) {
        // Admin referral code logic
        if (adminCode.assignedToUserId) {
          // Code is assigned to a user (User A scenario)
          const codeOwner = await tx
            .select()
            .from(users)
            .where(eq(users.id, adminCode.assignedToUserId))
            .limit(1);

          if (codeOwner.length === 0) {
            throw new Error("Code owner not found");
          }

          // Check if the code owner is using their own code
          if (adminCode.assignedToUserId === usedByUserId) {
            // User A uses their assigned code - admin gets 1 point, user gets 1 point
            pointsDistribution = {
              pointsToUser: 1.0,
              pointsToCodeOwner: 0.0, // Same person
              pointsToAdmin: 1.0,
            };
          } else {
            // User B uses User A's code - both users get 1 point, admin gets 0.5 points
            pointsDistribution = {
              pointsToUser: 1.0,
              pointsToCodeOwner: 1.0,
              pointsToAdmin: 0.5,
            };
            referralLevel = 2; // This is a second-level referral
          }
        } else {
          // Unassigned admin code - only admin gets points
          pointsDistribution = {
            pointsToUser: 1.0,
            pointsToCodeOwner: 0.0,
            pointsToAdmin: 1.0,
          };
        }

        // Record the usage
        const [usage] = await tx
          .insert(referralUsage)
          .values({
            referralCode: code,
            codeType: "admin",
            usedByUserId,
            codeOwnerId: adminCode.assignedToUserId,
            adminCreatorId: adminCode.createdByAdminId,
            pointsToUser: pointsDistribution.pointsToUser,
            pointsToCodeOwner: pointsDistribution.pointsToCodeOwner,
            pointsToAdmin: pointsDistribution.pointsToAdmin,
            referralLevel,
          })
          .returning();

        // Distribute points
        await this.distributePoints(tx, usage, pointsDistribution);

        return usage;
      } else {
        // Check if it's a user's personal referral code
        const [codeOwner] = await tx
          .select()
          .from(users)
          .where(eq(users.personalReferralCode, code))
          .limit(1);

        if (!codeOwner) {
          throw new Error("Invalid referral code");
        }

        // Personal referral code - both users get 1 point
        pointsDistribution = {
          pointsToUser: 1.0,
          pointsToCodeOwner: 1.0,
          pointsToAdmin: 0.0,
        };

        // Record the usage
        const [usage] = await tx
          .insert(referralUsage)
          .values({
            referralCode: code,
            codeType: "user",
            usedByUserId,
            codeOwnerId: codeOwner.id,
            adminCreatorId: null,
            pointsToUser: pointsDistribution.pointsToUser,
            pointsToCodeOwner: pointsDistribution.pointsToCodeOwner,
            pointsToAdmin: pointsDistribution.pointsToAdmin,
            referralLevel: 1,
          })
          .returning();

        // Distribute points
        await this.distributePoints(tx, usage, pointsDistribution);

        return usage;
      }
    });
  },

  async distributePoints(tx, usage, pointsDistribution) {
    // Add points to the user who used the code
    if (pointsDistribution.pointsToUser > 0) {
      await tx
        .update(users)
        .set({
          points: sql`${users.points} + ${pointsDistribution.pointsToUser}`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, usage.usedByUserId));

      // Record transaction
      await tx.insert(pointsTransactions).values({
        userId: usage.usedByUserId,
        amount: pointsDistribution.pointsToUser,
        type: "referral_bonus",
        description: `Referral bonus for using code: ${usage.referralCode}`,
        referralUsageId: usage.id,
      });
    }

    // Add points to the code owner
    if (pointsDistribution.pointsToCodeOwner > 0 && usage.codeOwnerId) {
      await tx
        .update(users)
        .set({
          points: sql`${users.points} + ${pointsDistribution.pointsToCodeOwner}`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, usage.codeOwnerId));

      // Record transaction
      await tx.insert(pointsTransactions).values({
        userId: usage.codeOwnerId,
        amount: pointsDistribution.pointsToCodeOwner,
        type: "referral_bonus",
        description: `Referral bonus for code usage: ${usage.referralCode}`,
        referralUsageId: usage.id,
      });
    }

    // Add points to the admin
    if (pointsDistribution.pointsToAdmin > 0 && usage.adminCreatorId) {
      await tx
        .update(users)
        .set({
          points: sql`${users.points} + ${pointsDistribution.pointsToAdmin}`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, usage.adminCreatorId));

      // Record transaction
      await tx.insert(pointsTransactions).values({
        userId: usage.adminCreatorId,
        amount: pointsDistribution.pointsToAdmin,
        type: "admin_referral_bonus",
        description: `Admin referral bonus for code: ${usage.referralCode}`,
        referralUsageId: usage.id,
      });
    }
  },

  // Analytics and Reporting
  async getReferralAnalytics(filters) {
    const { startDate, endDate, adminId } = filters;

    let whereConditions = [];
    if (startDate)
      whereConditions.push(
        sql`${referralUsage.usedAt} >= ${new Date(startDate)}`
      );
    if (endDate)
      whereConditions.push(
        sql`${referralUsage.usedAt} <= ${new Date(endDate)}`
      );
    if (adminId)
      whereConditions.push(eq(referralUsage.adminCreatorId, adminId));

    const analytics = await db
      .select({
        totalUsages: sql`count(*)`.mapWith(Number),
        totalPointsDistributed:
          sql`sum(${referralUsage.pointsToUser} + ${referralUsage.pointsToCodeOwner} + ${referralUsage.pointsToAdmin})`.mapWith(
            Number
          ),
        totalAdminPoints: sql`sum(${referralUsage.pointsToAdmin})`.mapWith(
          Number
        ),
        totalUserPoints: sql`sum(${referralUsage.pointsToUser})`.mapWith(
          Number
        ),
        totalCodeOwnerPoints:
          sql`sum(${referralUsage.pointsToCodeOwner})`.mapWith(Number),
        uniqueUsers: sql`count(distinct ${referralUsage.usedByUserId})`.mapWith(
          Number
        ),
        uniqueCodes: sql`count(distinct ${referralUsage.referralCode})`.mapWith(
          Number
        ),
      })
      .from(referralUsage)
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined);

    const usageByDay = await db
      .select({
        date: sql`date(${referralUsage.usedAt})`.as("date"),
        count: sql`count(*)`.mapWith(Number),
        points:
          sql`sum(${referralUsage.pointsToUser} + ${referralUsage.pointsToCodeOwner} + ${referralUsage.pointsToAdmin})`.mapWith(
            Number
          ),
      })
      .from(referralUsage)
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .groupBy(sql`date(${referralUsage.usedAt})`)
      .orderBy(sql`date(${referralUsage.usedAt})`);

    const topCodes = await db
      .select({
        code: referralUsage.referralCode,
        usageCount: sql`count(*)`.mapWith(Number),
        totalPoints:
          sql`sum(${referralUsage.pointsToUser} + ${referralUsage.pointsToCodeOwner} + ${referralUsage.pointsToAdmin})`.mapWith(
            Number
          ),
      })
      .from(referralUsage)
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .groupBy(referralUsage.referralCode)
      .orderBy(sql`count(*) desc`)
      .limit(10);

    return {
      summary: analytics[0],
      usageByDay,
      topCodes,
    };
  },

  async getReferralUsage(filters) {
    const { page, limit, referralCode, userId } = filters;
    const offset = (page - 1) * limit;

    let whereConditions = [];
    if (referralCode)
      whereConditions.push(eq(referralUsage.referralCode, referralCode));
    if (userId) whereConditions.push(eq(referralUsage.usedByUserId, userId));

    const rawData = await db
      .select({
        id: referralUsage.id,
        referralCode: referralUsage.referralCode,
        codeType: referralUsage.codeType,
        pointsToUser: referralUsage.pointsToUser,
        pointsToCodeOwner: referralUsage.pointsToCodeOwner,
        pointsToAdmin: referralUsage.pointsToAdmin,
        referralLevel: referralUsage.referralLevel,
        usedAt: referralUsage.usedAt,
        user: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          originalDataBackup: users.originalDataBackup,
          isAnonymous: users.isAnonymous,
        },
      })
      .from(referralUsage)
      .leftJoin(users, eq(referralUsage.usedByUserId, users.id))
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .orderBy(desc(referralUsage.usedAt))
      .limit(limit)
      .offset(offset);

    // inject real email if user is anonymous
    const data = rawData.map((item) => {
      if (item.user?.isAnonymous && item.user?.originalDataBackup) {
        try {
          const backup = JSON.parse(item.user.originalDataBackup);
          if (backup?.email) {
            return {
              ...item,
              user: {
                ...item.user,
                email: backup.email,
              },
            };
          }
        } catch (e) {
          console.error("Backup parse failed for user:", item.user.id);
        }
      }
      return item;
    });

    const [{ count }] = await db
      .select({ count: sql`count(*)`.mapWith(Number) })
      .from(referralUsage)
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined);

    return {
      data,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit),
      },
    };
  },

  async getPointsLeaderboard(filters) {
    const { limit, userType } = filters;

    let whereConditions = [];
    if (userType) whereConditions.push(eq(users.userType, userType));

    const leaderboard = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        userType: users.userType,
        points: users.points,
        businessName: users.businessName,
      })
      .from(users)
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
      .orderBy(desc(users.points))
      .limit(limit);

    return leaderboard;
  },

  async getUserReferralStats(userId) {
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (user.length === 0) {
      throw new Error("User not found");
    }

    // Get referral usage statistics
    const usageStats = await db
      .select({
        totalUsages: sql`count(*)`.mapWith(Number),
        totalPointsEarned: sql`sum(${referralUsage.pointsToUser})`.mapWith(
          Number
        ),
        totalPointsGiven: sql`sum(${referralUsage.pointsToCodeOwner})`.mapWith(
          Number
        ),
      })
      .from(referralUsage)
      .where(
        or(
          eq(referralUsage.usedByUserId, userId),
          eq(referralUsage.codeOwnerId, userId)
        )
      );

    // Get assigned referral code info
    const assignedCode = await db
      .select()
      .from(adminReferralCodes)
      .where(eq(adminReferralCodes.assignedToUserId, userId))
      .limit(1);

    // Get recent referral activities
    const recentActivity = await db
      .select({
        id: referralUsage.id,
        referralCode: referralUsage.referralCode,
        codeType: referralUsage.codeType,
        pointsEarned: referralUsage.pointsToUser,
        usedAt: referralUsage.usedAt,
      })
      .from(referralUsage)
      .where(eq(referralUsage.usedByUserId, userId))
      .orderBy(desc(referralUsage.usedAt))
      .limit(10);

    return {
      user: user[0],
      stats: usageStats[0],
      assignedCode: assignedCode[0] || null,
      recentActivity,
    };
  },

  async getUsers(filters) {
    const { page, limit, userType, search } = filters;
    const offset = (page - 1) * limit;

    let whereConditions = [ne(users.userType, "admin")];

    if (userType) {
      whereConditions.push(eq(users.userType, userType));
    }

    if (search) {
      whereConditions.push(
        or(
          like(users.firstName, `%${search}%`),
          like(users.lastName, `%${search}%`),
          like(users.email, `%${search}%`),
          like(users.businessName, `%${search}%`)
        )
      );
    }

    const whereClause = and(...whereConditions);

    const data = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        userType: users.userType,
        businessName: users.businessName,
        points: users.points,
        profileCompleted: users.profileCompleted,
        emailVerified: users.emailVerified,
        phoneVerified: users.phoneVerified,
        assignedReferralCode: users.assignedReferralCode,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .where(whereClause)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql`count(*)`.mapWith(Number) })
      .from(users)
      .where(whereClause);

    return {
      data,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit),
      },
    };
  },

  async getUserById(id) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  },

  async updateUserPoints(userId, pointsData) {
    const { amount, type, description, adminId } = pointsData;

    return await db.transaction(async (tx) => {
      // Update user points
      const [user] = await tx
        .update(users)
        .set({
          points: sql`${users.points} + ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();

      if (!user) {
        throw new Error("User not found");
      }

      // Record transaction
      await tx.insert(pointsTransactions).values({
        userId,
        amount,
        type: type || "admin_adjustment",
        description:
          description || `Points ${amount > 0 ? "added" : "deducted"} by admin`,
      });

      return user;
    });
  },

  async getUserPointsHistory(userId, filters) {
    const { page, limit } = filters;
    const offset = (page - 1) * limit;

    const data = await db
      .select({
        id: pointsTransactions.id,
        amount: pointsTransactions.amount,
        type: pointsTransactions.type,
        description: pointsTransactions.description,
        createdAt: pointsTransactions.createdAt,
      })
      .from(pointsTransactions)
      .where(eq(pointsTransactions.userId, userId))
      .orderBy(desc(pointsTransactions.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql`count(*)`.mapWith(Number) })
      .from(pointsTransactions)
      .where(eq(pointsTransactions.userId, userId));

    return {
      data,
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit),
      },
    };
  },

  async bulkCreateReferralCodes(codes, adminId) {
    const results = {
      created: 0,
      errors: [],
    };

    for (const codeData of codes) {
      try {
        await this.createReferralCode({
          ...codeData,
          createdByAdminId: adminId,
        });
        results.created++;
      } catch (error) {
        results.errors.push({
          code: codeData.code,
          error: error.message,
        });
      }
    }

    return results;
  },

  async bulkAssignReferralCodes(assignments) {
    const results = {
      assigned: 0,
      errors: [],
    };

    for (const assignment of assignments) {
      try {
        await this.assignReferralCode(assignment.codeId, assignment.userId);
        results.assigned++;
      } catch (error) {
        results.errors.push({
          codeId: assignment.codeId,
          userId: assignment.userId,
          error: error.message,
        });
      }
    }

    return results;
  },

  async getReferralCodeUsageStats(code) {
    const stats = await db
      .select({
        totalUsages: sql`count(*)`.mapWith(Number),
        totalPointsDistributed:
          sql`sum(${referralUsage.pointsToUser} + ${referralUsage.pointsToCodeOwner} + ${referralUsage.pointsToAdmin})`.mapWith(
            Number
          ),
        uniqueUsers: sql`count(distinct ${referralUsage.usedByUserId})`.mapWith(
          Number
        ),
        lastUsed: sql`max(${referralUsage.usedAt})`,
      })
      .from(referralUsage)
      .where(eq(referralUsage.referralCode, code));

    return stats[0];
  },

  async generateUniqueReferralCode(prefix = "REF") {
    let code;
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 10) {
      code = `${prefix}${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

      const existing = await db
        .select()
        .from(adminReferralCodes)
        .where(eq(adminReferralCodes.code, code))
        .limit(1);

      if (existing.length === 0) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      throw new Error("Unable to generate unique referral code");
    }

    return code;
  },

  async getPendingUsers() {
    try {
      const pendingUsers = await db
        .select({
          id: users.id,
          email: users.email,
          userType: users.userType,
          firstName: users.firstName,
          lastName: users.lastName,
          businessName: users.businessName,
          website: users.website,
          instagram: users.instagram,
          creativeDomains: users.creativeDomains,
          phone: users.phone,
          status: users.status,
          originalDataBackup: users.originalDataBackup,
          isAnonymous: users.isAnonymous,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(
          and(
            eq(users.status, "pending"),
            ne(users.userType, "admin"),
            isNotNull(users.phone),
            ne(users.phone, ""),
            isNotNull(users.businessName),
            ne(users.businessName, ""),
            isNotNull(users.website),
            ne(users.website, ""),
            isNotNull(users.instagram),
            ne(users.instagram, ""),
            isNotNull(users.creativeDomains)
          )
        )
        .orderBy(asc(users.createdAt));

      // Enrich with referral code owner details by checking referralUsage table
      // Enrich with referral code owner details by checking referralUsage table
      const enrichedUsers = await Promise.all(
        pendingUsers.map(async (user) => {
          // 1️⃣ Replace email from backup if user is anonymous
          let processedUser = { ...user }; // don't mutate original
          if (processedUser.isAnonymous && processedUser.originalDataBackup) {
            try {
              const backup = JSON.parse(processedUser.originalDataBackup);

              processedUser.email = backup?.email ?? processedUser.email;
              processedUser.phone = backup?.phone ?? processedUser.phone;
              processedUser.website = backup?.website ?? processedUser.website;
              processedUser.instagram = backup?.instagram ?? processedUser.instagram;
              processedUser.businessName = backup?.businessName ?? processedUser.businessName;
              processedUser.firstName = backup?.firstName ?? processedUser.firstName;
              processedUser.lastName = backup?.lastName ?? processedUser.lastName;

            } catch (err) {
              console.error(
                "Failed to parse originalDataBackup for user:",
                processedUser.id,
                err
              );
            }
          }

          // 2️⃣ Find the referral code this user used during signup
          const usageRecord = await db
            .select({
              referralCode: referralUsage.referralCode,
              codeType: referralUsage.codeType,
              codeOwnerId: referralUsage.codeOwnerId,
            })
            .from(referralUsage)
            .where(eq(referralUsage.usedByUserId, processedUser.id))
            .limit(1);

          if (usageRecord.length === 0) {
            return { ...processedUser, referralCodeOwner: null };
          }

          const { referralCode, codeType, codeOwnerId } = usageRecord[0];

          // If it's an admin code
          if (codeType === "admin") {
            return {
              ...processedUser,
              referralCodeOwner: {
                type: "admin",
                code: referralCode,
              },
            };
          }

          // OWNER DETAILS (for user referral codes)
          if (codeType === "user" && codeOwnerId) {
            const codeOwner = await db
              .select({
                id: users.id,
                email: users.email,
                instagram: users.instagram,
                isAnonymous: users.isAnonymous,
                originalDataBackup: users.originalDataBackup,
              })
              .from(users)
              .where(eq(users.id, codeOwnerId))
              .limit(1);

            if (codeOwner.length > 0) {
              let owner = { ...codeOwner[0] };

              // Restore from backup if referral owner was anonymous
              if (owner.isAnonymous && owner.originalDataBackup) {
                try {
                  const backup = JSON.parse(owner.originalDataBackup);

                  owner.email = backup?.email ?? owner.email;
                  owner.instagram = backup?.instagram ?? owner.instagram;

                } catch (err) {
                  console.error("Failed to parse referral owner backup:", owner.id, err);
                }
              }

              return {
                ...processedUser,
                referralCodeOwner: {
                  type: "user",
                  id: owner.id,
                  email: owner.email,
                  instagram: owner.instagram,
                  code: referralCode,
                },
              };
            }
          }

          return { ...processedUser, referralCodeOwner: null };
        })
      );


      return enrichedUsers;
    } catch (error) {
      console.error("Error in getPendingUsers:", error);
      throw new Error(error.message || "Failed to fetch pending users");
    }
  },

  async getApprovedUsers({ page = 1, limit = 10, search = "" }) {
    try {
      const offset = (page - 1) * limit;

      const conditions = [
        eq(users.status, "approved"),
        ne(users.userType, "admin"),
      ];

      if (search) {
        const searchLower = search.toLowerCase();

        conditions.push(
          or(
            sql`LOWER(${users.email}) LIKE ${`%${searchLower}%`}`,
            sql`LOWER(${users.firstName}) LIKE ${`%${searchLower}%`}`,
            sql`LOWER(${users.lastName}) LIKE ${`%${searchLower}%`}`,
            sql`LOWER(${users.businessName}) LIKE ${`%${searchLower}%`}`,
            sql`LOWER(${users.personalReferralCode}) LIKE ${`%${searchLower}%`}`,
            sql`LOWER(${users.originalDataBackup}::text) LIKE ${`%${searchLower}%`}`
          )
        );
      }

      const whereClause = and(...conditions);


      let query = db
        .select({
          id: users.id,
          email: users.email,
          userType: users.userType,
          firstName: users.firstName,
          lastName: users.lastName,
          businessName: users.businessName,
          website: users.website,
          instagram: users.instagram,
          creativeDomains: users.creativeDomains,
          phone: users.phone,
          personalReferralCode: users.personalReferralCode,
          points: users.points,
          status: users.status,
          originalDataBackup: users.originalDataBackup,
          isAnonymous: users.isAnonymous,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(whereClause);



      // Get total count for pagination
      const countQuery = await db
        .select({ count: sql`count(*)` })
        .from(users)
        .where(whereClause);

      const total = parseInt(countQuery[0].count);

      // Get paginated results
      const approvedUsers = await query
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset);

      // Enrich with referral code owner details (code they USED to sign up)
      const enrichedUsers = await Promise.all(
        approvedUsers.map(async (user) => {
          // Clone once to avoid mutation
          let processedUser = { ...user };

          // Restore fields from anonymous backup without mutation
          if (processedUser.isAnonymous && processedUser.originalDataBackup) {
            try {
              const backup = JSON.parse(processedUser.originalDataBackup);

              processedUser.email = backup?.email ?? processedUser.email;
              processedUser.phone = backup?.phone ?? processedUser.phone;
              processedUser.website = backup?.website ?? processedUser.website;
              processedUser.instagram = backup?.instagram ?? processedUser.instagram;
              processedUser.businessName = backup?.businessName ?? processedUser.businessName;
              processedUser.firstName = backup?.firstName ?? processedUser.firstName;
              processedUser.lastName = backup?.lastName ?? processedUser.lastName;

            } catch (err) {
              console.error("Failed to parse originalDataBackup:", processedUser.id, err);
            }
          }

          // Get referral usage info
          const usageRecord = await db
            .select({
              referralCode: referralUsage.referralCode,
              codeType: referralUsage.codeType,
              codeOwnerId: referralUsage.codeOwnerId,
            })
            .from(referralUsage)
            .where(eq(referralUsage.usedByUserId, processedUser.id))
            .limit(1);

          if (usageRecord.length === 0) {
            return { ...processedUser, referralCodeOwner: null };
          }

          const { referralCode, codeType, codeOwnerId } = usageRecord[0];

          // Admin code
          if (codeType === "admin") {
            return {
              ...processedUser,
              referralCodeOwner: {
                type: "admin",
                code: referralCode,
              },
            };
          }

          // User referral code
          if (codeType === "user" && codeOwnerId) {
            const codeOwnerResult = await db
              .select({
                id: users.id,
                email: users.email,
                instagram: users.instagram,
                isAnonymous: users.isAnonymous,
                originalDataBackup: users.originalDataBackup,
              })
              .from(users)
              .where(eq(users.id, codeOwnerId))
              .limit(1);

            if (codeOwnerResult.length > 0) {
              let owner = { ...codeOwnerResult[0] };

              // Restore referral owner backup safely
              if (owner.isAnonymous && owner.originalDataBackup) {
                try {
                  const backup = JSON.parse(owner.originalDataBackup);

                  owner.email = backup?.email ?? owner.email;
                  owner.instagram = backup?.instagram ?? owner.instagram;

                } catch (err) {
                  console.error("Failed to parse referral owner backup:", owner.id, err);
                }
              }

              return {
                ...processedUser,
                referralCodeOwner: {
                  type: "user",
                  id: owner.id,
                  email: owner.email,
                  instagram: owner.instagram,
                  code: referralCode,
                },
              };
            }
          }

          return { ...processedUser, referralCodeOwner: null };
        })
      );



      return {
        data: enrichedUsers,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      throw new Error(error.message || "Failed to fetch approved users");
    }
  },

  async getRejectedUsers({
    page = 1,
    limit = 10,
    search = "",
    status = "all",
  }) {
    try {
      const offset = (page - 1) * limit;
      const conditions = [
        ne(users.userType, "admin"),
      ];

      if (status === "rejected") {
        conditions.push(eq(users.status, "rejected"));
      } else if (status === "referral_rejected") {
        conditions.push(eq(users.status, "referral_rejected"));
      } else {
        conditions.push(
          or(
            eq(users.status, "rejected"),
            eq(users.status, "referral_rejected")
          )
        );
      }


      // Add search conditions if search term provided
      if (search) {
        const searchLower = search.toLowerCase();

        conditions.push(
          or(
            sql`LOWER(${users.email}) LIKE ${`%${searchLower}%`}`,
            sql`LOWER(${users.firstName}) LIKE ${`%${searchLower}%`}`,
            sql`LOWER(${users.lastName}) LIKE ${`%${searchLower}%`}`,
            sql`LOWER(${users.businessName}) LIKE ${`%${searchLower}%`}`,
            sql`LOWER(${users.personalReferralCode}) LIKE ${`%${searchLower}%`}`,
            sql`LOWER(${users.originalDataBackup}::text) LIKE ${`%${searchLower}%`}`
          )
        );
      }

      const whereClause = and(...conditions);


       let query = db
        .select({
          id: users.id,
          email: users.email,
          userType: users.userType,
          firstName: users.firstName,
          lastName: users.lastName,
          businessName: users.businessName,
          website: users.website,
          instagram: users.instagram,
          creativeDomains: users.creativeDomains,
          phone: users.phone,
          personalReferralCode: users.personalReferralCode,
          points: users.points,
          status: users.status,
          originalDataBackup: users.originalDataBackup,
          isAnonymous: users.isAnonymous,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(whereClause);



      // Get total count for pagination
      const countQuery = await db
        .select({ count: sql`count(*)` })
        .from(users)
        .where(whereClause);

      const total = parseInt(countQuery[0].count);

      // Get paginated results
      const rejectedUsers = await query
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset);

      // Enrich with referral code owner details (code they USED to sign up)
      // Enrich with referral code owner details (code they USED to sign up)
      const enrichedUsers = await Promise.all(
        rejectedUsers.map(async (user) => {
          // 1️⃣ Replace email from backup if user is anonymous
          let processedUser = { ...user }; // don't mutate original

          if (processedUser.isAnonymous && processedUser.originalDataBackup) {
            try {
              const backup = JSON.parse(processedUser.originalDataBackup);

              processedUser.email = backup?.email ?? processedUser.email;
              processedUser.phone = backup?.phone ?? processedUser.phone;
              processedUser.website = backup?.website ?? processedUser.website;
              processedUser.instagram = backup?.instagram ?? processedUser.instagram;
              processedUser.businessName = backup?.businessName ?? processedUser.businessName;
              processedUser.firstName = backup?.firstName ?? processedUser.firstName;
              processedUser.lastName = backup?.lastName ?? processedUser.lastName;

            } catch (err) {
              console.error(
                "Failed to parse originalDataBackup for user:",
                processedUser.id,
                err
              );
            }
          }

          // Find the referral code this user used during signup
          const usageRecord = await db
            .select({
              referralCode: referralUsage.referralCode,
              codeType: referralUsage.codeType,
              codeOwnerId: referralUsage.codeOwnerId,
            })
            .from(referralUsage)
            .where(eq(referralUsage.usedByUserId, processedUser.id))
            .limit(1);

          if (usageRecord.length === 0) {
            return { ...processedUser, referralCodeOwner: null };
          }

          const { referralCode, codeType, codeOwnerId } = usageRecord[0];

          // If it's an admin code
          if (codeType === "admin") {
            return {
              ...processedUser,
              referralCodeOwner: {
                type: "admin",
                code: referralCode,
              },
            };
          }

          if (codeType === "user" && codeOwnerId) {
            const codeOwner = await db
              .select({
                id: users.id,
                email: users.email,
                instagram: users.instagram,
                isAnonymous: users.isAnonymous,
                originalDataBackup: users.originalDataBackup,
              })
              .from(users)
              .where(eq(users.id, codeOwnerId))
              .limit(1);

            if (codeOwner.length > 0) {
              let owner = { ...codeOwner[0] };

              // Restore original backup if owner is anonymous
              if (owner.isAnonymous && owner.originalDataBackup) {
                try {
                  const backup = JSON.parse(owner.originalDataBackup);

                  owner.email = backup?.email ?? owner.email;
                  owner.instagram = backup?.instagram ?? owner.instagram;
                } catch (err) {
                  console.error("Failed to parse owner backup:", owner.id, err);
                }
              }

              return {
                ...processedUser,
                referralCodeOwner: {
                  type: "user",
                  id: owner.id,
                  email: owner.email,
                  instagram: owner.instagram,
                  code: referralCode,
                },
              };
            }
          }

          return { ...processedUser, referralCodeOwner: null };
        })
      );


      return {
        data: enrichedUsers,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      throw new Error(error.message || "Failed to fetch rejected users");
    }
  },

  async getUserReferralUsage({ userId, page = 1, limit = 50 }) {
    try {
      const offset = (page - 1) * limit;

      // Get user's personal referral code
      const user = await db
        .select({ personalReferralCode: users.personalReferralCode })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user || !user[0]) {
        throw new Error("User not found");
      }

      const userCode = user[0].personalReferralCode;

      if (!userCode) {
        return {
          data: [],
          pagination: {
            page,
            limit,
            total: 0,
            pages: 0,
          },
        };
      }

      // Get total count
      const countQuery = await db
        .select({ count: sql`count(*)` })
        .from(referralUsage)
        .where(eq(referralUsage.referralCode, userCode));

      const total = parseInt(countQuery[0].count);

      // Get usage data with user information
      const usageData = await db
        .select({
          id: referralUsage.id,
          referralCode: referralUsage.referralCode,
          codeType: referralUsage.codeType,
          usedByUserId: referralUsage.usedByUserId,
          pointsToUser: referralUsage.pointsToUser,
          pointsToCodeOwner: referralUsage.pointsToCodeOwner,
          pointsToAdmin: referralUsage.pointsToAdmin,
          referralLevel: referralUsage.referralLevel,
          usedAt: referralUsage.usedAt,
          user: {
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
            isAnonymous: users.isAnonymous,
            originalDataBackup: users.originalDataBackup,
          },
        })
        .from(referralUsage)
        .leftJoin(users, eq(referralUsage.usedByUserId, users.id))
        .where(eq(referralUsage.referralCode, userCode))
        .orderBy(desc(referralUsage.usedAt))
        .limit(limit)
        .offset(offset);

      const processedUsage = usageData.map((item) => {
        const u = item.user;
        if (u?.isAnonymous && u?.originalDataBackup) {
          try {
            const backup = JSON.parse(u.originalDataBackup);
            if (backup?.email) {
              u.email = backup.email; // replace email from backup
            }
          } catch (e) {
            console.error("Failed to parse originalDataBackup for user:", u.id);
          }
        }
        return item;
      });

      return {
        data: processedUsage,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      throw new Error(error.message || "Failed to fetch referral usage");
    }
  },

  async getAllUsersWithStatus() {
    try {
      const allUsers = await db
        .select({
          id: users.id,
          email: users.email,
          userType: users.userType,
          firstName: users.firstName,
          lastName: users.lastName,
          businessName: users.businessName,
          website: users.website,
          instagram: users.instagram,
          creativeDomains: users.creativeDomains,
          phone: users.phone,
          status: users.status,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(inArray(users.userType, ["creative", "business"]))
        .orderBy(users.createdAt);

      return allUsers;
    } catch (error) {
      throw new Error(error.message || "Failed to fetch users");
    }
  },

  async approveUser(userId) {
    try {
      const [updatedUser] = await db
        .update(users)
        .set({
          status: "approved",
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();

      if (!updatedUser) {
        throw new Error("User not found");
      }

      return updatedUser;
    } catch (error) {
      throw new Error(error.message || "Failed to approve user");
    }
  },

  // Reject a user
  async rejectUser(userId) {
    try {
      const [updatedUser] = await db
        .update(users)
        .set({
          status: "rejected",
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();

      if (!updatedUser) {
        throw new Error("User not found");
      }

      return updatedUser;
    } catch (error) {
      throw new Error(error.message || "Failed to reject user");
    }
  },

  // Bulk approve/reject users
  async bulkUpdateUserStatus(userIds, status) {
    try {
      if (!["approved", "rejected"].includes(status)) {
        throw new Error("Invalid status. Must be 'approved' or 'rejected'");
      }

      const updatedUsers = await db
        .update(users)
        .set({
          status,
          updatedAt: new Date(),
        })
        .where(inArray(users.id, userIds))
        .returning();

      return updatedUsers;
    } catch (error) {
      throw new Error(error.message || "Failed to bulk update user status");
    }
  },

  // Get user status
  async getUserStatus(userId) {
    try {
      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          status: users.status,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        throw new Error("User not found");
      }

      return user;
    } catch (error) {
      throw new Error(error.message || "Failed to get user status");
    }
  },
};

module.exports = AdminService;
