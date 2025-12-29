const app = require("./app");
const { db } = require("./config/database");
const cronJobService = require("./services/cronJobServices");
const { initializeSocket } = require("./services/socketService");
const { seedDatabase } = require("./utils/seedData");
const http = require("http");

const PORT = process.env.PORT || 3000;

// Database connection test
async function testConnection() {
  try {
    await db.execute("SELECT 1");
    console.log("✅ Database connected successfully");
  } catch (error) {
    console.error("❌ Database connection failed:", error.message);
    process.exit(1);
  }
}

// Start server
async function startServer() {
  try {
    await testConnection();

    // Run database seeder
    console.log("🌱 Checking database seed status...");
    await seedDatabase();

    // Create HTTP server
    const server = http.createServer(app);
    
    // Initialize Socket.IO
    initializeSocket(server);
    console.log("✅ Socket.IO initialized");

    // Initialize cron jobs after database connection
    cronJobService.init();

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📱 API URL: http://localhost:${PORT}/api`);
      console.log(`💚 Health check: http://localhost:${PORT}/api/health`);
      console.log(`🔥 Environment: ${process.env.NODE_ENV || "development"}`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGTERM", () => {
  console.log("🔄 SIGTERM received, shutting down gracefully");
  cronJobService.stopAll();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("🔄 SIGINT received, shutting down gracefully");
  cronJobService.stopAll();
  process.exit(0);
});

process.on("unhandledRejection", (err) => {
  console.error("💥 Unhandled Promise Rejection:", err);
  process.exit(1);
});

startServer();