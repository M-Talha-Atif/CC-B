const { drizzle } = require("drizzle-orm/postgres-js");
const postgres = require("postgres");
const schema = require("../models/schema");

// Create postgres client
const client = postgres(process.env.DATABASE_URL, {
  max: 25,              // Change from 10 to 25
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 3600,  // Add this - close connections after 1 hour
});

// Create drizzle instance
const db = drizzle(client, { schema });

module.exports = {
  db,
  client,
};
