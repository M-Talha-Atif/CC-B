const { db } = require('../config/database');
const { users } = require('../models/schema');
const { eq, and } = require('drizzle-orm');
const EncryptionService = require('../utils/encryption');

const AnonymousController = {
  async activateAnonymousMode(req, res) {
    try {
      const userId = req.user.id;

      // Get current user data
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId));

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (user.isAnonymous) {
        return res.status(400).json({ error: 'User is already in anonymous mode' });
      }

      // Create backup of original data
      const originalData = {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        businessName: user.businessName,
        website: user.website,
        instagram: user.instagram,
        phone: user.phone,
        profilePicture: user.profilePicture
      };

      // Encrypt sensitive data
      const encryptedData = EncryptionService.encryptUserData(user);
      const anonymousId = EncryptionService.generateAnonymousId();

      // Update user record
      await db
        .update(users)
        .set({
          isAnonymous: true,
          encryptedData: JSON.stringify(encryptedData),
          anonymousId: anonymousId,
          anonymousActivatedAt: new Date(),
          originalDataBackup: JSON.stringify(originalData),
          // Replace sensitive fields with anonymous values
          email: `${anonymousId}@anonymous.local`,
          firstName: 'Anonymous',
          lastName: 'User',
          businessName: `Anonymous Creative ${anonymousId.slice(-8)}`,
          website: null,
          instagram: null,
          phone: null,
          profilePicture: null
        })
        .where(eq(users.id, userId));

      res.json({ 
        success: true, 
        message: 'Anonymous mode activated successfully',
        anonymousId: anonymousId
      });

    } catch (error) {
      console.error('Error activating anonymous mode:', error);
      res.status(500).json({ error: 'Failed to activate anonymous mode' });
    }
  },

  async deactivateAnonymousMode(req, res) {
    try {
      const userId = req.user.id;

      // Get current user data
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId));

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (!user.isAnonymous) {
        return res.status(400).json({ error: 'User is not in anonymous mode' });
      }

      // Decrypt original data
      let originalData;
      try {
        originalData = JSON.parse(user.originalDataBackup);
      } catch (error) {
        return res.status(400).json({ error: 'Cannot restore original data' });
      }

      // Restore original user data
      await db
        .update(users)
        .set({
          isAnonymous: false,
          encryptedData: null,
          anonymousId: null,
          anonymousActivatedAt: null,
          originalDataBackup: null,
          email: originalData.email,
          firstName: originalData.firstName,
          lastName: originalData.lastName,
          businessName: originalData.businessName,
          website: originalData.website,
          instagram: originalData.instagram,
          phone: originalData.phone,
          profilePicture: originalData.profilePicture
        })
        .where(eq(users.id, userId));

      res.json({ 
        success: true, 
        message: 'Anonymous mode deactivated successfully'
      });

    } catch (error) {
      console.error('Error deactivating anonymous mode:', error);
      res.status(500).json({ error: 'Failed to deactivate anonymous mode' });
    }
  },

  async getAnonymousStatus(req, res) {
    try {
      const userId = req.user.id;

      const [user] = await db
        .select({
          isAnonymous: users.isAnonymous,
          anonymousId: users.anonymousId,
          anonymousActivatedAt: users.anonymousActivatedAt
        })
        .from(users)
        .where(eq(users.id, userId));

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({
        isAnonymous: user.isAnonymous,
        anonymousId: user.anonymousId,
        anonymousActivatedAt: user.anonymousActivatedAt
      });

    } catch (error) {
      console.error('Error getting anonymous status:', error);
      res.status(500).json({ error: 'Failed to get anonymous status' });
    }
  }
};

module.exports = AnonymousController;
