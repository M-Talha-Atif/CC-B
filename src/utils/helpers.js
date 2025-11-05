const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const helpers = {
  generateToken(userId) {
    const accessToken = jwt.sign(
      { userId: userId, type: "access" },
      process.env.JWT_SECRET,
      { expiresIn: "30d" } // Changed from 7d
    );

    const refreshToken = jwt.sign(
      { userId: userId, type: "refresh" },
      process.env.JWT_SECRET,
      { expiresIn: "180d" } // Changed from 90d
    );
    return { accessToken, refreshToken };
  },

  verifyToken(token, isRefreshToken = false) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      throw new Error("Invalid or expired token");
    }
  },

  // ... rest of your helpers stay the same
  generateReferralCode(length = 6) {
    if (length === 6) {
      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const numbers = "0123456789";
      let result = "";
      for (let i = 0; i < 3; i++) {
        result += letters.charAt(Math.floor(Math.random() * letters.length));
      }
      for (let i = 0; i < 3; i++) {
        result += numbers.charAt(Math.floor(Math.random() * numbers.length));
      }
      return result;
    }
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += characters.charAt(
        Math.floor(Math.random() * characters.length)
      );
    }
    return result;
  },

  generateOTPCode(length = 6) {
    const digits = "0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += digits.charAt(Math.floor(Math.random() * digits.length));
    }
    return result;
  },

  getHourBoundaries: (now) => {
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);

    const hourEnd = new Date(hourStart);
    hourEnd.setHours(hourEnd.getHours() + 1);

    return { hourStart, hourEnd };
  },

  getRateLimitKey: (userId, now) => {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hour = String(now.getHours()).padStart(2, "0");

    return `${userId}_${year}-${month}-${day}-${hour}`;
  },

  generateResetToken() {
    return crypto.randomBytes(32).toString("hex");
  },

  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  },

  isBusinessEmail(email) {
    if (!this.isValidEmail(email)) return false;
    const domain = email.split("@")[1].toLowerCase();
    const personalProviders = [
      "gmail.com",
      "yahoo.com",
      "hotmail.com",
      "outlook.com",
      "aol.com",
      "icloud.com",
      "live.com",
      "msn.com",
      "ymail.com",
    ];
    return !personalProviders.includes(domain);
  },

  isValidPhoneNumber(phone) {
    const cleanPhone = phone.replace(/[\s()-]/g, "");
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(cleanPhone);
  },

  isStrongPassword(password) {
    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    return passwordRegex.test(password);
  },

  isValidURL(url) {
    try {
      new URL(url);
      return true;
    } catch (error) {
      return false;
    }
  },

  formatPhoneNumber(phone) {
    const cleaned = phone.replace(/[^\d+]/g, "");
    if (!cleaned.startsWith("+") && cleaned.length > 10) {
      return "+" + cleaned;
    }
    return cleaned;
  },

  sanitizeInstagramHandle(handle) {
    return handle.replace(/^@/, "").replace(/[^a-zA-Z0-9._]/g, "");
  },

  generateUniqueFilename(originalName) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const ext = originalName.split(".").pop();
    return `${timestamp}_${random}.${ext}`;
  },

  calculatePoints(action) {
    const pointsMap = {
      signup: 50,
      referral_used: 100,
      profile_completed: 150,
      phone_verified: 75,
      first_booking: 200,
      review_given: 25,
      review_received: 50,
    };
    return pointsMap[action] || 0;
  },

  formatResponse(success, message, data = null, errors = null) {
    const response = {
      success,
      message,
      timestamp: new Date().toISOString(),
    };
    if (data) response.data = data;
    if (errors) response.errors = errors;
    return response;
  },

  paginate(page = 1, limit = 10) {
    const offset = (page - 1) * limit;
    return {
      limit: parseInt(limit),
      offset: parseInt(offset),
      page: parseInt(page),
    };
  },

  generateSlug(text) {
    return text
      .toLowerCase()
      .replace(/[^\w ]+/g, "")
      .replace(/ +/g, "-")
      .trim();
  },

  getRateLimitKey(userId, date = new Date()) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const hour = String(date.getUTCHours()).padStart(2, "0");
    return `${userId}_${year}-${month}-${day}-${hour}`;
  },

  getHourBoundaries(date = new Date()) {
    const now = new Date(date);
    const hourStart = new Date(now);
    hourStart.setUTCMinutes(0, 0, 0);
    const hourEnd = new Date(hourStart);
    hourEnd.setUTCHours(hourEnd.getUTCHours() + 1);
    return { hourStart, hourEnd };
  },

  maskEmail(email) {
    const [username, domain] = email.split("@");
    const maskedUsername =
      username.substring(0, 2) + "*".repeat(username.length - 2);
    return `${maskedUsername}@${domain}`;
  },

  maskPhone(phone) {
    if (phone.length <= 4) return phone;
    const lastFour = phone.slice(-4);
    const masked = "*".repeat(phone.length - 4);
    return masked + lastFour;
  },

  addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60000);
  },

  addDays(date, days) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  },

  isExpired(date) {
    return new Date() > new Date(date);
  },

  isDevelopment() {
    return process.env.NODE_ENV === "development";
  },

  isProduction() {
    return process.env.NODE_ENV === "production";
  },
};

module.exports = helpers;
