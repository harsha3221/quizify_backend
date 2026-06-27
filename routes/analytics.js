const express = require("express");
const router = express.Router();
const analyticsController = require("../controllers/analyticsController");
const { aiLimiter } = require("../middlewares/rateLimiter");

// This defines the path AFTER /analytics

router.get("/ai-report/:quizId", aiLimiter, analyticsController.generateAiQuizReport);

module.exports = router;