const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
// const rateLimit = require("express-rate-limit"); // COMMENTED OUT - Rate limiting disabled
require("dotenv").config();

// Import routes
const cronRoutes = require("./routes/cron");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const postRoutes = require("./routes/post");
const userRoutes = require("./routes/users");
const anonymousRoutes = require("./routes/anonymous");
const creativeInquiryRoutes = require("./routes/CreativeInquiryRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const cookieParser = require("cookie-parser");

const app = express();

app.use(
  "/api/creative-inquiries/stripe/webhook",
  express.raw({ type: "application/json" })
);

app.use((req, res, next) => {
  if (req.headers.cookie) {
    req.headers.cookie = req.headers.cookie
      .split(";")
      .filter((cookie) => {
        const key = cookie.trim().split("=")[0];
        return ![
          "Path",
          "Domain",
          "Secure",
          "HttpOnly",
          "SameSite",
          "Max-Age",
          "Expires",
        ].includes(key);
      })
      .join(";");
  }
  next();
});

app.use(cookieParser());

// Security middleware
app.use(helmet());

const allowedOrigins = [process.env.FRONTEND_URL, process.env.ADMIN_URL].filter(
  Boolean
);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        console.log("Blocked origin:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
    exposedHeaders: ["Set-Cookie"],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  })
);

// RATE LIMITING COMMENTED OUT FOR AWS DEPLOYMENT
/*
// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});
app.use("/api/", limiter);

// Stricter rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // much higher limit for dev
  message: "Too many authentication attempts, please try again later.",
});
app.use("/api/auth/", authLimiter);
*/

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Logging
if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

// Health check route
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "CUNO COVO API is running",
    timestamp: new Date().toISOString(),
  });
});

// API routes - Make sure these are properly configured
app.use("/api/cron", cronRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/users", userRoutes);
app.use("/api/post", postRoutes);
app.use("/api/anon", anonymousRoutes);
app.use("/api/creative-inquiries", creativeInquiryRoutes);
app.use("/api/notifications", notificationRoutes);

// Debug middleware to log all requests (remove after debugging)
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path} - Route not found`);
  next();
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl,
    method: req.method,
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Error:", err);

  // Handle different error types
  if (err.name === "ValidationError") {
    return res.status(400).json({
      success: false,
      message: "Validation error",
      errors: err.details,
    });
  }

  if (err.name === "UnauthorizedError") {
    return res.status(401).json({
      success: false,
      message: "Unauthorized access",
    });
  }

  // Default error response
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
});

module.exports = app;
