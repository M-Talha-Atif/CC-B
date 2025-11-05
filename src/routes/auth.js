const express = require("express");
const {
  validateRegistration,
  validateLogin,
  validateReferralCode,
  validatePhoneNumber,
  validateOTP,
} = require("../middleware/validation");
const authController = require("../controllers/authController");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Auth routes for creative registration flow
router.post("/register", validateRegistration, authController.register);
router.post("/login", validateLogin, authController.login);
router.post("/check-email", authController.checkEmailExists);
router.post("/google-login-creative", authController.googleLoginCreative);
router.post("/google-login-couple", authController.googleLoginCouple);
router.post("/instagram/exchange-token", authController.exchangeInstagramToken);
router.get("/check-status", authenticateToken, authController.checkUserStatus);

router.post("/send-verification-email", authController.sendVerificationEmail);
router.get("/verify-email/:token", authController.verifyEmailToken);
router.get(
  "/check-email-verification",
  authenticateToken,
  authController.checkEmailVerificationStatus
);
router.post(
  "/resend-verification-email",
  authController.resendVerificationEmail
);

router.get(
  "/onboarding/progress",
  authenticateToken,
  authController.getUserWithProgress
);

router.post(
  "/onboarding/update-progress",
  authenticateToken,
  authController.updateProgress
);

router.get(
  "/onboarding/next-step",
  authenticateToken,
  authController.getNextStep
);

router.post(
  "/onboarding/reset",
  authenticateToken,
  authController.resetProgress
);

router.post(
  "/verify-referral",
  authenticateToken,
  validateReferralCode,
  authController.verifyReferralCode
);

router.post(
  "/verify-phone",
  authenticateToken,
  validatePhoneNumber,
  authController.sendOTP
);
router.post(
  "/store-phone",
  authenticateToken,
  validatePhoneNumber,
  authController.storePhone
);
router.post(
  "/verify-otp",
  authenticateToken,
  validateOTP,
  authController.verifyOTP
);
router.post(
  "/complete-profile",
  authenticateToken,
  authController.completeProfile
);

router.post("/forgot-password", authController.forgotPassword);

// Reset password route
router.post("/reset-password", authController.resetPassword);

// Verify reset token route (optional - for checking if token is valid)
router.get("/verify-reset-token/:token", authController.verifyResetToken);

// Utility routes
router.post("/refresh-token", authController.refreshToken);
router.post("/logout", authenticateToken, authController.logout);
router.get("/me", authenticateToken, authController.getProfile);

module.exports = router;
