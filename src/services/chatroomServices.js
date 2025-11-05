// services/chatroomUsernameService.js
const { db } = require("../config/database");
const { chatroomIdentities } = require("../models/schema");
const { eq, and } = require("drizzle-orm");

const COLORS = [
  "ivory",
  "taupe",
  "dove",
  "blush",
  "mauve",
  "lilac",
  "peony",
  "tulip",
  "mocha",
  "olive",
  "sage",
  "pine",
  "navy",
  "ink",
  "onyx",
  "silver",
  "gold",
  "bronze",
  "copper",
  "pearl",
  "canvas",
  "truffle",
  "maple",
  "coral",
  "mint",
  "cobalt",
  "beige",
  "ruby",
];

const WORDS = [
  "editorial",
  "blueprint",
  "tablescape",
  "flatlay",
  "moodboard",
  "firstlook",
  "welcome",
  "brunch",
  "processional",
  "recessional",
  "suite",
  "vignette",
  "installation",
  "backdrop",
  "runner",
  "swatch",
  "charger",
  "shotlist",
  "cocktailhour",
  "afterparty",
  "menus",
  "guestbook",
  "firstdance",
  "nontraditional",
  "vows",
  "altar",
  "aisle",
  "grandentrance",
  "rsvp",
  "cakecutting",
  "toasts",
  "reception",
  "colorstory",
  "loungearea",
  "signage",
  "goldenhour",
  "portraits",
  "previews",
  "film",
  "welcomebag",
  "signaturedrink",
  "budvase",
  "ceremonyarch",
  "documentary",
  "timeline",
  "floorplan",
  "seatingchart",
  "loadin",
  "pointofcontact",
  "arrangement",
  "bouquet",
  "dancefloor",
  "centerpiece",
  "confetti",
  "flatware",
  "ambient",
  "drape",
  "chandelier",
  "polaroid",
  "layout",
  "candlelight",
  "foliage",
  "placesetting",
  "sculptural",
  "botanicals",
  "stemware",
  "linen",
];

const ChatroomUsernameService = {
  async getChatroomUsername(userId, postId) {
    try {
      // Check if user already has a username for this post
      const [existingIdentity] = await db
        .select()
        .from(chatroomIdentities)
        .where(
          and(
            eq(chatroomIdentities.userId, userId),
            eq(chatroomIdentities.postId, postId)
          )
        )
        .limit(1);

      if (existingIdentity) {
        return existingIdentity;
      }

      // Generate a new unique username for this post
      const username = await this.generateUniqueUsername(postId);

      // Create new identity
      const [newIdentity] = await db
        .insert(chatroomIdentities)
        .values({
          userId,
          postId,
          chatroomUsername: username.full,
          color: username.color,
          word: username.word,
        })
        .returning();

      return newIdentity;
    } catch (error) {
      console.error("Error getting chatroom username:", error);
      throw error;
    }
  },

  async generateUniqueUsername(postId) {
    let attempts = 0;
    const maxAttempts = 100;

    while (attempts < maxAttempts) {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const word = WORDS[Math.floor(Math.random() * WORDS.length)];
      const fullUsername = `${color}${word}`;

      // Check if this username is already taken for this post
      const [existing] = await db
        .select()
        .from(chatroomIdentities)
        .where(
          and(
            eq(chatroomIdentities.postId, postId),
            eq(chatroomIdentities.chatroomUsername, fullUsername)
          )
        )
        .limit(1);

      if (!existing) {
        return {
          color,
          word,
          full: fullUsername,
        };
      }

      attempts++;
    }

    // If we can't find a unique combination, add a number suffix
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    const word = WORDS[Math.floor(Math.random() * WORDS.length)];
    const timestamp = Date.now().toString().slice(-4);

    return {
      color,
      word,
      full: `${color}${word}${timestamp}`,
    };
  },

  async getPostChatroomIdentities(postId) {
    try {
      const identities = await db
        .select({
          id: chatroomIdentities.id,
          userId: chatroomIdentities.userId,
          chatroomUsername: chatroomIdentities.chatroomUsername,
          color: chatroomIdentities.color,
          word: chatroomIdentities.word,
          createdAt: chatroomIdentities.createdAt,
        })
        .from(chatroomIdentities)
        .where(eq(chatroomIdentities.postId, postId));

      return identities;
    } catch (error) {
      console.error("Error getting post chatroom identities:", error);
      throw error;
    }
  },

  async searchChatroomUsernames(postId, query) {
    try {
      if (!query || query.length < 1) {
        return [];
      }

      const identities = await db
        .select({
          id: chatroomIdentities.id,
          userId: chatroomIdentities.userId,
          chatroomUsername: chatroomIdentities.chatroomUsername,
          color: chatroomIdentities.color,
          word: chatroomIdentities.word,
        })
        .from(chatroomIdentities)
        .where(eq(chatroomIdentities.postId, postId));

      // Filter usernames that match the query
      const filteredIdentities = identities.filter((identity) =>
        identity.chatroomUsername.toLowerCase().includes(query.toLowerCase())
      );

      return filteredIdentities.map((identity) => ({
        id: identity.userId,
        displayName: identity.chatroomUsername,
        chatroomUsername: identity.chatroomUsername,
        color: identity.color,
        word: identity.word,
      }));
    } catch (error) {
      console.error("Error searching chatroom usernames:", error);
      throw error;
    }
  },

  async getChatroomUsernameByUserAndPost(userId, postId) {
    try {
      const [identity] = await db
        .select({
          chatroomUsername: chatroomIdentities.chatroomUsername,
        })
        .from(chatroomIdentities)
        .where(
          and(
            eq(chatroomIdentities.userId, userId),
            eq(chatroomIdentities.postId, postId)
          )
        )
        .limit(1);

      return identity?.chatroomUsername || null;
    } catch (error) {
      console.error("Error getting chatroom username by user and post:", error);
      throw error;
    }
  },

  async getUserChatroomStatus(userId, postId) {
    const [identity] = await db
      .select({
        hasCommented: chatroomIdentities.hasCommented,
        chatroomUsername: chatroomIdentities.chatroomUsername,
        color: chatroomIdentities.color,
        word: chatroomIdentities.word,
      })
      .from(chatroomIdentities)
      .where(
        and(
          eq(chatroomIdentities.userId, userId),
          eq(chatroomIdentities.postId, postId)
        )
      )
      .limit(1);

    return identity || null;
  },
};

module.exports = ChatroomUsernameService;
