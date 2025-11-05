const express = require("express");
const router = express.Router();
const postController = require("../controllers/postController");
const {
  authenticateToken,
  handleAnonymousUser,
  optionalAuthenticateToken,
  handleOptionalAnonymousUser,
} = require("../middleware/auth");

router.get("/feed/public/couples", postController.getCoupleFeed);

router.get("/public/:postId", postController.getPostPublic);

router.get("/public/comment/:postId", postController.getPublicPostComments);

router.get(
  "/feed",
  optionalAuthenticateToken,
  handleOptionalAnonymousUser,
  postController.getFeed
);

router.get("/global", optionalAuthenticateToken, postController.globalSearch);

router.use(authenticateToken);
router.use(handleAnonymousUser);

// Get feed posts with filtering

// Create new post
router.post("/", postController.createPost);

router.get("/quote/:postId", postController.getPostForQuote);

router.get(
  "/check-posting-eligibility",
  postController.checkPostingEligibility
);

// Like/Unlike post
router.post("/:postId/like", postController.toggleLike);

// Save/Unsave post
router.post("/:postId/save", postController.toggleSave);

// Vote on poll
router.post("/:postId/vote", postController.votePoll);

// Get post details

router.get("/:postId", postController.getPost);
router.delete("/:postId", postController.deletePost);

// Get user's saved posts
router.get("/saved", postController.getSavedPosts);

router.post("/enter-chatroom", postController.openChatroom);

router.post("/comment/", postController.createComment);

router.put("/comments/:commentId", postController.updateComment);

router.delete("/comments/:commentId", postController.deleteComment);

router.get("/comment/search-users", postController.searchChatroomUsers);

router.get("/comment/get-username", postController.getChatroomUsername);

router.get("/comment/:postId", postController.getPostComments);

router.get("/comment-count/:postId", postController.getPostCommentCount);

router.post("/comment/:commentId/like", postController.toggleCommentLike);

module.exports = router;
