const { creativeInquiries, users } = require("../models/schema");
const { db } = require("../config/database");
const { eq, and, desc } = require("drizzle-orm");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const emailService = require("../services/emailService"); // Add this import

const createOrRetrieveStripeCustomer = async (user) => {
  try {
    // First, check if user already has a Stripe customer ID stored
    if (user.stripeCustomerId) {
      try {
        // Verify the customer still exists in Stripe
        const customer = await stripe.customers.retrieve(user.stripeCustomerId);
        if (customer && !customer.deleted) {
          return customer;
        }
      } catch (error) {
        console.log("Stored Stripe customer not found, creating new one");
      }
    }

    // Create new Stripe customer
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.firstName
        ? `${user.firstName} ${user.lastName || ""}`.trim()
        : user.name,
      metadata: {
        userId: user.id.toString(),
        signupDate: user.createdAt
          ? user.createdAt.toISOString()
          : new Date().toISOString(),
        userType: "creative_inquiry_customer",
      },
      // Optional: Add phone number if available
      ...(user.phone && { phone: user.phone }),
    });

    // Store the Stripe customer ID in your database
    await db
      .update(users)
      .set({
        stripeCustomerId: customer.id,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    return customer;
  } catch (error) {
    console.error("Error creating/retrieving Stripe customer:", error);
    throw error;
  }
};

const CreativeInquiryController = {
  async createInquiryWithPayment(req, res) {
    try {
      const userId = req.user.id;
      const { creativeDomain, selectedService, proposalCount } = req.body;

      // Validate required fields (only basic selection data)
      if (!creativeDomain || !selectedService || !proposalCount) {
        return res.status(400).json({
          success: false,
          message: "Creative domain, service, and proposal count are required",
        });
      }

      // Calculate total amount based on proposal count
      const pricingMap = {
        5: 8.0,
        15: 17.0,
        25: 28.0,
      };

      const totalAmount = pricingMap[proposalCount];
      if (!totalAmount) {
        return res.status(400).json({
          success: false,
          message: "Invalid proposal count",
        });
      }

      // Create the inquiry record with placeholder data
      const inquiryData = {
        userId,
        creativeDomain: creativeDomain[0] || creativeDomain,
        selectedService,
        proposalCount,
        totalAmount: totalAmount.toString(),
        location: "TBD", // Placeholder
        weddingDate: "01/01/2025", // Placeholder
        budget: "$1000", // Placeholder
        guestCount: 1, // Placeholder
        chatMessages: [], // Empty initially
        status: "draft",
      };

      const [inquiry] = await db
        .insert(creativeInquiries)
        .values(inquiryData)
        .returning();

      // Get user data for Stripe
      const [user] = await db.select().from(users).where(eq(users.id, userId));

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Create or retrieve Stripe customer
      const stripeCustomer = await createOrRetrieveStripeCustomer(user);

      // Helper function to extract creative type from service
      const getCreativeType = (service) => {
        if (service.includes("photography")) return "photographers";
        if (service.includes("videography")) return "videographers";
        if (service.includes("florist")) return "florists";
        if (service.includes("planner")) return "planners";
        return "creatives";
      };

      // Helper function to extract event type from service
      const getEventType = (service) => {
        if (service.includes("engagement and wedding"))
          return "engagement and wedding";
        if (service.includes("engagement")) return "engagement";
        if (service.includes("elopement")) return "elopement";
        if (service.includes("multi-day wedding")) return "multi-day wedding";
        if (service.includes("wedding")) return "wedding";
        return "event";
      };

      const creativeType = getCreativeType(inquiry.selectedService);
      const eventType = getEventType(inquiry.selectedService);

      // Create enhanced product description
      const productDescription = `Review ${inquiry.proposalCount} proposals from ${creativeType} for your ${eventType}`;

      // Create Stripe checkout session with customer ID
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `${inquiry.proposalCount} Creative Proposals`,
                description: productDescription,
                images: ["https://cunocovo.net/sms-icon.jpg"],
              },
              unit_amount: Math.round(totalAmount * 100), // Convert to cents
            },
            quantity: 1,
          },
        ],
        mode: "payment",

        // Use customer ID instead of customer_email
        customer: stripeCustomer.id,

        success_url: `${process.env.FRONTEND_URL}/find-creative/chat?session_id={CHECKOUT_SESSION_ID}&inquiry_id=${inquiry.id}`,
        cancel_url: `${process.env.FRONTEND_URL}/find-creative?inquiry_id=${inquiry.id}`,

        // Enhanced branding and customization
        billing_address_collection: "auto",

        // Save payment method to customer for future use
        payment_intent_data: {
          setup_future_usage: "on_session",
        },

        // Custom checkout page styling
        custom_text: {
          submit: {
            message: "Complete your purchase to connect with creatives",
          },
        },

        metadata: {
          inquiryId: inquiry.id,
          userId: userId,
          proposalCount: inquiry.proposalCount.toString(),
          creativeDomain: inquiry.creativeDomain,
          serviceDescription: productDescription,
          userEmail: user.email,
          userName: user.firstName || user.name || "Customer",
          creativeType: creativeType,
          eventType: eventType,
          stripeCustomerId: stripeCustomer.id, // Add customer ID to metadata
        },

        // Set expiration to 23 hours 50 minutes (safely under 24 hour limit)
        expires_at: Math.floor(Date.now() / 1000) + 23 * 60 * 60 + 50 * 60,
      });

      // Update inquiry with both Stripe session ID and customer ID
      await db
        .update(creativeInquiries)
        .set({
          stripeSessionId: session.id,
          stripeCustomerId: stripeCustomer.id,
          status: "payment_pending",
          updatedAt: new Date(),
        })
        .where(eq(creativeInquiries.id, inquiry.id));

      res.json({
        success: true,
        data: {
          inquiryId: inquiry.id,
          checkoutUrl: session.url,
          sessionId: session.id,
          totalAmount,
          description: productDescription,
        },
      });
    } catch (error) {
      console.error("Error creating inquiry with payment:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  },

  async createPaymentSession(req, res) {
    try {
      const userId = req.user.id;
      const { inquiryId } = req.body;

      if (!inquiryId) {
        return res.status(400).json({
          success: false,
          message: "Inquiry ID is required",
        });
      }

      // Get inquiry and user data
      const [inquiry] = await db
        .select()
        .from(creativeInquiries)
        .where(
          and(
            eq(creativeInquiries.id, inquiryId),
            eq(creativeInquiries.userId, userId)
          )
        );

      const [user] = await db.select().from(users).where(eq(users.id, userId));

      if (!inquiry) {
        return res.status(404).json({
          success: false,
          message: "Inquiry not found or unauthorized",
        });
      }

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Create or retrieve Stripe customer
      const stripeCustomer = await createOrRetrieveStripeCustomer(user);

      // Calculate total amount
      const pricingMap = { 5: 8.0, 15: 17.0, 25: 28.0 };
      const totalAmount = pricingMap[inquiry.proposalCount];

      if (!totalAmount) {
        return res.status(400).json({
          success: false,
          message: "Invalid proposal count in inquiry",
        });
      }

      // Helper functions (same as above)
      const getCreativeType = (service) => {
        if (service.includes("photography")) return "photographers";
        if (service.includes("videography")) return "videographers";
        if (service.includes("florist")) return "florists";
        if (service.includes("planner")) return "planners";
        return "creatives";
      };

      const getEventType = (service) => {
        if (service.includes("engagement and wedding"))
          return "engagement and wedding";
        if (service.includes("engagement")) return "engagement";
        if (service.includes("elopement")) return "elopement";
        if (service.includes("multi-day wedding")) return "multi-day wedding";
        if (service.includes("wedding")) return "wedding";
        return "event";
      };

      const creativeType = getCreativeType(inquiry.selectedService);
      const eventType = getEventType(inquiry.selectedService);

      // Create Stripe checkout session with customer ID
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `${inquiry.proposalCount} Creative Proposals`,
                description: `Get ${inquiry.proposalCount} proposals for ${inquiry.selectedService} in ${inquiry.location}`,
                images: [process.env.FRONTEND_URL + "/sms-icon.jpg"],
              },
              unit_amount: Math.round(totalAmount * 100), // Convert to cents
            },
            quantity: 1,
          },
        ],
        mode: "payment",

        // Use customer ID instead of customer_email
        customer: stripeCustomer.id,

        success_url: `http://localhost:3001/find-creative/chat?session_id={CHECKOUT_SESSION_ID}&inquiry_id=${inquiry.id}`,
        cancel_url: `${process.env.FRONTEND_URL}/find-creative?inquiry_id=${inquiry.id}`,

        // Save payment method for future use
        payment_intent_data: {
          setup_future_usage: "on_session",
        },

        metadata: {
          inquiryId: inquiry.id,
          userId: userId,
          proposalCount: inquiry.proposalCount.toString(),
          creativeDomain: inquiry.creativeDomain,
          userEmail: user.email,
          userName: user.firstName || user.name || "Customer",
          creativeType: creativeType,
          eventType: eventType,
          stripeCustomerId: stripeCustomer.id,
        },
        // Set expiration to 23 hours 50 minutes (safely under 24 hour limit)
        expires_at: Math.floor(Date.now() / 1000) + 23 * 60 * 60 + 50 * 60,
      });

      // Update inquiry with Stripe session ID and customer ID
      await db
        .update(creativeInquiries)
        .set({
          stripeSessionId: session.id,
          stripeCustomerId: stripeCustomer.id,
          status: "payment_pending",
          updatedAt: new Date(),
        })
        .where(eq(creativeInquiries.id, inquiry.id));

      res.json({
        success: true,
        data: {
          checkoutUrl: session.url,
          sessionId: session.id,
        },
      });
    } catch (error) {
      console.error("Error creating payment session:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  },

  async storeChatData(req, res) {
    try {
      const userId = req.user.id;
      const {
        inquiryId,
        chatMessages,
        location,
        weddingDate,
        budget,
        guestCount,
      } = req.body;

      if (!inquiryId) {
        return res.status(400).json({
          success: false,
          message: "Inquiry ID is required",
        });
      }

      // Verify the inquiry belongs to the user and has been paid
      const [inquiry] = await db
        .select()
        .from(creativeInquiries)
        .where(
          and(
            eq(creativeInquiries.id, inquiryId),
            eq(creativeInquiries.userId, userId)
          )
        );

      if (!inquiry) {
        return res.status(404).json({
          success: false,
          message: "Inquiry not found or unauthorized",
        });
      }

      // Check if payment has been completed
      if (inquiry.paymentStatus !== "completed" && inquiry.status !== "paid") {
        return res.status(400).json({
          success: false,
          message: "Payment must be completed before storing chat data",
        });
      }

      // Update inquiry with complete information and chat messages
      await db
        .update(creativeInquiries)
        .set({
          location: location || inquiry.location,
          weddingDate: weddingDate || inquiry.weddingDate,
          budget: budget || inquiry.budget,
          guestCount: guestCount ? parseInt(guestCount) : inquiry.guestCount,
          chatMessages: chatMessages || [],
          status: "processing", // Move to processing status
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(creativeInquiries.id, inquiryId));

      // TODO: Trigger creative matching process here
      // This could initiate the process to find and notify creatives

      res.json({
        success: true,
        message: "Chat data stored successfully",
        data: {
          inquiryId,
          status: "processing",
        },
      });
    } catch (error) {
      console.error("Error storing chat data:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  },

  async handlePaymentSuccess(req, res) {
    try {
      const { session_id, inquiry_id } = req.query;
      const userId = req.user.id;

      if (!session_id || !inquiry_id) {
        return res.status(400).json({
          success: false,
          message: "Missing session ID or inquiry ID",
        });
      }

      // Verify the inquiry belongs to the user
      const [inquiry] = await db
        .select()
        .from(creativeInquiries)
        .where(
          and(
            eq(creativeInquiries.id, inquiry_id),
            eq(creativeInquiries.userId, userId)
          )
        );

      if (!inquiry) {
        return res.status(404).json({
          success: false,
          message: "Inquiry not found or unauthorized",
        });
      }

      // Get user data
      const [user] = await db.select().from(users).where(eq(users.id, userId));

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Retrieve and verify the checkout session from Stripe
      const session = await stripe.checkout.sessions.retrieve(session_id);

      if (session.payment_status !== "paid") {
        return res.status(400).json({
          success: false,
          message: "Payment not completed",
        });
      }

      // Verify session belongs to this inquiry
      if (session.metadata.inquiryId !== inquiry_id) {
        return res.status(400).json({
          success: false,
          message: "Session does not match inquiry",
        });
      }

      // Update inquiry payment status
      await db
        .update(creativeInquiries)
        .set({
          paymentStatus: "completed",
          status: "paid",
          paidAt: new Date(),
          stripePaymentIntentId: session.payment_intent,
          updatedAt: new Date(),
        })
        .where(eq(creativeInquiries.id, inquiry_id));

      // Send payment success receipt email
      try {
        const paymentDetails = {
          inquiryId: inquiry_id,
          totalAmount: parseFloat(inquiry.totalAmount),
          proposalCount: inquiry.proposalCount,
          creativeType: session.metadata.creativeType || "creatives",
          eventType: session.metadata.eventType || "event",
          sessionId: session_id,
        };

        await emailService.sendPaymentReceiptEmail(
          user.email,
          user.firstName || user.name || "Customer",
          paymentDetails
        );

        console.log("Payment receipt email sent successfully");
      } catch (emailError) {
        console.error("Failed to send payment receipt email:", emailError);
        // Don't fail the request if email fails - payment was successful
      }

      res.json({
        success: true,
        data: {
          inquiryId: inquiry_id,
          status: "paid",
          message: "Payment verified successfully",
        },
      });
    } catch (error) {
      console.error("Error handling payment success:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
        error:
          process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }
  },

  // Get user's inquiries
  async getUserInquiries(req, res) {
    try {
      const userId = req.user.id;
      const { status, limit = 20, offset = 0 } = req.query;

      let query = db
        .select()
        .from(creativeInquiries)
        .where(eq(creativeInquiries.userId, userId))
        .orderBy(desc(creativeInquiries.createdAt));

      if (status) {
        query = query.where(
          and(
            eq(creativeInquiries.userId, userId),
            eq(creativeInquiries.status, status)
          )
        );
      }

      const inquiries = await query
        .limit(parseInt(limit))
        .offset(parseInt(offset));

      res.json({
        success: true,
        data: inquiries,
      });
    } catch (error) {
      console.error("Error fetching user inquiries:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  },

  // Get single inquiry details
  async getInquiryDetails(req, res) {
    try {
      const userId = req.user.id;
      const { inquiryId } = req.params;

      const [inquiry] = await db
        .select()
        .from(creativeInquiries)
        .where(
          and(
            eq(creativeInquiries.id, inquiryId),
            eq(creativeInquiries.userId, userId)
          )
        );

      if (!inquiry) {
        return res.status(404).json({
          success: false,
          message: "Inquiry not found or unauthorized",
        });
      }

      res.json({
        success: true,
        data: inquiry,
      });
    } catch (error) {
      console.error("Error fetching inquiry details:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  },

  // Handle payment cancellation
  async handlePaymentCancel(req, res) {
    try {
      const { inquiry_id } = req.query;
      const userId = req.user.id;

      if (inquiry_id) {
        // Get inquiry and user data for email
        const [inquiry] = await db
          .select()
          .from(creativeInquiries)
          .where(
            and(
              eq(creativeInquiries.id, inquiry_id),
              eq(creativeInquiries.userId, userId)
            )
          );

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, userId));

        // Update inquiry status to cancelled
        await db
          .update(creativeInquiries)
          .set({
            status: "cancelled",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(creativeInquiries.id, inquiry_id),
              eq(creativeInquiries.userId, userId)
            )
          );

        // Send payment failure email if we have the necessary data
        if (inquiry && user) {
          try {
            // Helper functions
            const getCreativeType = (service) => {
              if (service.includes("photography")) return "photographers";
              if (service.includes("videography")) return "videographers";
              if (service.includes("florist")) return "florists";
              if (service.includes("planner")) return "planners";
              return "creatives";
            };

            const getEventType = (service) => {
              if (service.includes("engagement and wedding"))
                return "engagement and wedding";
              if (service.includes("engagement")) return "engagement";
              if (service.includes("elopement")) return "elopement";
              if (service.includes("multi-day wedding"))
                return "multi-day wedding";
              if (service.includes("wedding")) return "wedding";
              return "event";
            };

            const failureDetails = {
              inquiryId: inquiry_id,
              totalAmount: parseFloat(inquiry.totalAmount),
              proposalCount: inquiry.proposalCount,
              creativeType: getCreativeType(inquiry.selectedService),
              eventType: getEventType(inquiry.selectedService),
              failureReason: "Payment was cancelled by the user",
            };

            await emailService.sendPaymentFailureEmail(
              user.email,
              user.firstName || user.name || "Customer",
              failureDetails
            );

            console.log("Payment cancellation email sent successfully");
          } catch (emailError) {
            console.error(
              "Failed to send payment cancellation email:",
              emailError
            );
            // Don't fail the request if email fails
          }
        }
      }

      res.json({
        success: true,
        message: "Payment cancelled",
      });
    } catch (error) {
      console.error("Error handling payment cancellation:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  },

  // Webhook handler for Stripe events
  async handleStripeWebhook(req, res) {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.log(`Webhook signature verification failed.`, err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
      case "checkout.session.completed":
        const session = event.data.object;
        const inquiryId = session.metadata.inquiryId;
        const stripeCustomerId = session.customer;

        if (inquiryId) {
          // Update inquiry with payment completion
          await db
            .update(creativeInquiries)
            .set({
              paymentStatus: "completed",
              status: "paid",
              paidAt: new Date(),
              stripePaymentIntentId: session.payment_intent,
              stripeCustomerId: stripeCustomerId,
              updatedAt: new Date(),
            })
            .where(eq(creativeInquiries.id, inquiryId));

          // Update customer record with transaction details
          try {
            await stripe.customers.update(stripeCustomerId, {
              metadata: {
                lastPurchaseDate: new Date().toISOString(),
                lastPurchaseAmount: (session.amount_total / 100).toString(),
                lastInquiryId: inquiryId,
                totalPurchases: (
                  (await this.getCustomerTotalPurchases(stripeCustomerId)) + 1
                ).toString(),
              },
            });
          } catch (customerUpdateError) {
            console.error(
              "Error updating customer metadata:",
              customerUpdateError
            );
          }

          // Send payment success email via webhook
          try {
            if (session.metadata.userEmail && session.metadata.userName) {
              const paymentDetails = {
                inquiryId: inquiryId,
                totalAmount: session.amount_total / 100,
                proposalCount: parseInt(session.metadata.proposalCount),
                creativeType: session.metadata.creativeType || "creatives",
                eventType: session.metadata.eventType || "event",
                sessionId: session.id,
              };

              await emailService.sendPaymentReceiptEmail(
                session.metadata.userEmail,
                session.metadata.userName,
                paymentDetails
              );

              console.log("Payment receipt email sent via webhook");
            }
          } catch (emailError) {
            console.error(
              "Failed to send payment receipt email via webhook:",
              emailError
            );
          }
        }
        break;

      case "checkout.session.expired":
        const expiredSession = event.data.object;
        const expiredInquiryId = expiredSession.metadata.inquiryId;

        if (expiredInquiryId) {
          await db
            .update(creativeInquiries)
            .set({
              status: "expired",
              updatedAt: new Date(),
            })
            .where(eq(creativeInquiries.id, expiredInquiryId));

          // Send payment failure email for expired session
          try {
            if (
              expiredSession.metadata.userEmail &&
              expiredSession.metadata.userName
            ) {
              const failureDetails = {
                inquiryId: expiredInquiryId,
                totalAmount: expiredSession.amount_total / 100,
                proposalCount: parseInt(expiredSession.metadata.proposalCount),
                creativeType:
                  expiredSession.metadata.creativeType || "creatives",
                eventType: expiredSession.metadata.eventType || "event",
                failureReason: "Payment session expired after 24 hours",
              };

              await emailService.sendPaymentFailureEmail(
                expiredSession.metadata.userEmail,
                expiredSession.metadata.userName,
                failureDetails
              );

              console.log("Payment expiration email sent via webhook");
            }
          } catch (emailError) {
            console.error(
              "Failed to send payment expiration email via webhook:",
              emailError
            );
          }
        }
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  },

  // Helper method to get customer's total purchases
  async getCustomerTotalPurchases(stripeCustomerId) {
    try {
      const inquiries = await db
        .select()
        .from(creativeInquiries)
        .where(
          and(
            eq(creativeInquiries.stripeCustomerId, stripeCustomerId),
            eq(creativeInquiries.paymentStatus, "completed")
          )
        );

      return inquiries.length;
    } catch (error) {
      console.error("Error getting customer total purchases:", error);
      return 0;
    }
  },

  // New method to get customer payment history (for admin/support use)
  async getCustomerPaymentHistory(req, res) {
    try {
      const { customerId } = req.params;
      const { limit = 20, offset = 0 } = req.query;

      // Get all inquiries for this customer
      const inquiries = await db
        .select({
          id: creativeInquiries.id,
          totalAmount: creativeInquiries.totalAmount,
          proposalCount: creativeInquiries.proposalCount,
          selectedService: creativeInquiries.selectedService,
          paymentStatus: creativeInquiries.paymentStatus,
          status: creativeInquiries.status,
          createdAt: creativeInquiries.createdAt,
          paidAt: creativeInquiries.paidAt,
          stripePaymentIntentId: creativeInquiries.stripePaymentIntentId,
        })
        .from(creativeInquiries)
        .where(eq(creativeInquiries.stripeCustomerId, customerId))
        .orderBy(desc(creativeInquiries.createdAt))
        .limit(parseInt(limit))
        .offset(parseInt(offset));

      // Get customer details from Stripe
      const customer = await stripe.customers.retrieve(customerId);

      res.json({
        success: true,
        data: {
          customer: {
            id: customer.id,
            email: customer.email,
            name: customer.name,
            created: customer.created,
            metadata: customer.metadata,
          },
          inquiries,
          totalInquiries: inquiries.length,
        },
      });
    } catch (error) {
      console.error("Error fetching customer payment history:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  },

  // Add this new method to CreativeInquiryController
  async checkUserCompletedInquiries(req, res) {
    try {
      const userId = req.user.id;

      // Check if user has any completed inquiries (paid and processed)
      const completedInquiries = await db
        .select({
          id: creativeInquiries.id,
          status: creativeInquiries.status,
          paymentStatus: creativeInquiries.paymentStatus,
          createdAt: creativeInquiries.createdAt,
        })
        .from(creativeInquiries)
        .where(
          and(
            eq(creativeInquiries.userId, userId),
            eq(creativeInquiries.paymentStatus, "completed")
          )
        )
        .orderBy(desc(creativeInquiries.createdAt))
        .limit(1);

      const hasCompletedInquiry = completedInquiries.length > 0;

      res.json({
        success: true,
        data: {
          hasCompletedInquiry,
          latestInquiry: hasCompletedInquiry ? completedInquiries[0] : null,
        },
      });
    } catch (error) {
      console.error("Error checking user completed inquiries:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  },
};

module.exports = CreativeInquiryController;
