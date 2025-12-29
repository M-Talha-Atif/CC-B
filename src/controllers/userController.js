const { db } = require("../config/database");
const { users, adminReferralCodes } = require("../models/schema");
const { eq, desc, count, sql, and, ne, or, lt } = require("drizzle-orm");
const AnonymousService = require("../services/anonService");

const UserController = {
  // Fixed getUserRank method
  async getUserRank(req, res) {
    try {
      const userId = req.user.id;

      // Use userData from middleware (already decrypted if anonymous)
      const currentUser =
        req.userData || (await AnonymousService.getUserData(userId));

      if (!currentUser) {
        return res.status(404).json({ error: "User not found" });
      }

      const userPoints = parseFloat(currentUser.points);
      const userType = currentUser.userType;
      const userCreatedAt = currentUser.createdAt;

      // Count users ranked higher (more points OR same points but registered earlier)
      // Exclude admin users
      const [rankData] = await db
        .select({
          usersRankedHigher: count(users.id),
        })
        .from(users)
        .where(
          and(
            eq(users.userType, userType),
            ne(users.userType, "admin"),
            or(
              // Case 1: Users with more points
              sql`CAST(${users.points} AS DECIMAL) > ${userPoints}`,
              // Case 2: Same points but registered earlier (FIRST COME FIRST SERVE)
              and(
                sql`CAST(${users.points} AS DECIMAL) = ${userPoints}`,
                lt(users.createdAt, userCreatedAt) //  Drizzle's lt() operator
              )
            )
          )
        );

      // Get total number of users (same userType only, excluding admins)
      const [totalUsers] = await db
        .select({
          total: count(users.id),
        })
        .from(users)
        .where(
          and(
            eq(users.userType, userType),
            ne(users.userType, "admin")
          )
        );

      const rank = rankData.usersRankedHigher + 1;
      const totalUserCount = totalUsers.total;

      // Calculate percentile
      const percentile =
        totalUserCount > 1
          ? Math.round(((totalUserCount - rank) / (totalUserCount - 1)) * 100)
          : 100;

      // Determine rank tier
      let tier = "Bronze";
      if (percentile >= 90) tier = "Diamond";
      else if (percentile >= 75) tier = "Platinum";
      else if (percentile >= 50) tier = "Gold";
      else if (percentile >= 25) tier = "Silver";

      res.json({
        rank,
        totalUsers: totalUserCount,
        points: userPoints,
        percentile,
        tier,
        userType,
        message: `You are ranked #${rank} out of ${totalUserCount} ${userType} users`,
      });
    } catch (error) {
      console.error("Error fetching user rank:", error);
      res.status(500).json({ error: "Failed to fetch user rank" });
    }
  }
,
  // Fixed getAssignedReferralCode method
  async getAssignedReferralCode(req, res) {
    try {
      const userId = req.user.id;

      // Use userData from middleware
      const currentUser =
        req.userData || (await AnonymousService.getUserData(userId));

      if (!currentUser) {
        return res.status(404).json({ error: "User not found" });
      }

      let assignedCodeDetails = null;

      if (currentUser.assignedReferralCode) {
        // Get details of the assigned admin code
        const [adminCode] = await db
          .select({
            code: adminReferralCodes.code,
            description: adminReferralCodes.description,
            isActive: adminReferralCodes.isActive,
            assignedAt: adminReferralCodes.assignedAt,
            maxUsages: adminReferralCodes.maxUsages,
            currentUsages: adminReferralCodes.currentUsages,
          })
          .from(adminReferralCodes)
          .where(eq(adminReferralCodes.code, currentUser.assignedReferralCode))
          .limit(1);

        if (adminCode) {
          assignedCodeDetails = {
            ...adminCode,
            usagesRemaining: adminCode.maxUsages
              ? adminCode.maxUsages - adminCode.currentUsages
              : "Unlimited",
          };
        }
      }

      res.json({
        personalReferralCode: currentUser.personalReferralCode,
        assignedReferralCode: currentUser.assignedReferralCode,
        assignedCodeDetails,
        message: currentUser.assignedReferralCode
          ? "You have an assigned referral code"
          : "No referral code assigned",
      });
    } catch (error) {
      console.error("Error fetching referral code:", error);
      res.status(500).json({ error: "Failed to fetch referral code" });
    }
  },

  // Fixed getUserPoints method
  async getUserPoints(req, res) {
    try {
      const userId = req.user.id;

      // Use userData from middleware
      const currentUser =
        req.userData || (await AnonymousService.getUserData(userId));

      if (!currentUser) {
        return res.status(404).json({ error: "User not found" });
      }

      // Return user data in format frontend expects
      const userResponse = {
        id: currentUser.id,
        points: currentUser.points,
        // Include other fields frontend might need
        userType: currentUser.userType,
        personalReferralCode: currentUser.personalReferralCode,
      };

      res.json({
        user: userResponse,
        points: currentUser.points, // Also include points directly for backward compatibility
      });
    } catch (error) {
      console.error("Error fetching user points:", error);
      res.status(500).json({ error: "Failed to fetch user points" });
    }
  },

  async getProfile(req, res) {
    try {
      const userId = req.user.id;

      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          userType: users.userType,
          firstName: users.firstName,
          lastName: users.lastName,
          profilePicture: users.profilePicture,
          businessName: users.businessName,
          website: users.website,
          instagram: users.instagram,
          creativeDomains: users.creativeDomains,
          phone: users.phone,
          points: users.points,
          personalReferralCode: users.personalReferralCode,
          assignedReferralCode: users.assignedReferralCode,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ user });
    } catch (error) {
      console.error("Error fetching user profile:", error);
      res.status(500).json({ error: "Failed to fetch user profile" });
    }
  },
};

module.exports = UserController;
