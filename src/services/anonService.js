// services/anonymousService.js
const { db } = require("../config/database");
const { users } = require("../models/schema");
const { eq, and } = require("drizzle-orm");
const EncryptionService = require("../utils/encryption");

class AnonymousService {
  /**
   * Get user data - handles both anonymous and regular users
   * Returns decrypted data for anonymous users, regular data for normal users
   */
  static async getUserData(userId) {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, userId));

      if (!user) {
        throw new Error("User not found");
      }

      // If user is anonymous, decrypt their data
      if (user.isAnonymous && user.encryptedData) {
        const decryptedData = EncryptionService.decryptUserData(
          JSON.parse(user.encryptedData)
        );

        if (decryptedData) {
          // Return user with decrypted data for backend use
          return {
            ...user,
            // Override anonymous fields with real data for backend processing
            email: decryptedData.email,
            firstName: decryptedData.firstName,
            lastName: decryptedData.lastName,
            businessName: decryptedData.businessName,
            website: decryptedData.website,
            instagram: decryptedData.instagram,
            phone: decryptedData.phone,
            profilePicture: decryptedData.profilePicture,
            // Keep anonymous display data separate
            displayEmail: user.email, // This is the anonymous email
            displayFirstName: user.firstName,
            displayLastName: user.lastName,
            displayBusinessName: user.businessName,
          };
        }
      }

      // Return regular user data
      return user;
    } catch (error) {
      console.error("Error getting user data:", error);
      throw error;
    }
  }

  /**
   * Get display data for frontend - shows encrypted/anonymous data for anonymous users
   */
  static async getDisplayUserData(userId) {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, userId));

      if (!user) {
        throw new Error("User not found");
      }

      // For anonymous users, return the encrypted/anonymous display data
      if (user.isAnonymous) {
        return {
          id: user.id,
          email: user.email, // Anonymous email
          firstName: user.firstName, // "Anonymous"
          lastName: user.lastName, // "User"
          businessName: user.businessName, // Anonymous business name
          website: user.website, // null
          instagram: user.instagram, // null
          phone: user.phone, // null
          profilePicture: user.profilePicture, // null
          isAnonymous: user.isAnonymous,
          anonymousId: user.anonymousId,
          userType: user.userType,
          profileCompleted: user.profileCompleted,
          // Don't expose encrypted data or backup
        };
      }

      // For regular users, return normal data (excluding sensitive fields)
      const { password, encryptedData, originalDataBackup, ...displayUser } =
        user;
      return displayUser;
    } catch (error) {
      console.error("Error getting display user data:", error);
      throw error;
    }
  }

  /**
   * Login handler that works with both regular and anonymous users
   */
  static async authenticateUser(email, password) {
    try {
      // First, try to find regular user
      let user = await db
        .select()
        .from(users)
        .where(and(eq(users.email, email), eq(users.isAnonymous, false)))
        .limit(1);

      // If no regular user found, check for anonymous user by decrypting
      if (user.length === 0) {
        const anonymousUsers = await db
          .select()
          .from(users)
          .where(eq(users.isAnonymous, true));

        // Check each anonymous user to see if their real email matches
        for (const anonUser of anonymousUsers) {
          if (anonUser.encryptedData) {
            const decryptedData = EncryptionService.decryptUserData(
              JSON.parse(anonUser.encryptedData)
            );

            if (decryptedData && decryptedData.email === email) {
              user = [anonUser];
              break;
            }
          }
        }
      }

      if (user.length === 0) {
        throw new Error("User not found");
      }

      // Get the actual user data (decrypted if anonymous)
      const userData = await this.getUserData(user[0].id);

      // Verify password against real email (works for both anonymous and regular)
      const bcrypt = require("bcrypt");
      const isPasswordValid = await bcrypt.compare(password, userData.password);

      if (!isPasswordValid) {
        throw new Error("Invalid credentials");
      }

      return userData;
    } catch (error) {
      console.error("Error authenticating user:", error);
      throw error;
    }
  }

  /**
   * Check if user exists by real email (handles anonymous users)
   */
  static async findUserByRealEmail(email) {
    try {
      // Check regular users first
      let user = await db
        .select()
        .from(users)
        .where(and(eq(users.email, email), eq(users.isAnonymous, false)))
        .limit(1);

      if (user.length > 0) {
        return user[0];
      }

      // Check anonymous users
      const anonymousUsers = await db
        .select()
        .from(users)
        .where(eq(users.isAnonymous, true));

      for (const anonUser of anonymousUsers) {
        if (anonUser.encryptedData) {
          const decryptedData = EncryptionService.decryptUserData(
            JSON.parse(anonUser.encryptedData)
          );

          if (decryptedData && decryptedData.email === email) {
            return anonUser;
          }
        }
      }

      return null;
    } catch (error) {
      console.error("Error finding user by real email:", error);
      throw error;
    }
  }

  /**
   * Get user display name - handles anonymous users
   */
  static getUserDisplayName(userData) {
    if (userData.isAnonymous) {
      // Use the anonymous display name
      return (
        userData.displayBusinessName ||
        `${userData.displayFirstName} ${userData.displayLastName}`.trim() ||
        "Anonymous User"
      );
    }

    // Use real name for regular users
    return (
      userData.businessName ||
      `${userData.firstName} ${userData.lastName}`.trim() ||
      "User"
    );
  }

  /**
   * Update user data - handles encryption for anonymous users
   */
  static async updateUserData(userId, updateData) {
    try {
      const currentUser = await this.getUserData(userId);

      if (currentUser.isAnonymous) {
        // For anonymous users, we need to update both encrypted data and display data
        const sensitiveFields = [
          "email",
          "firstName",
          "lastName",
          "businessName",
          "website",
          "instagram",
          "phone",
          "profilePicture",
        ];

        let encryptedUpdate = {};
        let displayUpdate = {};
        let regularUpdate = {};

        // Separate sensitive fields from regular fields
        Object.keys(updateData).forEach((key) => {
          if (sensitiveFields.includes(key)) {
            encryptedUpdate[key] = updateData[key];
          } else {
            regularUpdate[key] = updateData[key];
          }
        });

        // If updating sensitive fields, re-encrypt
        if (Object.keys(encryptedUpdate).length > 0) {
          const currentEncrypted = JSON.parse(currentUser.encryptedData);
          const currentDecrypted =
            EncryptionService.decryptUserData(currentEncrypted);

          // Merge updates with current data
          const updatedSensitiveData = {
            ...currentDecrypted,
            ...encryptedUpdate,
          };
          const newEncryptedData =
            EncryptionService.encryptUserData(updatedSensitiveData);

          regularUpdate.encryptedData = JSON.stringify(newEncryptedData);

          // Update backup as well
          const currentBackup = JSON.parse(currentUser.originalDataBackup);
          const updatedBackup = { ...currentBackup, ...encryptedUpdate };
          regularUpdate.originalDataBackup = JSON.stringify(updatedBackup);
        }

        // Update the database
        await db
          .update(users)
          .set({ ...regularUpdate, updatedAt: new Date() })
          .where(eq(users.id, userId));
      } else {
        // Regular user update
        await db
          .update(users)
          .set({ ...updateData, updatedAt: new Date() })
          .where(eq(users.id, userId));
      }
    } catch (error) {
      console.error("Error updating user data:", error);
      throw error;
    }
  }

  /**
   * Middleware to add user data to request object
   */
  static async addUserDataToRequest(req, res, next) {
    try {
      if (req.user && req.user.id) {
        // Get full user data (decrypted if anonymous)
        req.userData = await AnonymousService.getUserData(req.user.id);

        // Get display data for frontend responses
        req.userDisplay = await AnonymousService.getDisplayUserData(
          req.user.id
        );
      }
      next();
    } catch (error) {
      console.error("Error adding user data to request:", error);
      next();
    }
  }

  /**
   * Helper to format user data for API responses
   */
  static formatUserForResponse(userData, includePrivate = false) {
    if (userData.isAnonymous) {
      const response = {
        id: userData.id,
        email: userData.displayEmail, // Show anonymous email
        firstName: userData.displayFirstName,
        lastName: userData.displayLastName,
        businessName: userData.displayBusinessName,
        website: userData.website,
        instagram: userData.instagram,
        phone: userData.phone,
        profilePicture: userData.profilePicture,
        isAnonymous: userData.isAnonymous,
        userType: userData.userType,
        personalReferralCode: userData.personalReferralCode,
        profileCompleted: userData.profileCompleted,
      };

      // Include real data only if explicitly requested (for admin use)
      if (includePrivate) {
        response.realEmail = userData.email;
        response.realFirstName = userData.firstName;
        response.realLastName = userData.lastName;
        response.realBusinessName = userData.businessName;
      }

      return response;
    }

    // Regular user - exclude sensitive fields
    const { password, encryptedData, originalDataBackup, ...userResponse } =
      userData;
    return userResponse;
  }
}

module.exports = AnonymousService;
