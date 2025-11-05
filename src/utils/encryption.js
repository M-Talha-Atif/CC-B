const crypto = require('crypto');

// Ensure the key is exactly 32 bytes for AES-256
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY 
  ? crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY).digest()
  : null;
const ALGORITHM = 'aes-256-cbc';

class EncryptionService {
  static encrypt(text) {
    if (!text) return null;
    
    // Generate a random IV for each encryption
    const iv = crypto.randomBytes(16);
    
    // Create cipher with key and IV
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return {
      iv: iv.toString('hex'),
      encryptedData: encrypted
    };
  }

  static decrypt(encryptedObj) {
    if (!encryptedObj || !encryptedObj.encryptedData || !encryptedObj.iv) return null;
    
    try {
      // Convert IV back to buffer
      const iv = Buffer.from(encryptedObj.iv, 'hex');
      
      // Create decipher with key and IV
      const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
      
      let decrypted = decipher.update(encryptedObj.encryptedData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('Decryption error:', error);
      return null;
    }
  }

  static generateAnonymousId() {
    return `anon_${crypto.randomBytes(16).toString('hex')}`;
  }

  static encryptUserData(userData) {
    const sensitiveFields = {
      email: userData.email,
      firstName: userData.firstName,
      lastName: userData.lastName,
      businessName: userData.businessName,
      website: userData.website,
      instagram: userData.instagram,
      phone: userData.phone,
      profilePicture: userData.profilePicture
    };

    const dataToEncrypt = JSON.stringify(sensitiveFields);
    return this.encrypt(dataToEncrypt);
  }

  static decryptUserData(encryptedData) {
    const decryptedString = this.decrypt(encryptedData);
    return decryptedString ? JSON.parse(decryptedString) : null;
  }

  // Helper method to validate encryption key
  static validateEncryptionKey() {
    if (!process.env.ENCRYPTION_KEY) {
      throw new Error('ENCRYPTION_KEY environment variable is required');
    }
    
    if (!ENCRYPTION_KEY) {
      throw new Error('Failed to process encryption key');
    }
    
    // Key is now properly hashed to 32 bytes, so this should always pass
    if (ENCRYPTION_KEY.length !== 32) {
      throw new Error('Processed encryption key must be exactly 32 bytes');
    }
  }
}

module.exports = EncryptionService;