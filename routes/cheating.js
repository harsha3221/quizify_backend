const express = require("express");
const router = express.Router();
const cheatingController = require("../controllers/cheatingController");
const { generateAiQuestion } = require("../controllers/aiQuestionController");



router.post("/quiz/:quizId/ai-generate-question", generateAiQuestion);

router.get("/cheating/logs/:quizId", cheatingController.getCheatingLogs);
router.post("/report-cheating", cheatingController.reportCheating);
router.post('/cheating/assign-zero', cheatingController.assignZero);
router.get("/cheating/analytics/:quizId", cheatingController.getCheatingAnalytics);
module.exports = router;