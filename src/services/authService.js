const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { eq, and, sql, or, ne } = require("drizzle-orm");
const { db } = require("../config/database");
const {
  users,
  otpCodes,
  adminReferralCodes,
  referralUsage,
  passwordResetTokens,
  emailVerificationTokens,
  onboardingProgress,
} = require("../models/schema");
const { generateReferralCode, generateOTPCode } = require("../utils/helpers");
const smsService = require("./smsService");
const crypto = require("crypto");
const onboardingService = require("./onBoardingService");
const emailService = require("./emailService");
const AnonymousService = require("./anonService");

const authService = {
  // Create new user
  async createUser({ email, password, userType = "creative" }) {
    try {
      // Check if user already exists
      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existingUser.length > 0) {
        throw new Error("User already exists with this email");
      }

      // Hash password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Generate unique referral code for the user
      const userReferralCode = generateReferralCode();

      // Create user
      const [newUser] = await db
        .insert(users)
        .values({
          email,
          password: hashedPassword,
          userType,
          personalReferralCode: userReferralCode,
        })
        .returning();

      // Remove password from response
      const { password: _, ...userWithoutPassword } = newUser;

      return {
        user: userWithoutPassword,
      };
    } catch (error) {
      throw new Error(error.message || "Failed to create user");
    }
  },

  async registerOrLogin({ email, password, userType = "creative" }) {
    try {
      // Use AnonymousService to check if user exists (handles both regular and anonymous)
      const existingUser = await AnonymousService.findUserByRealEmail(email);
      console.log(existingUser)


      if (existingUser) {
        // If rejected → reset user so they can register fresh

        if (existingUser.status === "rejected") {
          // RESET user
          const saltRounds = 12;
          const hashedPassword = await bcrypt.hash(password, saltRounds);
          const referral = generateReferralCode();

          const [updatedUser] = await db
            .update(users)
            .set({
              status: "pending",
              password: hashedPassword,
              userType,
              personalReferralCode: referral,

              firstName: null,
              lastName: null,
              profilePicture: null,
              phone: null,
              instagram: null,
              website: null,
              creativeDomains: null,
              businessName: null,
              emailVerified: false,
              phoneVerified: false,
              profileCompleted: false,
              updatedAt: new Date(),
            })
            .where(eq(users.id, existingUser.id))
            .returning();

          // Delete old onboarding progress
          await db.delete(onboardingProgress).where(eq(onboardingProgress.userId, updatedUser.id));

          // --- Use the exact same onboarding flow as for a new user ---
          const progress = await onboardingService.initializeProgress(
            updatedUser.id,
            "referral-code" // same starting step as new users
          );

          // Update progress with email-password step completed
          await onboardingService.updateProgress(updatedUser.id, {
            currentStep: "referral-code",
            stepCompleted: "email-login",
            formData: { email },
          });


          const userForResponse = AnonymousService.formatUserForResponse(updatedUser);

          return {
            user: userForResponse,
            progress,
            profileCompleted: true ? progress === "onboarding-completed" : false,
            action: "register",
            isNewUser: true,
          };
        }

        else if (existingUser.status === "approved" || existingUser.status === "pending") {
          // Normal login flow
          const userData = await AnonymousService.authenticateUser(email, password);

          const progress = await onboardingService.getProgress(userData.id);
          const userForResponse = AnonymousService.formatUserForResponse(userData);

          console.log("[LOGIN] Onboarding progress fetched", {
            userId: userData.id,
            emailVerified: userData.emailVerified,
            progress,
          });

          return {
            user: userForResponse,
            progress,
            action: "login",
            isNewUser: userData.emailVerified==false, // new user then email verified should be false
          };
        }
      }

      // User doesn't exist, create new user
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      const userReferralCode = generateReferralCode();

      const [newUser] = await db
        .insert(users)
        .values({
          email,
          password: hashedPassword,
          userType,
          personalReferralCode: userReferralCode,
        })
        .returning();

      // Initialize onboarding progress for new user
      const progress = await onboardingService.initializeProgress(
        newUser.id,
        "referral-code" // Start from referral code for new users
      );

      // Update progress with email/password completed
      await onboardingService.updateProgress(newUser.id, {
        currentStep: "referral-code",
        stepCompleted: "auth",
        formData: { email },
      });

      // Format user data for response
      const userForResponse = AnonymousService.formatUserForResponse(newUser);

      return {
        user: userForResponse,
        progress,
        action: "register",
        isNewUser: true,
      };
    } catch (error) {
      throw new Error(error.message || "Failed to register or login user");
    }
  },

  // Get user with onboarding progress
  async getUserWithProgress(userId) {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        throw new Error("User not found");
      }

      const progress = await onboardingService.getProgress(userId);
      const nextStep = await onboardingService.determineNextStep(userId);

      const { password: _, ...userWithoutPassword } = user;

      console.log(progress, nextStep);

      return {
        user: userWithoutPassword,
        progress,
        nextStep,
      };
    } catch (error) {
      throw new Error(error.message || "Failed to get user with progress");
    }
  },

  // Authenticate user
  async authenticateUser(email, password, isAdminLogin = false) {
    try {
      // Find user by email
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!user) {
        throw new Error("Invalid email or password");
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        throw new Error("Invalid email or password");
      }

      // Check if admin login is required but user is not admin
      if (isAdminLogin && user.userType !== "admin") {
        throw new Error("Access denied. Admin privileges required");
      }

      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;

      return {
        user: userWithoutPassword,
      };
    } catch (error) {
      throw new Error(error.message || "Authentication failed");
    }
  },

  async verifyReferralCode(code, usedByUserId) {
    try {
      // Check if already used by this user

      const existingUsage = await db
        .select()
        .from(referralUsage)
        .where(
          and(
            eq(referralUsage.referralCode, code),
            eq(referralUsage.usedByUserId, usedByUserId)
          )
        )
        .limit(1);

      if (existingUsage.length > 0) {
        console.log("Already processed")
        return {
          isValid: true,
          alreadyUsed: true,
          referralCode: code, // returning code for ui show
          message: "Referral code already processed",
        };
      }

      // Check onboarding status
      const userOnboardingProgress = await db
        .select()
        .from(onboardingProgress)
        .where(eq(onboardingProgress.userId, usedByUserId))
        .limit(1);

      if (
        userOnboardingProgress.length > 0 &&
        userOnboardingProgress[0].referralCodeCompleted
      ) {
        console.log("Referral Step already completed")
        return {
          isValid: true,
          alreadyUsed: true,
          referralCode: userOnboardingProgress[0].formData?.referralCode || code,
          message: "Referral step already completed",
        };
      }

      // Verify code exists and is valid
      const [adminCode] = await db
        .select()
        .from(adminReferralCodes)
        .where(
          and(
            eq(adminReferralCodes.code, code),
            eq(adminReferralCodes.isActive, true)
          )
        )
        .limit(1);

      const [userCode] = await db
        .select()
        .from(users)
        .where(eq(users.personalReferralCode, code))
        .limit(1);

      if (!adminCode && !userCode) {
        return {
          isValid: false,
          message: "Invalid referral code",
        };
      }

      // Prevent self-referral
      if (userCode && userCode.id === usedByUserId) {
        throw new Error("You cannot use your own referral code.");
      }

      // NEW: Check if referral code has already approved 7 users
      const approvedUsageCount = await db
        .select({ count: sql`count(*)` })
        .from(referralUsage)
        .where(
          and(
            eq(referralUsage.referralCode, code),
            eq(referralUsage.status, "active") // Only count approved users
          )
        );

      const approvedCount = Number(approvedUsageCount[0].count);
      const REFERRAL_LIMIT = 7; // only for users account

      if (userCode && approvedCount >= REFERRAL_LIMIT) {
        return {
          isValid: false,
          message:
            "This referral code has reached its maximum usage limit and is no longer valid.",
          errorCode: "REFERRAL_CODE_MAXED_OUT",
        };
      }

      // Create PENDING referral usage
      await db.insert(referralUsage).values({
        referralCode: code,
        codeType: adminCode ? "admin" : "user",
        usedByUserId,
        codeOwnerId: userCode?.id || adminCode?.assignedToUserId,
        adminCreatorId: adminCode?.createdByAdminId,
        status: "pending",
        pointsToUser: 0,
        pointsToCodeOwner: 0,
        pointsToAdmin: 0,
      });

      // Update onboarding progress
      if (userOnboardingProgress.length > 0) {
        const currentFormData = userOnboardingProgress[0].formData || {};
        const updatedFormData = {
          ...currentFormData,
          referralCode: code,
        };

        await db
          .update(onboardingProgress)
          .set({
            referralCodeCompleted: true,
            formData: updatedFormData,
            updatedAt: new Date(),
          })
          .where(eq(onboardingProgress.userId, usedByUserId));
      } else {
        await db.insert(onboardingProgress).values({
          userId: usedByUserId,
          currentStep: "business-website",
          referralCodeCompleted: true,
          formData: { referralCode: code },
        });
      }

      return {
        isValid: true,
        type: adminCode ? "admin" : "user",
        remainingSlots: REFERRAL_LIMIT - approvedCount,
        message:
          "Referral code verified. Points will be allocated after approval.",
      };
    } catch (error) {
      console.error("Referral code verification error:", error);
      throw error;
    }
  },

  // Send OTP for phone verification
  async sendPhoneOTP(userId, phone) {
    try {
      // Generate OTP
      const otpCode = generateOTPCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Store OTP in database
      await db.insert(otpCodes).values({
        phone,
        code: otpCode,
        userId,
        expiresAt,
      });

      // Send SMS
      await smsService.sendOTP(phone, otpCode);

      return true;
    } catch (error) {
      throw new Error(error.message || "Failed to send OTP");
    }
  },

  // Verify phone OTP
  async verifyPhoneOTP(userId, phone, otpCode) {
    try {
      // Find valid OTP
      const [otp] = await db
        .select()
        .from(otpCodes)
        .where(
          and(
            eq(otpCodes.userId, userId),
            eq(otpCodes.phone, phone),
            eq(otpCodes.code, otpCode),
            eq(otpCodes.isUsed, false)
          )
        )
        .limit(1);

      if (!otp) {
        throw new Error("Invalid OTP code");
      }

      // Check if OTP is expired
      if (new Date() > otp.expiresAt) {
        throw new Error("OTP code has expired");
      }

      // Mark OTP as used
      await db
        .update(otpCodes)
        .set({
          isUsed: true,
          usedAt: new Date(),
        })
        .where(eq(otpCodes.id, otp.id));

      // Update user's phone and verification status
      const [updatedUser] = await db
        .update(users)
        .set({
          phone,
          phoneVerified: true,
          profileCompleted: true, // Mark profile as completed
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();

      const { password: _, ...userWithoutPassword } = updatedUser;

      await onboardingService.updateProgress(userId, {
        currentStep: "completed",
        stepCompleted: "otp-verification",
        formData: { phone },
      });

      return {
        user: userWithoutPassword,
      };
    } catch (error) {
      throw new Error(error.message || "Failed to verify OTP");
    }
  },

  async storeUserPhone(userId, phone) {
    // Update the user's phone
    const result = await db
      .update(users)
      .set({
        phone: phone,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        phone: users.phone,
      });

    if (!result.length) {
      throw new Error("User not found");
    }

    return result[0];
  },

  async completeUserProfile(userId, profileData) {
    try {
      const { businessName, website, instagram, creativeDomains } = profileData;

      // If no business name provided, extract from website as fallback
      let finalBusinessName = businessName;
      if (!finalBusinessName && website) {
        try {
          const websiteDomain = website
            .replace(/^https?:\/\/(www\.)?/, "")
            .split("/")[0];
          finalBusinessName =
            websiteDomain.split(".")[0].charAt(0).toUpperCase() +
            websiteDomain.split(".")[0].slice(1);
        } catch (error) {
          finalBusinessName = "Business"; // Ultimate fallback
        }
      }

      // Update user profile
      const [updatedUser] = await db
        .update(users)
        .set({
          businessName: finalBusinessName,
          website,
          instagram,
          creativeDomains,
          profileCompleted: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning();

      // First, fetch the current onboarding progress to get existing completed steps
      const [currentProgress] = await db
        .select()
        .from(onboardingProgress)
        .where(eq(onboardingProgress.userId, userId));

      // Prepare the updated completed steps array
      const existingSteps = currentProgress?.completedSteps || [];
      const updatedSteps = Array.isArray(existingSteps)
        ? [...new Set([...existingSteps, "creative-domain"])]
        : ["creative-domain"];

      // Update onboarding progress with completion timestamp
      await db
        .update(onboardingProgress)
        .set({
          currentStep: "creative-domain",
          completedSteps: updatedSteps, // Use the prepared array instead of SQL
          creativeDomainCompleted: true,
          onboardingCompleted: true,
          completedAt: new Date(),
          formData: {
            website,
            instagram,
            creativeDomain: creativeDomains,
          },
          updatedAt: new Date(),
        })
        .where(eq(onboardingProgress.userId, userId));

      const { password: _, ...userWithoutPassword } = updatedUser;

      return {
        user: userWithoutPassword,
      };
    } catch (error) {
      throw new Error(error.message || "Failed to complete profile");
    }
  },

  async initiatePasswordReset(email) {
    try {
      // Check if user exists

      const existingUser = await db
        .select()
        .from(users)
        .where(
          or(
            eq(users.email, email),
            sql`${users.originalDataBackup}::json ->> 'email' = ${email}`
          )
        )
        .limit(1);


      if (existingUser.length === 0) {
        // For security, don't reveal if email doesn't exist
        return {
          tokenSent: false,
          message: "User not found",
        };
      }

      const user = existingUser[0];

      // Generate secure random token
      const resetToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

      // Invalidate any existing tokens for this user
      await db
        .update(passwordResetTokens)
        .set({
          isUsed: true,
          usedAt: new Date(),
        })
        .where(
          and(
            eq(passwordResetTokens.userId, user.id),
            eq(passwordResetTokens.isUsed, false)
          )
        );

      // INSERT the email too!
      await db.insert(passwordResetTokens).values({
        userId: user.id,
        token: resetToken,
        email: user.email, // FIXED HERE
        expiresAt: expiresAt,
      });

      console.log(email)

      // console.log(user.email)
      // Send password reset email
      await emailService.sendPasswordResetEmail(email, resetToken);

      return {
        tokenSent: true,
        userId: user.id,
        email: user.email,
      };
    } catch (error) {
      console.error("Password reset initiation error:", error);
      throw new Error("Failed to initiate password reset");
    }
  },

  async resetPasswordWithToken(token, newPassword) {
    try {
      // Find valid token
      const tokenRecord = await db
        .select({
          id: passwordResetTokens.id,
          userId: passwordResetTokens.userId,
          expiresAt: passwordResetTokens.expiresAt,
          isUsed: passwordResetTokens.isUsed,
          userEmail: users.email,
        })
        .from(passwordResetTokens)
        .innerJoin(users, eq(passwordResetTokens.userId, users.id))
        .where(eq(passwordResetTokens.token, token))
        .limit(1);

      if (tokenRecord.length === 0) {
        throw new Error("Invalid or expired reset token");
      }

      const tokenData = tokenRecord[0];

      // Check if token is already used
      if (tokenData.isUsed) {
        throw new Error("This reset token has already been used");
      }

      // Check if token is expired
      if (new Date() > new Date(tokenData.expiresAt)) {
        throw new Error(
          "Reset token has expired. Please request a new password reset link."
        );
      }

      // Hash the new password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update user's password
      await db
        .update(users)
        .set({
          password: hashedPassword,
          updatedAt: new Date(),
        })
        .where(eq(users.id, tokenData.userId));

      // Mark token as used
      await db
        .update(passwordResetTokens)
        .set({
          isUsed: true,
          usedAt: new Date(),
        })
        .where(eq(passwordResetTokens.id, tokenData.id));

      return {
        userId: tokenData.userId,
        email: tokenData.userEmail,
      };
    } catch (error) {
      console.error("Password reset error:", error);
      throw new Error(error.message || "Failed to reset password");
    }
  },

  async sendEmailVerification(email, userId) {
    try {
      // Generate secure random token
      const verificationToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Invalidate any existing tokens for this user
      await db
        .update(emailVerificationTokens)
        .set({
          isUsed: true,
          usedAt: new Date(),
        })
        .where(
          and(
            eq(emailVerificationTokens.userId, userId),
            eq(emailVerificationTokens.isUsed, false)
          )
        );

      // Insert new verification token
      await db.insert(emailVerificationTokens).values({
        userId: userId,
        token: verificationToken,
        email: email,
        expiresAt: expiresAt,
      });

      // Send verification email with clickable link
      await emailService.sendEmailVerification(email, verificationToken);

      return {
        tokenSent: true,
        email: email,
      };
    } catch (error) {
      console.error("Send email verification error:", error);
      throw new Error("Failed to send verification email");
    }
  },

  async verifyEmailWithToken(token) {
    try {
      // Find valid token
      const tokenRecord = await db
        .select({
          id: emailVerificationTokens.id,
          userId: emailVerificationTokens.userId,
          expiresAt: emailVerificationTokens.expiresAt,
          isUsed: emailVerificationTokens.isUsed,
          email: emailVerificationTokens.email,
        })
        .from(emailVerificationTokens)
        .where(eq(emailVerificationTokens.token, token))
        .limit(1);

      if (tokenRecord.length === 0) {
        throw new Error("Invalid or expired verification token");
      }

      const tokenData = tokenRecord[0];

      // Check if token is already used
      if (tokenData.isUsed) {
        throw new Error("This verification token has already been used");
      }

      // Check if token is expired
      if (new Date() > new Date(tokenData.expiresAt)) {
        throw new Error(
          "Verification token has expired. Please request a new verification email."
        );
      }

      // Update user's email verification status
      const updatedUser = await db
        .update(users)
        .set({
          emailVerified: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, tokenData.userId))
        .returning();

      // Mark token as used
      await db
        .update(emailVerificationTokens)
        .set({
          isUsed: true,
          usedAt: new Date(),
        })
        .where(eq(emailVerificationTokens.id, tokenData.id));

      return {
        user: updatedUser[0],
        emailVerified: true,
      };
    } catch (error) {
      console.error("Email verification error:", error);
      throw new Error(error.message || "Failed to verify email");
    }
  },

  async resendEmailVerification(email) {
    try {
      // Check if user exists
      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existingUser.length === 0) {
        throw new Error("User not found");
      }

      const user = existingUser[0];

      // Check if email is already verified
      if (user.emailVerified) {
        throw new Error("Email is already verified");
      }

      // Send new verification email
      const result = await this.sendEmailVerification(email, user.id);

      return result;
    } catch (error) {
      console.error("Resend email verification error:", error);
      throw new Error(error.message || "Failed to resend verification email");
    }
  },

  async verifyResetToken(token) {
    try {
      const tokenRecord = await db
        .select({
          userId: passwordResetTokens.userId,
          expiresAt: passwordResetTokens.expiresAt,
          isUsed: passwordResetTokens.isUsed,
          userEmail: users.email,
        })
        .from(passwordResetTokens)
        .innerJoin(users, eq(passwordResetTokens.userId, users.id))
        .where(eq(passwordResetTokens.token, token))
        .limit(1);

      if (tokenRecord.length === 0) {
        throw new Error("Invalid reset token");
      }

      const tokenData = tokenRecord[0];

      if (tokenData.isUsed) {
        throw new Error("This reset token has already been used");
      }

      if (new Date() > new Date(tokenData.expiresAt)) {
        throw new Error("Reset token has expired");
      }

      return {
        valid: true,
        email: tokenData.userEmail,
        userId: tokenData.userId,
      };
    } catch (error) {
      throw new Error(error.message || "Invalid or expired token");
    }
  },

  // Refresh user token
  async refreshUserToken(refreshToken) {
    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

      // Find user
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, decoded.userId))
        .limit(1);

      if (!user) {
        throw new Error("Invalid refresh token");
      }

      // Generate new tokens
      const { generateToken } = require("../utils/helpers");
      const { accessToken, refreshToken: newRefreshToken } = generateToken(
        user.id
      );

      return {
        accessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      throw new Error("Invalid refresh token");
    }
  },

  // Get user profile
  async getUserProfile(userId) {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        throw new Error("User not found");
      }

      const { password: _, ...userWithoutPassword } = user;

      return userWithoutPassword;
    } catch (error) {
      throw new Error(error.message || "Failed to get user profile");
    }
  },

  async checkUserAccess(userId) {

    console.log("User access is checked")

    try {
      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          status: users.status,
          isAnonymous: users.isAnonymous,
          anonymousId: users.anonymousId,
          anonymousActivatedAt: users.anonymousActivatedAt,
          userType: users.userType,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        throw new Error("User not found");
      }

      return {
        userType: user.userType,
        canAccess: user.status === "approved",
        isAnonymous: user.isAnonymous,
        status: user.status,
        profileCompleted: user.profileCompleted,
      };
    } catch (error) {
      throw new Error(error.message || "Failed to check user access");
    }
  },

  // Add these methods to your authService.js
  async findUserByEmail(email) {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!user) {
        return null;
      }

      const { password: _, ...userWithoutPassword } = user;
      return userWithoutPassword;
    } catch (error) {
      throw new Error("Failed to find user");
    }
  },

  async createGoogleUser({
    email,
    firstName,
    lastName,
    profilePicture,
    userType = "creative",
  }) {
    try {
      const personalReferralCode = generateReferralCode();

      const [newUser] = await db
        .insert(users)
        .values({
          email,
          firstName,
          lastName,
          profilePicture,
          userType,
          personalReferralCode,
          googleAuth: true,
          googleEmailVerified: true,
          emailVerified: true,
        })
        .returning();

      const { password: _, ...userWithoutPassword } = newUser;

      return {
        user: userWithoutPassword,
      };
    } catch (error) {
      throw new Error(error.message || "Failed to create Google user");
    }
  },
  async updateUserLastLogin(userId) {
    try {
      await db
        .update(users)
        .set({
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    } catch (error) {
      console.error("Failed to update last login:", error);
    }
  },

  async checkInstagramExists(instagram) {
    try {

      const cleanInstagram = instagram.toLowerCase();

      console.log("Incoming Instagram:", cleanInstagram);

      if (!cleanInstagram) {
        return {
          exists: false,
          message: "Instagram handle is required",
        };
      }

      /* ============================
         CHECK CURRENT instagram
      ============================ */
      const directMatch = await db
        .select({ id: users.id, instagram: users.instagram })
        .from(users)
        .where(
          and(
            sql`LOWER(${users.instagram}) = ${cleanInstagram}`,
            ne(users.status, "rejected")
          )
        )
        .limit(1);

      if (directMatch.length) {
        return {
          exists: true,
          message: "Instagram already used (current profile)",
        };
      }

      /* ============================
         CHECK originalDataBackup
         approved users only
      ============================ */
      const backupCandidates = await db
        .select({
          id: users.id,
          status: users.status,
          originalDataBackup: users.originalDataBackup,
        })
        .from(users)
        .where(eq(users.status, "approved"));

      for (const user of backupCandidates) {
        if (!user.originalDataBackup) continue;

        let backup;
        try {
          backup = JSON.parse(user.originalDataBackup);
        } catch {
          console.warn("Invalid JSON in originalDataBackup:", user.id);
          continue;
        }

        const backupInstagram = backup.instagram;

        if (backupInstagram === cleanInstagram) {
          console.log("Matched in originalDataBackup for user:", user.id);

          return {
            exists: true,
            message: "Instagram already used (original backup)",
          };
        }
      }

      return {
        exists: false,
        message: "Instagram handle available",
      };
    } catch (error) {
      console.error("Instagram check error:", error);
      throw new Error("Failed to check Instagram availability");
    }
  }

  ,

};




module.exports = authService;
