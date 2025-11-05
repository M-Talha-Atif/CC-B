const { drizzle } = require("drizzle-orm/postgres-js");
const postgres = require("postgres");
const schema = require("../models/schema");

// Create postgres client
const client = postgres(process.env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

// Create drizzle instance
const db = drizzle(client, { schema });

module.exports = {
  db,
  client,
};
