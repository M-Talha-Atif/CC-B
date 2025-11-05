const { eq, and, sql } = require("drizzle-orm");
const { db } = require("../config/database");
const { users, onboardingProgress } = require("../models/schema");

const onboardingService = {
  // Initialize onboarding progress for a new user
  async initializeProgress(userId, initialStep = "landing") {
    try {
      const [progress] = await db
        .insert(onboardingProgress)
        .values({
          userId,
          currentStep: initialStep,
          completedSteps: [],
          formData: {},
        })
        .returning();

      return progress;
    } catch (error) {
      // Handle case where progress already exists
      if (error.code === "23505") {
        // unique constraint violation
        return await this.getProgress(userId);
      }
      throw new Error(
        error.message || "Failed to initialize onboarding progress"
      );
    }
  },

  // Get user's onboarding progress
  async getProgress(userId) {
    try {
      const [progress] = await db
        .select()
        .from(onboardingProgress)
        .where(eq(onboardingProgress.userId, userId))
        .limit(1);

      if (!progress) {
        // Create initial progress if doesn't exist
        return await this.initializeProgress(userId);
      }

      return progress;
    } catch (error) {
      throw new Error(error.message || "Failed to get onboarding progress");
    }
  },

  // Update onboarding progress
  async updateProgress(userId, updates) {
    try {
      const { currentStep, formData, stepCompleted } = updates;

      // Get current progress to merge data
      const currentProgress = await this.getProgress(userId);

      // Merge form data
      const mergedFormData = {
        ...currentProgress.formData,
        ...formData,
      };

      // Update completed steps if a step was completed
      let completedSteps = currentProgress.completedSteps || [];
      let stepCompletionUpdates = {};

      if (stepCompleted) {
        if (!completedSteps.includes(stepCompleted)) {
          completedSteps.push(stepCompleted);
        }

        // Updated step completion map - removed business-name references
        const stepCompletionMap = {
          "email-login": { emailPasswordCompleted: true },
          "phone-number": { phoneNumberCompleted: true },
          "referral-code": { referralCodeCompleted: true },
          // "business-name": removed entirely
          "business-website": { websiteCompleted: true },
          "business-instagram": { instagramCompleted: true },
          "creative-domain": {
            creativeDomainCompleted: true,
            onboardingCompleted: true,
            completedAt: new Date(),
          },
        };

        stepCompletionUpdates = stepCompletionMap[stepCompleted] || {};
      }

      const [updatedProgress] = await db
        .update(onboardingProgress)
        .set({
          currentStep: currentStep || currentProgress.currentStep,
          completedSteps,
          formData: mergedFormData,
          ...stepCompletionUpdates,
          updatedAt: new Date(),
        })
        .where(eq(onboardingProgress.userId, userId))
        .returning();

      return updatedProgress;
    } catch (error) {
      throw new Error(error.message || "Failed to update onboarding progress");
    }
  },

  async determineNextStep(userId) {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        throw new Error("User not found");
      }

      const progress = await this.getProgress(userId);

      // If onboarding is completed, redirect to home
      if (progress.onboardingCompleted) {
        return { step: "completed", redirectTo: "/home" };
      }

      if (!user.emailVerified) {
        return { step: "email-verification", formData: progress.formData };
      }

      // STEP 1: Phone number
      if (!progress.phoneNumberCompleted) {
        return { step: "phone-number", formData: progress.formData };
      }

      // STEP 2: Referral Code
      if (!progress.referralCodeCompleted) {
        return { step: "referral-code", formData: progress.formData };
      }

      // STEP 3: Website (Skip business name entirely)
      if (!progress.websiteCompleted) {
        return { step: "business-website", formData: progress.formData };
      }

      // STEP 4: Instagram
      if (!progress.instagramCompleted) {
        return { step: "business-instagram", formData: progress.formData };
      }

      // STEP 5: Creative Domain
      if (!progress.creativeDomainCompleted) {
        return { step: "creative-domain", formData: progress.formData };
      }

      // If all steps are done but onboarding not marked as complete (fallback)
      await this.updateProgress(userId, {
        currentStep: "completed",
        stepCompleted: null,
      });

      await db
        .update(onboardingProgress)
        .set({
          onboardingCompleted: true,
          completedAt: new Date(),
        })
        .where(eq(onboardingProgress.userId, userId));

      return { step: "completed", redirectTo: "/home" };
    } catch (error) {
      throw new Error(error.message || "Failed to determine next step");
    }
  },

  async resetProgress(userId, fromStep = "referral-code") {
    try {
      await db
        .update(onboardingProgress)
        .set({
          currentStep: fromStep,
          completedSteps: [],
          formData: {},
          emailPasswordCompleted: false,
          referralCodeCompleted: false,
          // businessNameCompleted: false, // Remove this field
          websiteCompleted: false,
          instagramCompleted: false,
          creativeDomainCompleted: false,
          phoneNumberCompleted: false,
          otpVerificationCompleted: false,
          onboardingCompleted: false,
          completedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(onboardingProgress.userId, userId));

      return await this.getProgress(userId);
    } catch (error) {
      throw new Error(error.message || "Failed to reset onboarding progress");
    }
  },
};

module.exports = onboardingService;
