const express = require("express");
const adminController = require("../controllers/adminController");
const { authenticateToken } = require("../middleware/auth");
// const {
//   validateCreateReferralCode,
//   validateAssignReferralCode,
//   validateReferralCodeUpdate
// } = require('../middleware/validation');

const router = express.Router();

// All admin routes require authentication and admin role
router.use(authenticateToken);
// router.use(requireAdmin);

// Referral code management
router.post("/referral-codes", adminController.createReferralCode);
router.get("/referral-codes", adminController.getReferralCodes);
router.get("/referral-codes/:id", adminController.getReferralCodeById);
router.put("/referral-codes/:id", adminController.updateReferralCode);
router.delete("/referral-codes/:id", adminController.deleteReferralCode);

// Assign referral codes to users
router.post("/referral-codes/:id/assign", adminController.assignReferralCode);
router.post(
  "/referral-codes/:id/unassign",
  adminController.unassignReferralCode
);

// Analytics and reporting
router.get("/referral-analytics", adminController.getReferralAnalytics);
router.get("/referral-usage", adminController.getReferralUsage);
router.get("/points-leaderboard", adminController.getPointsLeaderboard);
router.get(
  "/user-referral-stats/:userId",
  adminController.getUserReferralStats
);

// User management
router.get("/users", adminController.getUsers);
router.get("/users/:id", adminController.getUserById);
router.put("/users/:id/points", adminController.updateUserPoints);
router.get("/users/:id/points-history", adminController.getUserPointsHistory);

// Bulk operations
router.post(
  "/referral-codes/bulk-create",
  adminController.bulkCreateReferralCodes
);

router.post(
  "/referral-codes/bulk-assign",
  adminController.bulkAssignReferralCodes
);

router.get("/pending/users", adminController.getPendingUsers);

router.get("/approved/users", adminController.getApprovedUsers);

router.get("/rejected-users", adminController.getRejectedUsers);

router.get(
  "/users/:userId/referral-usage",
  adminController.getUserReferralUsage
);
// Get all users with status
router.get("/users/status/all", adminController.getAllUsersWithStatus);
// Approve user
router.patch("/users/:userId/approve", adminController.approveUser);
// Reject user
router.patch("/users/:userId/reject", adminController.rejectUser);
// Bulk update user status
router.patch("/users/bulk-update-status", adminController.bulkUpdateUserStatus);

router.delete("/users/delete/:id", adminController.deleteUser);

module.exports = router;
