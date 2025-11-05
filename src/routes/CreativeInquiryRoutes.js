const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth"); // Your auth middleware
const CreativeInquiryController = require("../controllers/CreativeInquiryController");

// Protected routes (require authentication)
router.post(
  "/create",
  authenticateToken,
  CreativeInquiryController.createInquiryWithPayment
);
router.post(
  "/store-chat",
  authenticateToken,
  CreativeInquiryController.storeChatData
);

router.post(
  "/payment",
  authenticateToken,
  CreativeInquiryController.createPaymentSession
);

router.get(
  "/check-completed",
  authenticateToken,
  CreativeInquiryController.checkUserCompletedInquiries
);
router.get(
  "/payment/success",
  authenticateToken,
  CreativeInquiryController.handlePaymentSuccess
);
router.get(
  "/payment/cancel",
  authenticateToken,
  CreativeInquiryController.handlePaymentCancel
);
router.get(
  "/user-inquiries",
  authenticateToken,
  CreativeInquiryController.getUserInquiries
);
router.get(
  "/:inquiryId",
  authenticateToken,
  CreativeInquiryController.getInquiryDetails
);

// Webhook route (no auth required, but needs raw body)
router.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  CreativeInquiryController.handleStripeWebhook
);

module.exports = router;
