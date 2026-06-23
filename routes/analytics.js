const express = require("express");
const router = express.Router();
const analyticsController = require("../controllers/analyticsController");

// This defines the path AFTER /analytics

router.get("/ai-report/:quizId", analyticsController.generateAiQuizReport);

module.exports = router;