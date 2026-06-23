const express = require("express");
const router = express.Router();
const teacherController = require("../controllers/teacherController");


router.get("/dashboard", teacherController.getDashboard);
router.get("/quiz/:quizId/results", teacherController.viewQuizResults);


router.post("/create-subject", teacherController.createSubject);
router.post(
    "/quiz/:quizId/publish-results",
    teacherController.publishQuizResults
);

module.exports = router;
