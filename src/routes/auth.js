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
const rateLimit = require("express-rate-limit");



const router = express.Router();

// Rate limiter for login and signup only
const loginRegisterLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // 10 attempts per IP
  message: "Too many login/signup attempts, please try again later.",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false,   // Disable the old `X-RateLimit-*` headers
  keyGenerator: (req) => {
    console.log("Rate limit IP:", req.ip); // Debug IP
    return req.ip; // Use IP as key
  },
});

// Auth routes for creative registration flow
// Apply it only to these routes
router.post("/register", loginRegisterLimiter, validateRegistration, authController.register);
router.post("/login", loginRegisterLimiter, validateLogin, authController.login);

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

// verify instagram exists or not
router.post("/check-instagram", authenticateToken, authController.checkInstagram);

module.exports = router;
