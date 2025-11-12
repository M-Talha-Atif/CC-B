const jwt = require("jsonwebtoken");
const { db } = require("../config/database");
const { users } = require("../models/schema");
const { eq, and, gt } = require("drizzle-orm");
const AnonymousService = require("../services/anonService");

const authenticateToken = (req, res, next) => {
  const cookieToken = req.cookies?.token;
  const refreshToken = req.cookies?.refreshToken;
  const headerToken = req.headers.authorization?.split(" ")[1];
  const token = cookieToken || headerToken;

  console.log("🍪 Cookies:", req.cookies);
  console.log("🔐 Header token:", headerToken ? headerToken.substring(0, 15) + "..." : "None");

  if (!refreshToken) {
    // console.log("no token found")
    return res.status(401).json({ success: false, message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.userId };
    next();
  } catch (err) {
    console.log("❌ Token verification failed:", err.message);
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Token expired" });
    }
    return res.status(403).json({ success: false, message: "Invalid token" });
  }
};


// const authenticateToken = (req, res, next) => {
//   const token = req.cookies.token;

//   if (!token) {
//     return res.status(401).json({ success: false, message: "No token provided" });
//   }

//   try {
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);
//     req.user = { id: decoded.userId };
//     next();
//   } catch (error) {
//     if (error.name === "TokenExpiredError") {
//       return res.status(401).json({ success: false, message: "Token expired" });
//     }
//     return res.status(403).json({ success: false, message: "Invalid token" });
//   }
// };


const optionalAuthenticateToken = async (req, res, next) => {
  try {
    // 🔥 CHECK BOTH COOKIES AND AUTHORIZATION HEADER
    let token = null;

    // First, try to get from Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }

    // If not in header, try cookies
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    // If no token provided, continue as unauthenticated user
    if (!token) {
      req.user = null;
      req.token = null;
      return next();
    }

    try {
      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Get user details
      const user = await db
        .select({
          id: users.id,
          email: users.email,
          userType: users.userType,
          businessName: users.businessName,
          website: users.website,
          instagram: users.instagram,
          creativeDomains: users.creativeDomains,
          phone: users.phone,
          emailVerified: users.emailVerified,
          phoneVerified: users.phoneVerified,
          profileCompleted: users.profileCompleted,
          points: users.points,
        })
        .from(users)
        .where(eq(users.id, decoded.userId))
        .limit(1);

      if (user.length === 0) {
        console.warn(
          "Token provided but user not found, continuing as unauthenticated"
        );
        req.user = null;
        req.token = null;
        return next();
      }

      // Set authenticated user data
      req.user = user[0];
      req.token = token;
    } catch (tokenError) {
      console.warn(
        "Invalid or expired token provided, continuing as unauthenticated:",
        tokenError.message
      );
      req.user = null;
      req.token = null;
    }

    next();
  } catch (error) {
    console.error("Optional auth middleware error:", error);
    req.user = null;
    req.token = null;
    next();
  }
};

// Enhanced version of handleAnonymousUser that works with optional auth
const handleOptionalAnonymousUser = async (req, res, next) => {
  try {
    // Only process if user is authenticated
    if (req.user && req.user.id) {
      // Get full user data (decrypted if anonymous) for backend processing
      req.userData = await AnonymousService.getUserData(req.user.id);

      // Get display data for frontend responses
      req.userDisplay = await AnonymousService.getDisplayUserData(req.user.id);

      // Add helper method to format user for responses
      req.formatUserForResponse = (includePrivate = false) => {
        return AnonymousService.formatUserForResponse(
          req.userData,
          includePrivate
        );
      };
    } else {
      // Set null values for unauthenticated users
      req.userData = null;
      req.userDisplay = null;
      req.formatUserForResponse = null;
    }

    next();
  } catch (error) {
    console.error("Error in optional anonymous middleware:", error);
    // Don't fail the request, just continue without the data
    req.userData = null;
    req.userDisplay = null;
    req.formatUserForResponse = null;
    next();
  }
};

const handleAnonymousUser = async (req, res, next) => {
  try {
    if (req.user && req.user.id) {
      // Get full user data (decrypted if anonymous) for backend processing
      req.userData = await AnonymousService.getUserData(req.user.id);

      // Get display data for frontend responses
      req.userDisplay = await AnonymousService.getDisplayUserData(req.user.id);

      // Add helper method to format user for responses
      req.formatUserForResponse = (includePrivate = false) => {
        return AnonymousService.formatUserForResponse(
          req.userData,
          includePrivate
        );
      };
    }
    next();
  } catch (error) {
    console.error("Error in anonymous middleware:", error);
    // Don't fail the request, just continue without the data
    next();
  }
};

// Middleware to check if profile is completed
const requireCompleteProfile = (req, res, next) => {
  if (!req.user.profileCompleted) {
    return res.status(403).json({
      success: false,
      message: "Profile completion required",
      requiredSteps: getRequiredSteps(req.user),
    });
  }
  next();
};

// Helper function to determine required steps
const getRequiredSteps = (user) => {
  const steps = [];

  if (!user.businessName) steps.push("business-name");
  if (!user.website) steps.push("business-website");
  if (!user.instagram) steps.push("business-instagram");
  if (!user.creativeDomains || user.creativeDomains.length === 0)
    steps.push("creative-domain");
  if (!user.phone) steps.push("phone-number");
  if (!user.phoneVerified) steps.push("otp-verification");

  return steps;
};

const requireUserData = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Get full user data (decrypted if anonymous)
    req.userData = await AnonymousService.getUserData(req.user.id);

    if (!req.userData) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get display data
    req.userDisplay = await AnonymousService.getDisplayUserData(req.user.id);

    next();
  } catch (error) {
    console.error("Error in requireUserData middleware:", error);
    res.status(500).json({ error: "Failed to load user data" });
  }
};

module.exports = {
  authenticateToken,
  handleAnonymousUser,
  requireUserData,
  requireCompleteProfile,
  getRequiredSteps,
  handleOptionalAnonymousUser,
  optionalAuthenticateToken,
};
