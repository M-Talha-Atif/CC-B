// // deleteUser.js
// const { db } = require("../config/database");
// const {
//   users,
//   posts,
//   pollVotes,
//   comments,
//   chatroomIdentities,
//   notifications,
//   postInteractions,
//   commentInteractions,
//   creativeInquiries,
//   creativeProposals,
//   referralUsage,
//   pointsTransactions,
//   otpCodes,
//   emailVerificationTokens,
//   passwordResetTokens,
// } = require("../models/schema");

// const { eq } = require("drizzle-orm");

// async function deleteUser(userId) {
//   console.log(`Deleting user ${userId}...`);

//   try {
//     await db.transaction(async (trx) => {
//       await trx.delete(postInteractions).where(eq(postInteractions.userId, userId));
//       await trx.delete(commentInteractions).where(eq(commentInteractions.userId, userId));
//       await trx.delete(pollVotes).where(eq(pollVotes.userId, userId));
//       await trx.delete(comments).where(eq(comments.userId, userId));
//       await trx.delete(chatroomIdentities).where(eq(chatroomIdentities.userId, userId));
//       await trx.delete(notifications).where(eq(notifications.userId, userId));
//       await trx.delete(posts).where(eq(posts.userId, userId));
//       await trx.delete(creativeProposals).where(eq(creativeProposals.creativeUserId, userId));
//       await trx.delete(creativeInquiries).where(eq(creativeInquiries.userId, userId));
//       await trx.delete(referralUsage).where(eq(referralUsage.usedByUserId, userId));
//       await trx.delete(pointsTransactions).where(eq(pointsTransactions.userId, userId));
//       await trx.delete(otpCodes).where(eq(otpCodes.userId, userId));
//       await trx.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, userId));
//       await trx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));

//       // Finally delete the user
//       await trx.delete(users).where(eq(users.id, userId));
//     });

//     console.log(`User ${userId} deleted successfully.`);
//   } catch (err) {
//     console.error("Delete failed:", err);
//   }
// }

// const userId = process.argv[2];
// if (!userId) {
//   console.log("Please provide a user ID");
//   process.exit(1);
// }

// deleteUser(userId);
