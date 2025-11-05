const { db } = require("../config/database");
const { users, posts } = require("../models/schema");
const { eq, and } = require("drizzle-orm");
const bcrypt = require("bcrypt");

// Seed data configuration
const SEED_USER = {
  email: "seeduser@cunocovo.com",
  password: "SeedPassword123!",
  firstName: "Test",
  lastName: "User",
  businessName: "Creative Studio",
  userType: "creative",
  profileCompleted: true,
  emailVerified: true,
  status: "approved",
};

const CREATIVE_POSTS = [
  {
    subject: "Looking for Photography Recommendations",
    content:
      "Hey everyone! I'm planning a destination wedding in Bali next year and need recommendations for photographers who specialize in tropical outdoor shoots. Any suggestions?",
    categories: ["Photographer"],
    type: "text",
  },
  {
    subject: "Makeup Trial - What to Expect?",
    content:
      "First time bride here! I have my makeup trial coming up next week. What should I bring? Any tips on how to communicate what I want? Would love to hear your experiences!",
    categories: ["Planner"],
    type: "text",
  },
  {
    subject: "Decor Trends for 2025",
    content:
      "What are the hottest decor trends you're seeing for weddings this year? I'm torn between minimalist chic and maximalist floral arrangements. Share your thoughts!",
    categories: ["Planner, Florist"],
    type: "text",
  },
  {
    subject: "Best Caterers in Dallas",
    content:
      "Planning a 300-person wedding and overwhelmed with catering options. Who are the best caterers in Dallas that won't break the bank but still deliver quality food?",
    categories: ["Planner"],
    type: "text",
  },
  {
    subject: "Should I Hire a Videographer?",
    content:
      "Is it worth spending extra on a videographer? Already booked a photographer but wondering if video is essential. What do you think?",
    categories: ["Photographer", "Videographer"],
    type: "text",
  },
  {
    subject: "DIY vs Professional Decor",
    content:
      "Trying to cut costs - has anyone successfully done DIY decor? Or is it better to just hire professionals? Share your experiences!",
    categories: ["Planner", "Florist"],
    type: "text",
  },
  {
    subject: "Outdoor vs Indoor Venues - Help!",
    content:
      "Can't decide between an outdoor garden wedding or indoor ballroom. What are the pros and cons of each? Weather is a concern for outdoor...",
    categories: ["Planner"],
    type: "text",
  },
  {
    subject: "Bridal Mehendi Designs",
    content:
      "Looking for a mehendi artist who can do intricate bridal designs. Any recommendations? Also, how long should I expect the session to take?",
    categories: ["Planner", "Florist"],
    type: "text",
  },
  {
    subject: "Best Wedding Planners Poll",
    content: "Who would you hire as your wedding planner?",
    categories: ["Planner"],
    type: "poll",
    pollOptions: [
      "Premium Planners Co.",
      "Budget Friendly Events",
      "Luxury Wedding Masters",
      "DIY - No Planner",
    ],
  },
  {
    subject: "Wedding Color Schemes",
    content:
      "What's your favorite color scheme for a winter wedding? I'm thinking deep burgundy and gold, but open to other ideas. Drop your suggestions!",
    categories: ["Florist", "Planner", "Photographer"],
    type: "text",
  },
];

const COUPLE_POSTS = [
  {
    subject: "How We Met - Coffee Shop Story",
    content:
      "We met at a coffee shop during a rainy afternoon. He asked if he could share my table, and we ended up talking for 4 hours straight. Been inseparable ever since! Share your how-we-met stories!",
    categories: ["Couples"],
    type: "text",
  },
  {
    subject: "Planning Together vs Separately?",
    content:
      "My fiancé and I keep disagreeing on wedding decisions. Should we divide tasks or plan everything together? How did you handle wedding planning as a couple?",
    categories: ["Couples"],
    type: "text",
  },
  {
    subject: "Best Date Night Ideas in New York",
    content:
      "Looking to plan a special date night before all the wedding chaos begins. What are your favorite romantic spots in New York ?",
    categories: ["Couples"],
    type: "text",
  },
  {
    subject: "Pre-Wedding Photoshoot Locations",
    content:
      "We want to do a pre-wedding shoot but struggling to find unique locations. Where did you do yours? Looking for something different from the usual spots!",
    categories: ["Couples"],
    type: "text",
  },
  {
    subject: "First Year Anniversary Ideas",
    content:
      "Our first anniversary is coming up and I want to make it special. What did you do for your first anniversary? Need creative ideas!",
    categories: ["Couples"],
    type: "text",
  },
];

async function seedDatabase() {
  try {
    console.log("🌱 Starting database seeding...");

    // Check if seed user already exists
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, SEED_USER.email))
      .limit(1);

    let seedUserId;

    if (existingUser.length > 0) {
      console.log("✅ Seed user already exists");
      seedUserId = existingUser[0].id;
    } else {
      console.log("📝 Creating seed user...");
      const hashedPassword = await bcrypt.hash(SEED_USER.password, 10);

      const [newUser] = await db
        .insert(users)
        .values({
          ...SEED_USER,
          password: hashedPassword,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      seedUserId = newUser.id;
      console.log("✅ Seed user created");
    }

    // Check if posts already exist
    const existingPosts = await db
      .select()
      .from(posts)
      .where(eq(posts.userId, seedUserId))
      .limit(1);

    if (existingPosts.length > 0) {
      console.log("✅ Seed posts already exist - skipping post creation");
      return;
    }

    // Create creative posts
    console.log("📝 Creating creative posts...");
    for (const post of CREATIVE_POSTS) {
      await db.insert(posts).values({
        userId: seedUserId,
        subject: post.subject,
        content: post.content,
        categories: JSON.stringify(post.categories),
        type: post.type,
        pollOptions: post.pollOptions
          ? JSON.stringify(
              post.pollOptions.map((option) => ({
                text: option,
                votes: 0,
              }))
            )
          : null,
        likes: Math.floor(Math.random() * 20), // Random likes between 0-20
        saves: Math.floor(Math.random() * 10), // Random saves between 0-10
        commentsCount: 0, // Set to 0 for all posts
        quotesCount: Math.floor(Math.random() * 5),
        isActive: true,
        createdAt: new Date(
          Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000
        ), // Random date within last week
        updatedAt: new Date(),
      });
    }
    console.log(`✅ Created ${CREATIVE_POSTS.length} creative posts`);

    // Create couple posts
    console.log("📝 Creating couple posts...");
    for (const post of COUPLE_POSTS) {
      await db.insert(posts).values({
        userId: seedUserId,
        subject: post.subject,
        content: post.content,
        categories: JSON.stringify(post.categories),
        type: post.type,
        likes: Math.floor(Math.random() * 25), // Random likes
        saves: Math.floor(Math.random() * 12), // Random saves
        commentsCount: 0, // Set to 0 for all posts
        isActive: true,
        createdAt: new Date(
          Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000
        ), // Random date within last week
        updatedAt: new Date(),
      });
    }
    console.log(`✅ Created ${COUPLE_POSTS.length} couple posts`);

    console.log("🎉 Database seeding completed successfully!");
  } catch (error) {
    console.error("❌ Error seeding database:", error);
    throw error;
  }
}

module.exports = { seedDatabase };
