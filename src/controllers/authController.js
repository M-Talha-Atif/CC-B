const authService = require("../services/authService");
const onboardingService = require("../services/onBoardingService");
const { generateToken } = require("../utils/helpers");
const { OAuth2Client } = require("google-auth-library");
const dns = require("dns").promises;
const axios = require("axios");
const { users } = require("../models/schema");
const { eq } = require("drizzle-orm");
const { db } = require("../config/database");
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const jwt = require("jsonwebtoken");

async function validateBusinessDomain(domain) {
  try {
    // Basic domain format validation
    if (!domain || typeof domain !== "string") {
      return false;
    }

    // Remove any whitespace and convert to lowercase
    domain = domain.trim().toLowerCase();

    // Basic domain format check (simple regex)
    const domainRegex =
      /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;
    if (!domainRegex.test(domain)) {
      return false;
    }

    // Check for obvious invalid domains
    if (
      domain.includes("localhost") ||
      domain.includes("127.0.0.1") ||
      domain === "example.com"
    ) {
      return false;
    }

    // List of personal email domains to block
    const personalEmailDomains = [
      "gmail.com",
      "yahoo.com",
      "hotmail.com",
      "outlook.com",
      "live.com",
      "icloud.com",
      "aol.com",
      "protonmail.com",
      "mail.com",
      "zoho.com",
      "yandex.com",
      "mail.ru",
      "qq.com",
      "sina.com",
      "sohu.com",
      "naver.com",
      "daum.net",
      "msn.com",
      "yahoo.co.uk",
      "yahoo.co.jp",
      "gmx.com",
      "web.de",
      "t-online.de",
      "orange.fr",
      "free.fr",
      "libero.it",
      "tiscali.it",
      "terra.com.br",
      "uol.com.br",
    ];

    // Check if domain is in personal email list
    if (personalEmailDomains.includes(domain)) {
      return false;
    }

    // Check if domain has MX record (indicates it can receive emails)
    try {
      const mxRecords = await dns.resolveMx(domain);
      if (!mxRecords || mxRecords.length === 0) {
        return false;
      }
    } catch (error) {
      // If MX lookup fails, the domain likely doesn't exist or can't receive emails
      console.warn(`MX lookup failed for domain ${domain}:`, error.message);
      return false;
    }

    // Additional check: Ensure domain has at least one dot (no single-word domains)
    if (!domain.includes(".")) {
      return false;
    }

    // Check for minimum domain length (e.g., "a.co" would be 4 characters)
    if (domain.length < 4) {
      return false;
    }

    return true;
  } catch (error) {
    console.error("Domain validation error:", error);
    return false;
  }
}

const authController = {
  async register(req, res) {
    try {
      const { email, password, userType = "creative" } = req.body;

      console.log("🔐 Registration attempt for:", email);

      const result = await authService.registerOrLogin({
        email,
        password,
        userType,
      });

      const { accessToken, refreshToken } = generateToken(result.user.id);

      const isProduction = process.env.NODE_ENV === "production";

      const cookieOptions = {
        httpOnly: false, // Keep false for mobile access
        secure: true,
        sameSite: isProduction ? "none" : "none",
        path: "/",
        domain:  process.env.BACKEND_URL,
      };

      // Set access token
      res.cookie("token", accessToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      // 🔥 Set refresh token (180 days instead of 90)
      res.cookie("refreshToken", refreshToken, {
        ...cookieOptions,
        maxAge: 180 * 24 * 60 * 60 * 1000, // 180 days
      });

      console.log("✅ Cookies set successfully");

      res.status(result.action === "register" ? 201 : 200).json({
        success: true,
        message:
          result.action === "register"
            ? "User registered successfully"
            : "Welcome back!",
        data: {
          user: {
            ...result.user,
            isNewUser: result.isNewUser, // ✅ Add this
          },
          accessToken,
          refreshToken,
          isNewUser: result.isNewUser, // ✅ Also include at top level
        },
      });
    } catch (error) {
      console.error("❌ Registration error:", error);
      res.status(400).json({ success: false, message: error.message });
    }
  },

  async login(req, res) {
    try {
      const { admin } = req.params;
      const { email, password } = req.body;

      const result = await authService.authenticateUser(email, password, admin);

      const { accessToken, refreshToken } = generateToken(result.user.id);

      const cookieOptions = {
        httpOnly: true,
        secure: true, // ✅ ALWAYS true with ngrok or HTTPS
        sameSite: "none", // ✅ Needed for cross-site
        maxAge: 1 * 60 * 1000,
        path: "/",
        domain: undefined, // ✅ Let browser handle domain automatically
      };

      // ✅ Set cookies like in register
      res.cookie("token", accessToken, cookieOptions);

      res.cookie("refreshToken", refreshToken, {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      res.status(200).json({
        success: true,
        message: "Login successful",
        data: {
          user: {
            id: result.user.id,
            email: result.user.email,
            userType: result.user.userType,
            profileCompleted: result.user.profileCompleted,
            businessName: result.user.businessName,
            website: result.user.website,
            instagram: result.user.instagram,
            creativeDomains: result.user.creativeDomains,
            phone: result.user.phone,
            phoneVerified: result.user.phoneVerified,
          },
          accessToken, // optional (for debugging)
          refreshToken, // optional (for debugging)
        },
      });
    } catch (error) {
      console.log(error);
      res.status(401).json({
        success: false,
        message: error.message,
      });
    }
  },

  async checkEmailExists(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email is required",
        });
      }

      // Check if user exists with this email
      const existingUser = await db
        .select({
          id: users.id,
          email: users.email,
        })
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);

      const emailExists = existingUser.length > 0;

      return res.status(200).json({
        success: true,
        data: {
          exists: emailExists,
        },
      });
    } catch (error) {
      console.error("Check email error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to check email availability",
      });
    }
  },

  async googleLoginCreative(req, res) {
    try {
      const { googleToken, userType } = req.body;

      console.log(googleToken, userType);

      if ((!googleToken, !userType)) {
        return res.status(400).json({
          success: false,
          message: "Please provide required fields",
        });
      }
      const validUserTypes = ["creative", "couple"];
      if (!validUserTypes.includes(userType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid user type. Must be 'creative' or 'couple'",
        });
      }

      // ✅ Fetch user info using Google's UserInfo endpoint
      const userInfoResponse = await axios.get(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: {
            Authorization: `Bearer ${googleToken}`,
          },
        }
      );

      const payload = userInfoResponse.data;
      const { email, name, given_name, family_name, picture } = payload;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email not provided by Google",
        });
      }

      // ✅ BUSINESS EMAIL VALIDATION - Block personal domains
      const personalEmailDomains = [
        "gmail.com",
        "yahoo.com",
        "hotmail.com",
        "outlook.com",
        "live.com",
        "icloud.com",
        "aol.com",
        "protonmail.com",
        "mail.com",
        "zoho.com",
      ];

      const emailDomain = email.split("@")[1]?.toLowerCase();

      if (personalEmailDomains.includes(emailDomain)) {
        return res.status(403).json({
          success: false,
          message: "Please use your business email address to sign in.",
          errorCode: "BUSINESS_EMAIL_REQUIRED",
        });
      }

      // ✅ Optional domain validation (e.g. MX record check)
      const isDomainValid = await validateBusinessDomain(emailDomain);
      if (!isDomainValid) {
        return res.status(403).json({
          success: false,
          message: "Please use a valid business email address.",
          errorCode: "INVALID_DOMAIN",
        });
      }

      // ✅ Check if user exists
      let user = await authService.findUserByEmail(email);

      if (user) {
        // User exists → log them in
        const { accessToken, refreshToken } = generateToken(user.id);

        // Update last login
        await authService.updateUserLastLogin(user.id);

        return res.status(200).json({
          success: true,
          message: "Login successful",
          data: {
            user: {
              id: user.id,
              email: user.email,
              userType: user.userType,
              profileCompleted: user.profileCompleted,
              businessName: user.businessName,
              website: user.website,
              instagram: user.instagram,
              creativeDomains: user.creativeDomains,
              phone: user.phone,
              phoneVerified: user.phoneVerified,
              firstName: user.firstName,
              lastName: user.lastName,
              profilePicture: user.profilePicture,
              referralCode: user.personalReferralCode,
            },
            accessToken,
            refreshToken,
            isNewUser: false,
          },
        });
      } else {
        // User doesn't exist → create new user
        const result = await authService.createGoogleUser({
          email,
          firstName: given_name || name?.split(" ")[0] || "",
          lastName: family_name || name?.split(" ").slice(1).join(" ") || "",
          profilePicture: picture,
          userType: userType,
        });

        const { accessToken, refreshToken } = generateToken(result.user.id);

        return res.status(201).json({
          success: true,
          message: "User created and logged in successfully",
          data: {
            user: {
              id: result.user.id,
              email: result.user.email,
              userType: result.user.userType,
              profileCompleted: result.user.profileCompleted,
              firstName: result.user.firstName,
              lastName: result.user.lastName,
              profilePicture: result.user.profilePicture,
              referralCode: result.user.personalReferralCode,
            },
            accessToken,
            refreshToken,
            isNewUser: true,
          },
        });
      }
    } catch (error) {
      console.error(
        "Google login error:",
        error?.response?.data || error.message
      );
      res.status(400).json({
        success: false,
        message:
          error?.response?.data?.error_description ||
          error.message ||
          "Google authentication failed",
      });
    }
  },

  async googleLoginCouple(req, res) {
    try {
      const { googleToken, userType } = req.body;

      if (!googleToken || !userType) {
        return res.status(400).json({
          success: false,
          message: "Please provide required fields",
        });
      }

      const validUserTypes = ["creative", "couple"];
      if (!validUserTypes.includes(userType)) {
        return res.status(400).json({
          success: false,
          message: "Invalid user type. Must be 'creative' or 'couple'",
        });
      }

      // ✅ Fetch user info from Google
      const userInfoResponse = await axios.get(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: {
            Authorization: `Bearer ${googleToken}`,
          },
        }
      );

      const payload = userInfoResponse.data;
      const { email, name, given_name, family_name, picture } = payload;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email not provided by Google",
        });
      }

      // 🚫 SKIP: Personal domain and business validation for couples

      // ✅ Check if user exists
      let user = await authService.findUserByEmail(email);

      if (user) {
        const { accessToken, refreshToken } = generateToken(user.id);
        await authService.updateUserLastLogin(user.id);

        return res.status(200).json({
          success: true,
          message: "Login successful",
          data: {
            user: {
              id: user.id,
              email: user.email,
              userType: user.userType,
              profileCompleted: user.profileCompleted,
              businessName: user.businessName,
              website: user.website,
              instagram: user.instagram,
              creativeDomains: user.creativeDomains,
              phone: user.phone,
              phoneVerified: user.phoneVerified,
              firstName: user.firstName,
              lastName: user.lastName,
              profilePicture: user.profilePicture,
              referralCode: user.personalReferralCode,
            },
            accessToken,
            refreshToken,
            isNewUser: false,
          },
        });
      } else {
        const result = await authService.createGoogleUser({
          email,
          firstName: given_name || name?.split(" ")[0] || "",
          lastName: family_name || name?.split(" ").slice(1).join(" ") || "",
          profilePicture: picture,
          userType,
        });

        const { accessToken, refreshToken } = generateToken(result.user.id);

        return res.status(201).json({
          success: true,
          message: "User created and logged in successfully",
          data: {
            user: {
              id: result.user.id,
              email: result.user.email,
              userType: result.user.userType,
              profileCompleted: result.user.profileCompleted,
              firstName: result.user.firstName,
              lastName: result.user.lastName,
              profilePicture: result.user.profilePicture,
              referralCode: result.user.personalReferralCode,
            },
            accessToken,
            refreshToken,
            isNewUser: true,
          },
        });
      }
    } catch (error) {
      console.error(
        "Google login error:",
        error?.response?.data || error.message
      );
      res.status(400).json({
        success: false,
        message:
          error?.response?.data?.error_description ||
          error.message ||
          "Google authentication failed",
      });
    }
  },

  async verifyReferralCode(req, res) {
    try {
      const { referralCode } = req.body;
      const usedByUserId = req.user?.id;

      const result = await authService.verifyReferralCode(
        referralCode,
        usedByUserId
      );

      if (!result?.isValid) {
        return res.status(400).json({
          success: false,
          message: result.message || "Invalid or expired referral code.",
          errorCode: result.errorCode || "INVALID_REFERRAL_CODE",
        });
      }

      res.status(200).json({
        success: true,
        message: "Referral code is valid and has been applied successfully!",
        data: result,
      });
    } catch (error) {
      // Handle self-referral error
      if (error.message.includes("cannot use your own")) {
        return res.status(400).json({
          success: false,
          message: error.message,
          errorCode: "SELF_REFERRAL_DENIED",
        });
      }

      // Generic error handling
      res.status(400).json({
        success: false,
        message: error.message || "Failed to verify referral code",
        errorCode: "REFERRAL_VERIFICATION_FAILED",
      });
    }
  },

  async storePhone(req, res) {
    try {
      const { phone } = req.body;
      const userId = req.user.id;

      const result = await authService.storeUserPhone(userId, phone);

      res.status(200).json({
        success: true,
        message: "Phone number stored successfully",
        data: result,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  async sendVerificationEmail(req, res) {
    try {
      const { email, userId } = req.body;

      if (!email || !userId) {
        return res.status(400).json({
          success: false,
          message: "Email and userId are required",
        });
      }

      const result = await authService.sendEmailVerification(email, userId);

      res.status(200).json({
        success: true,
        message: "Verification email sent successfully",
        data: {
          tokenSent: result.tokenSent,
          email: result.email,
        },
      });
    } catch (error) {
      console.error("Send verification email error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to send verification email",
      });
    }
  },

  async checkEmailVerificationStatus(req, res) {
    try {
      const userId = req.user.id; // Assuming you have middleware that sets req.user

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required",
        });
      }

      // Get user's current email verification status
      const user = await db
        .select({
          id: users.id,
          email: users.email,
          emailVerified: users.emailVerified,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (user.length === 0) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      res.status(200).json({
        success: true,
        data: {
          emailVerified: user[0].emailVerified,
          email: user[0].email,
        },
      });
    } catch (error) {
      console.error("Check email verification status error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to check email verification status",
      });
    }
  },

  async verifyEmailToken(req, res) {
    try {
      const { token } = req.params;

      if (!token) {
        return res.status(400).json({
          success: false,
          message: "Verification token is required",
        });
      }

      const result = await authService.verifyEmailWithToken(token);

      // Redirect to frontend success page
      const redirectUrl = `${process.env.FRONTEND_URL}/login/email-verified?status=success`;
      res.redirect(redirectUrl);
    } catch (error) {
      console.error("Email verification error:", error);

      let redirectUrl;
      if (error.message.includes("expired")) {
        redirectUrl = `${process.env.FRONTEND_URL}/login/email-verified?status=expired`;
      } else if (
        error.message.includes("invalid") ||
        error.message.includes("used")
      ) {
        redirectUrl = `${process.env.FRONTEND_URL}/login/email-verified?status=invalid`;
      } else {
        redirectUrl = `${process.env.FRONTEND_URL}/login/email-verified?status=error`;
      }

      res.redirect(redirectUrl);
    }
  },

  async resendVerificationEmail(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: "Email is required",
        });
      }

      const result = await authService.resendEmailVerification(email);

      res.status(200).json({
        success: true,
        message: "Verification email resent successfully",
        data: {
          tokenSent: result.tokenSent,
          email: result.email,
        },
      });
    } catch (error) {
      console.error("Resend verification email error:", error);
      res.status(500).json({
        success: false,
        message: "Failed to resend verification email",
      });
    }
  },

  async sendOTP(req, res) {
    try {
      const { phone } = req.body;
      const userId = req.user.id;

      await authService.sendPhoneOTP(userId, phone);

      res.status(200).json({
        success: true,
        message: "OTP sent successfully",
        data: { phone },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  async verifyOTP(req, res) {
    try {
      const { phone, otpCode } = req.body;
      const userId = req.user.id;

      const result = await authService.verifyPhoneOTP(userId, phone, otpCode);

      res.status(200).json({
        success: true,
        message: "Phone verified successfully",
        data: result,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  async completeProfile(req, res) {
    try {
      const {
        businessName,
        website,
        instagram,
        creativeDomains,
        referralCode,
      } = req.body;
      const userId = req.user.id;

      const result = await authService.completeUserProfile(userId, {
        businessName,
        website,
        instagram,
        creativeDomains,
        referralCode,
      });

      res.status(200).json({
        success: true,
        message: "Profile completed successfully",
        data: result,
      });
    } catch (error) {
      console.log(error.message);
      
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  async forgotPassword(req, res) {
    try {
      const { email } = req.body;

      const result = await authService.initiatePasswordReset(email);

      res.status(200).json({
        success: true,
        message:
          "If an account with this email exists, you will receive a password reset link shortly.",
        data: {
          tokenSent: result.tokenSent,
        },
      });
    } catch (error) {
      console.error("Forgot password error:", error);

      // Always return success message for security (don't reveal if email exists)
      res.status(200).json({
        success: true,
        message:
          "If an account with this email exists, you will receive a password reset link shortly.",
      });
    }
  },

  async resetPassword(req, res) {
    try {
      const { token, password } = req.body;
      console.log(token, password);

      const result = await authService.resetPasswordWithToken(token, password);

      res.status(200).json({
        success: true,
        message:
          "Password has been reset successfully. You can now log in with your new password.",
        data: {
          userId: result.userId,
          email: result.email,
        },
      });
    } catch (error) {
      console.error("Reset password error:", error);

      let statusCode = 400;
      let message = error.message;

      if (error.message.includes("expired")) {
        statusCode = 410; // Gone
      } else if (
        error.message.includes("invalid") ||
        error.message.includes("used")
      ) {
        statusCode = 400; // Bad Request
      }

      res.status(statusCode).json({
        success: false,
        message: message,
      });
    }
  },

  async verifyResetToken(req, res) {
    try {
      const { token } = req.params;

      const result = await authService.verifyResetToken(token);

      res.status(200).json({
        success: true,
        message: "Token is valid",
        data: {
          valid: result.valid,
          email: result.email,
        },
      });
    } catch (error) {
      console.error("Verify reset token error:", error);

      res.status(400).json({
        success: false,
        message: error.message,
        data: {
          valid: false,
        },
      });
    }
  },

  async refreshToken(req, res) {
    try {
      console.log("\n🔄 === REFRESH TOKEN REQUEST ===");
      console.log("📋 All cookies:", req.cookies);

      const refreshToken = req.cookies.refreshToken;

      if (!refreshToken) {
        console.log("❌ No refresh token found in cookies");
        return res.status(401).json({
          success: false,
          message: "No refresh token",
        });
      }

      console.log("✅ Refresh token found");

      let decoded;
      try {
        decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
        console.log("✅ Token verified successfully");
      } catch (jwtError) {
        console.log("❌ JWT verification failed:", jwtError.message);
        return res.status(401).json({
          success: false,
          message: "Invalid or expired refresh token",
        });
      }

      if (decoded.type !== "refresh") {
        return res.status(401).json({
          success: false,
          message: "Invalid token type",
        });
      }

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, decoded.userId))
        .limit(1);

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "User not found",
        });
      }

      console.log("✅ User found:", user.email);

      const { accessToken, refreshToken: newRefreshToken } = generateToken(
        user.id
      );

      const isProduction = process.env.NODE_ENV === "production";

      const cookieOptions = {
        httpOnly: false, // Keep false for mobile access
        secure: true,
        sameSite: isProduction ? "none" : "none",
        path: "/",
        domain:  process.env.BACKEND_URL,
      };

      // 🔥 Set new access token (7 days)
      res.cookie("token", accessToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      // 🔥 Set new refresh token (90 days)
      res.cookie("refreshToken", newRefreshToken, {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      console.log("✅ New cookies set, sending response");

      res.status(200).json({
        success: true,
        message: "Token refreshed",
        data: {
          user: {
            id: user.id,
            email: user.email,
            userType: user.userType,
            profileCompleted: user.profileCompleted,
            businessName: user.businessName,
            website: user.website,
            instagram: user.instagram,
            creativeDomains: user.creativeDomains,
            phone: user.phone,
            phoneVerified: user.phoneVerified,
          },
        },
      });

      console.log("✅ === REFRESH TOKEN SUCCESS ===\n");
    } catch (error) {
      console.error("❌ Refresh token error:", error);
      res.status(401).json({
        success: false,
        message: "Token refresh failed: " + error.message,
      });
    }
  },

  async exchangeInstagramToken(req, res) {
    try {
      const { code } = req.body;

      if (!code) {
        return res
          .status(400)
          .json({ success: false, message: "Authorization code is required" });
      }

      const clientId = process.env.INSTAGRAM_CLIENT_ID;
      const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
      const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;

      // ✅ Step 1 - exchange code for Facebook access token
      const graphRes = await fetch(
        `https://graph.facebook.com/v19.0/oauth/access_token?` +
          new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code,
          }),
        {
          method: "GET",
        }
      );

      const graphData = await graphRes.json();

      if (!graphRes.ok) {
        throw new Error(
          graphData.error?.message || "Failed to exchange code for token"
        );
      }

      const accessToken = graphData.access_token;

      // ✅ Step 2 - get user's Pages
      const pagesRes = await fetch(
        `https://graph.facebook.com/v19.0/me/accounts?access_token=${accessToken}`
      );

      const pagesData = await pagesRes.json();

      if (!pagesRes.ok) {
        throw new Error(
          pagesData.error?.message || "Failed to fetch user Pages"
        );
      }

      const pages = pagesData.data;

      if (!pages || pages.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No connected Facebook Pages found for this user.",
        });
      }

      const accounts = [];

      for (const page of pages) {
        // check if page has IG business account
        const pageDetailRes = await fetch(
          `https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${accessToken}`
        );
        const pageDetails = await pageDetailRes.json();

        if (!pageDetailRes.ok) {
          throw new Error(
            pageDetails.error?.message ||
              `Failed to get details for page ${page.id}`
          );
        }

        const igAccountId = pageDetails.instagram_business_account?.id;

        if (igAccountId) {
          // get IG user info
          const igUserRes = await fetch(
            `https://graph.facebook.com/v19.0/${igAccountId}?fields=username,profile_picture_url,account_type,media_count&access_token=${accessToken}`
          );

          const igUser = await igUserRes.json();

          if (!igUserRes.ok) {
            throw new Error(
              igUser.error?.message || `Failed to fetch IG user ${igAccountId}`
            );
          }

          accounts.push({
            id: igUser.id,
            username: igUser.username,
            profile_picture_url: igUser.profile_picture_url,
            account_type: igUser.account_type,
            media_count: igUser.media_count,
            access_token: accessToken,
          });
        }
      }

      if (accounts.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No connected Instagram business accounts found.",
        });
      }

      return res.status(200).json({
        success: true,
        accounts,
      });
    } catch (err) {
      console.error("Instagram token exchange error:", err);
      return res.status(400).json({
        success: false,
        message: err.message || "Instagram exchange failed",
      });
    }
  },

  // Logout user
  async logout(req, res) {
    try {
      const userId = req.user.id;
      const token = req.headers.authorization?.split(" ")[1];

      await authService.logoutUser(userId, token);

      res.status(200).json({
        success: true,
        message: "Logged out successfully",
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  // Get user profile
  async getProfile(req, res) {
    try {
      const userId = req.user.id;

      const user = await authService.getUserProfile(userId);

      res.status(200).json({
        success: true,
        data: { user },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  async getUserWithProgress(req, res) {
    try {
      const userId = req.user.id;
      const result = await authService.getUserWithProgress(userId);

      res.json({
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

  async getNextStep(req, res) {
    try {
      const userId = req.user.id;
      const nextStep = await onboardingService.determineNextStep(userId);

      res.json({
        success: true,
        data: nextStep,
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  async updateProgress(req, res) {
    try {
      const userId = req.user.id;
      const { currentStep, formData, stepCompleted } = req.body;

      const progress = await onboardingService.updateProgress(userId, {
        currentStep,
        formData,
        stepCompleted,
      });

      res.json({
        success: true,
        data: { progress },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  async resetProgress(req, res) {
    try {
      const userId = req.user.id;
      const { fromStep } = req.body;

      const progress = await onboardingService.resetProgress(userId, fromStep);

      res.json({
        success: true,
        data: { progress },
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  },

  async checkUserStatus(req, res) {
    try {
      const userId = req.user.id;

      const accessInfo = await authService.checkUserAccess(userId);

      res.status(200).json({
        success: true,
        message: "User status checked successfully",
        data: accessInfo,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },
};

module.exports = authController;
