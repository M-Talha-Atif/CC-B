const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const { authenticateToken } = require("../middleware/auth");

router.use(authenticateToken);

// Get user rank based on points
router.get("/rank", userController.getUserRank);

router.get("/points", userController.getUserPoints);
// Get user's assigned referral code
router.get("/referral-code", userController.getAssignedReferralCode);

// Get user profile
router.get("/profile", userController.getProfile);

module.exports = router;
