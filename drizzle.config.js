require("dotenv").config();

module.exports = {
  schema: "./src/models/schema.js",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  dialect: "postgresql",
};
