const express = require("express");
const router = express.Router();
const AnonymousController = require("../controllers/anonymousController");
const { authenticateToken } = require("../middleware/auth");

router.use(authenticateToken);

router.post("/activate", AnonymousController.activateAnonymousMode);
router.post("/deactivate", AnonymousController.deactivateAnonymousMode);
router.get("/status", AnonymousController.getAnonymousStatus);

module.exports = router;
