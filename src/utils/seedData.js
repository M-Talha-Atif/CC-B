const { db } = require("../config/database");
const { users, posts, pollVotes, comments, chatroomIdentities, notifications, postInteractions } = require("../models/schema");
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

const NEW_COUPLE_POSTS = [
  {
    subject: "CHOOSE YOUR VENUE WISELY!",
    content: "Your venue is more than a location– it’s your backdrop, your canvas, your story. Don’t skimp here!! Plan to either invest in the perfect space or in professionals who can transform it beautifully. Doesn’t make sense to not feel “free” within a space…needing to hide so much in person and in photos.",
    categories: ["Couples"],
    type: "text",
  },
  {
    subject: "DJ’s over a live band 🎧",
    content: "Bands are SO hit or miss. A good DJ offers more music variety, keeps the energy consistent, and can instantly read the crowd. They take up less space, are easier to coordinate, and can perfectly time every moment. For a non-stop dance floor and seamless flow, DJs often outshine bands.",
    categories: ["Couples"],
    type: "text",
  },

]

const NEW_CREATIVE_POSTS = [
  {
    subject: "zero reason for slow email responses! 🥲",
    content:
      "Email response times are pathetic. 24 hrs should be the norm outside of an away email. If you can’t reply in 3 days, hire an assistant. No excuses. Delays like this are unacceptable.",
    categories: ["Photographer", "Videographer", "Planner", "Florist"],
    type: "text",
  },
  {
    subject: "STARTING PRICE ON WEBSITE",
    content:
      "How many hours of coverage is your starting price with a second shooter? 📷",
    categories: ["Photographers", "Videographers"],
    type: "poll",
    pollOptions: [
  { text: "6" },
  { text: "7" },
  { text: "8" },
  { text: "9" },
  { text: "All day is the minimum" },
],

  },
  {
    subject: "planners who are actually just designers in disguise",
    content:
      "So many planners are actually just designers, and the behind the scenes are a shit show! As a vendor, we really FEEL it on wedding day. 🥴",
    categories: ["Planners", "Florists", "Photographers", "Videographers"],
    type: "poll",
    pollOptions: [
      { text: "I’ve experienced this too often!" },
      { text: "There’s room for improvement for suuuure" },
      { text: "🤫 Planners are untouchable" },
    ],

  },
  {
    subject: "how to lose brand trust!",
    content:
      "I find it really unnecessary and unprofessional to share behind the scenes travel, equipment, and what have you type drama on IG stores! 🫠 Are you trying to give your clients a heart attack?! The stories of almost missing your flight, the flat tires on the way to an event, the lost gear. This doesn’t provide comfort or assurance. They know shit happens but like why broadcast that? Personal IG’s exist for a reason, DAMN. The bar for many is much too low. 😅",
    categories: ["Photographer", "Videographer", "Planner", "Florist"],
    type: "text",
  },
  {
    subject: "I don’t want excuses",
    content:
      "If your final deliverables take 8 weeks or more, you’re either taking on too much work or don’t have your priorities straight. I said what I said!",
    categories: ["Photographers", "Videographers"],
    type: "text",
  },
  {
    subject: "harsh observation about videography",
    content:
      "Of all key vendors, video seems to struggle most with evolving in the industry. While some are AMAZING, many feel out of touch and really outdated. No wonder some couples are opting for laidback iphone footage instead.",
    categories: ["Videographer"],
    type: "text",
  },
  {
    subject: "CLIENT COMMUNICATION",
    content: "How do you communicate with your couples outside of meetings?",
    categories: ["Photographer", "Videographer", "Planner", "Florist"],
    type: "poll",
    pollOptions: [
      {
        text: "📧 Strictly email",
        percentage: 15
      },
      {
        text: "💬 Email and text",
        percentage: 70
      },
      {
        text: "📱 Email, text, and I’ll answer unscheduled calls",
        percentage: 8
      },
      {
        text: "🌐 A different communication platform mainly",
        percentage: 5
      },
      {
        text: "🤝 Beyond accessible… all the things!",
        percentage: 2
      }
    ],

  },
];

// const IG_STYLE_POSTS = [

//   {
//     subject:
//       "How many hours of coverage is your starting price with a second shooter?",
//     content: "STARTING PRICE ON WEBSITE",
//     categories: ["Photographer", "Videographer"],
//     type: "poll",
//     pollOptions: [
//       "6",
//       "7",
//       "8",
//       "9",
//       "All day is the minimum",
//     ],
//   },
//   {
//     subject: "CLIENT COMMUNICATION",
//     content:
//       "How do you communicate with your couples?",
//     categories: ["Photographer", "Videographer", "Planner", "Florist"],
//     type: "poll",
//     pollOptions: [
//       "📧 Strictly email",
//       "💬 Email and text",
//       "📱 Email, text, and I’ll answer unscheduled calls",
//       "🌐 A different communication platform mainly",
//       "🤝 Beyond accessible… all the things!",
//     ],
//   },
// ];


async function deletePostAndRelations(db, postId, subject) {
  try {
    // Step 1: Delete all dependencies manually
    await db.delete(pollVotes).where(eq(pollVotes.postId, postId));
    await db.delete(postInteractions).where(eq(postInteractions.postId, postId));
    await db.delete(comments).where(eq(comments.postId, postId));
    await db.delete(chatroomIdentities).where(eq(chatroomIdentities.postId, postId));
    await db.delete(notifications).where(eq(notifications.postId, postId));

    console.log(`🧹 Related data cleared for post: ${subject}`);

    // Step 2: Delete the post itself
    await db.delete(posts).where(eq(posts.id, postId));

    console.log(`🗑️ Post deleted: ${subject}`);
  } catch (err) {
    console.error(`❌ Failed to delete post ${subject}:`, err);
  }
}



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

    // const postSubjects = [
    //   "CHOOSE YOUR VENUE WISELY!",
    //   "DJ’s over a live band 🎧",
    //   "zero reason for slow email responses! 🥲",
    //   "STARTING PRICE ON WEBSITE",
    //   "planners who are actually just designers in disguise",
    //   "how to lose brand trust!",
    //   "I don’t want excuses",
    //   "harsh observation about videography",
    //   "CLIENT COMMUNICATION"
    // ];

    // for (const subject of postSubjects) {
    //   const postToDelete = await db
    //     .select()
    //     .from(posts)
    //     .where(and(eq(posts.userId, seedUserId), eq(posts.subject, subject)));

    //   if (postToDelete.length > 0) {
    //     const postId = postToDelete[0].id;
    //     await deletePostAndRelations(db, postId, subject);
    //   }
    // }

    if (existingPosts.length > 0) {
      console.log("✅ Seed posts already exist - skipping post creation");
      return;
    }

    // // Create creative posts
    console.log("📝 Creating old creative posts...");
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
    console.log(`✅ Created old ${CREATIVE_POSTS.length} creative posts`);

    // Create couple posts
    console.log("📝 Creating old couple posts...");
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
    console.log(`✅ Created old ${COUPLE_POSTS.length} couple posts`);

    // Create creative posts
    // After inserting NEW_CREATIVE_POSTS
    console.log("📝 Creating new creative posts...");
    for (const post of NEW_CREATIVE_POSTS) {
      const [createdPost] = await db
        .insert(posts)
        .values({
          userId: seedUserId,
          subject: post.subject,
          content: post.content,
          categories: JSON.stringify(post.categories),
          type: post.type,
          pollOptions: post.pollOptions
            ? JSON.stringify(
              post.pollOptions.map((option) => ({
                text: option.text,
                percentage: option.percentage,
              }))
            )
            : null,
          likes: Math.floor(Math.random() * 20),
          saves: Math.floor(Math.random() * 10),
          commentsCount: 0,
          quotesCount: Math.floor(Math.random() * 5),
          isActive: true,
          createdAt: new Date(
            Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000
          ),
          updatedAt: new Date(),
        })
        .returning();

      // ✅ Only handle seeding poll votes for CLIENT COMMUNICATION
      if (post.subject === "CLIENT COMMUNICATION" && Array.isArray(post.pollOptions)) {
        const totalVotes = 100;

        for (let i = 0; i < post.pollOptions.length; i++) {
          const option = post.pollOptions[i];
          const votesForOption = Math.round((option.percentage / 100) * totalVotes);

          // Insert simulated votes
          for (let j = 0; j < votesForOption; j++) {
            await db.insert(pollVotes).values({
              userId: seedUserId, // or random users if available
              postId: createdPost.id,
              optionIndex: i,
              voteTimestamp: new Date(),
            });
          }

          // Attach the final vote count
          post.pollOptions[i] = {
            ...option,
            votes: votesForOption,
            isUserChoice: false,
          };
        }

        // Update the post’s pollOptions
        await db
          .update(posts)
          .set({ pollOptions: post.pollOptions })
          .where(eq(posts.id, createdPost.id));

        console.log(`📊 Poll votes seeded for: ${post.subject}`);
      }
    }

    console.log(`✅ Created new ${CREATIVE_POSTS.length} creative posts`);

    // Create couple posts
    console.log("📝 Creating new couple posts...");
    for (const post of NEW_COUPLE_POSTS) {
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
    console.log(`✅ Created new ${COUPLE_POSTS.length} couple posts`);


    console.log("🎉 Database seeding completed successfully!");
  } catch (error) {
    console.error("❌ Error seeding database:", error);
    throw error;
  }


}

module.exports = { seedDatabase };
