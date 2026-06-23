const db = require("../config/database");

const generateAiQuizReport = async (req, res) => {
    const { quizId } = req.params;

    try {
        // STEP 1: Quiz basic info
        const [quizRows] = await db.query(
            `SELECT q.title, q.description, COUNT(qs.id) as total_questions,
              SUM(qs.marks) as total_marks
       FROM quizzes q
       LEFT JOIN questions qs ON qs.quiz_id = q.id
       WHERE q.id = ?
       GROUP BY q.id`,
            [quizId]
        );

        if (!quizRows.length) {
            return res.status(404).json({ message: "Quiz not found." });
        }
        const quiz = quizRows[0];

        // STEP 2: Eligible students (exclude cheating-penalized)
        const [eligibleStudents] = await db.query(
            `SELECT DISTINCT sqa.student_id, u.name as student_name,
              qr.obtained_marks, qr.total_marks
       FROM student_quiz_attempts sqa
       JOIN users u ON u.id = (
         SELECT user_id FROM students WHERE id = sqa.student_id
       )
       LEFT JOIN quiz_results qr ON qr.student_id = sqa.student_id 
                                 AND qr.quiz_id = sqa.quiz_id
       WHERE sqa.quiz_id = ?
         AND sqa.submitted = 1
         AND sqa.student_id NOT IN (
           SELECT DISTINCT cl.student_id
           FROM cheating_logs cl
           JOIN quiz_results qr2 ON qr2.student_id = cl.student_id
                                 AND qr2.quiz_id = cl.quiz_id
           WHERE cl.quiz_id = ?
             AND qr2.obtained_marks = 0
         )`,
            [quizId, quizId]
        );

        if (!eligibleStudents.length) {
            return res.status(404).json({
                message:
                    "No eligible student data found for this quiz. Either no one attempted or all were penalized.",
            });
        }

        const eligibleStudentIds = eligibleStudents.map((s) => s.student_id);

        // STEP 3: Questions with options
        const [questions] = await db.query(
            `SELECT q.id as question_id, q.question_text, q.marks,
              o.id as option_id, o.option_text, o.is_correct
       FROM questions q
       JOIN options o ON o.question_id = q.id
       WHERE q.quiz_id = ?
       ORDER BY q.id, o.id`,
            [quizId]
        );

        // STEP 4: Answers from eligible students only
        const [answers] = await db.query(
            `SELECT sqa.student_id, sqa.question_id, sqa.option_id
       FROM student_quiz_answers sqa
       WHERE sqa.quiz_id = ?
         AND sqa.student_id IN (?)`,
            [quizId, eligibleStudentIds]
        );

        // STEP 5: Per-question analysis
        const questionMap = {};
        for (const row of questions) {
            if (!questionMap[row.question_id]) {
                questionMap[row.question_id] = {
                    question_id: row.question_id,
                    question_text: row.question_text,
                    marks: row.marks,
                    options: [],
                    correct_option_ids: [],
                };
            }
            questionMap[row.question_id].options.push({
                option_id: row.option_id,
                option_text: row.option_text,
                is_correct: row.is_correct,
            });
            if (row.is_correct) {
                questionMap[row.question_id].correct_option_ids.push(row.option_id);
            }
        }

        const answersByQuestion = {};
        for (const ans of answers) {
            if (!answersByQuestion[ans.question_id]) {
                answersByQuestion[ans.question_id] = [];
            }
            answersByQuestion[ans.question_id].push({
                student_id: ans.student_id,
                option_id: ans.option_id,
            });
        }

        const totalEligible = eligibleStudents.length;

        const questionAnalysis = Object.values(questionMap).map((q) => {
            const answeredList = answersByQuestion[q.question_id] || [];
            const attemptedStudentIds = new Set(
                answeredList.map((a) => a.student_id)
            );

            const skipped = totalEligible - attemptedStudentIds.size;
            const correct = answeredList.filter((a) =>
                q.correct_option_ids.includes(a.option_id)
            ).length;
            const wrong = attemptedStudentIds.size - correct;

            const correctPct = Math.round((correct / totalEligible) * 100);
            const wrongPct = Math.round((wrong / totalEligible) * 100);
            const skippedPct = Math.round((skipped / totalEligible) * 100);

            const wrongOptionCounts = {};
            for (const ans of answeredList) {
                if (!q.correct_option_ids.includes(ans.option_id)) {
                    const optText =
                        q.options.find((o) => o.option_id === ans.option_id)
                            ?.option_text || "Unknown";
                    wrongOptionCounts[optText] =
                        (wrongOptionCounts[optText] || 0) + 1;
                }
            }
            const topWrongOption = Object.entries(wrongOptionCounts).sort(
                (a, b) => b[1] - a[1]
            )[0];

            return {
                question_text: q.question_text,
                marks: q.marks,
                correct,
                wrong,
                skipped,
                correct_pct: correctPct,
                wrong_pct: wrongPct,
                skipped_pct: skippedPct,
                top_wrong_option: topWrongOption
                    ? `"${topWrongOption[0]}" chosen by ${topWrongOption[1]} student(s)`
                    : null,
                difficulty:
                    correctPct >= 70 ? "Easy" : correctPct >= 40 ? "Moderate" : "Hard",
            };
        });

        // STEP 6: Overall stats
        const avgScore =
            eligibleStudents.reduce(
                (sum, s) => sum + (s.obtained_marks || 0),
                0
            ) / totalEligible;

        const overallStats = {
            total_marks: quiz.total_marks,
            average_score: Math.round(avgScore * 10) / 10,
            average_pct: Math.round((avgScore / quiz.total_marks) * 100),
        };

        // STEP 7: Build prompt
        const prompt = `You are an expert educational analyst. Analyze the following quiz performance data and generate a detailed class performance report for a teacher.

QUIZ: "${quiz.title}"
TOTAL STUDENTS ANALYZED: ${totalEligible} (cheating-penalized students excluded)
CLASS AVERAGE: ${overallStats.average_score}/${quiz.total_marks} (${overallStats.average_pct}%)

QUESTION-BY-QUESTION BREAKDOWN:
${questionAnalysis
                .map(
                    (q, i) => `
Q${i + 1}: "${q.question_text}" [${q.marks} mark(s)] — Difficulty: ${q.difficulty}
  ✅ Correct: ${q.correct}/${totalEligible} (${q.correct_pct}%)
  ❌ Wrong:   ${q.wrong}/${totalEligible} (${q.wrong_pct}%)
  ⏭ Skipped: ${q.skipped}/${totalEligible} (${q.skipped_pct}%)
  ${q.top_wrong_option ? `Most common wrong answer: ${q.top_wrong_option}` : ""}
`
                )
                .join("")}

Based on this data, generate a structured JSON report with EXACTLY this format (no extra text, no markdown):
{
  "summary": "2-3 sentence overall class performance summary mentioning the average score and general trend",
  "topicsToImprove": [
    "Specific concept or topic students got wrong — e.g. 'Photosynthesis light reactions (Q2, Q5 — 70% wrong)'"
  ],
  "knowledgeVoids": [
    "Topic students mostly skipped — e.g. 'Numerical problems (Q4, Q7 — over 60% skipped)'"
  ],
  "hardQuestions": [
    {
      "question": "Short version of the question text",
      "reason": "Why students struggled — mention common wrong answer and what misconception it suggests"
    }
  ],
  "suggestions": "3-4 sentence paragraph with concrete reteaching strategies mentioning specific question numbers and topics"
}

Rules:
- topicsToImprove: only where wrong_pct > 40%
- knowledgeVoids: only where skipped_pct > 30%
- hardQuestions: only where correct_pct < 40%
- Be specific and reference actual question numbers
- If all questions were answered well, say so honestly`;

        // STEP 8: Call OpenRouter
        const aiResponse = await fetch(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
                    "X-Title": "Quiz App Analytics",
                },
                body: JSON.stringify({
                    model: "openrouter/free",
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.4,
                }),
            }
        );

        const rawText = await aiResponse.text();

        if (!aiResponse.ok) {
            console.error("OpenRouter error:", rawText);
            return res
                .status(502)
                .json({ message: "AI service error. Please try again." });
        }

        const aiData = JSON.parse(rawText);
        const aiText = aiData.choices?.[0]?.message?.content || "";

        const cleaned = aiText
            .replace(/```json/gi, "")
            .replace(/```/g, "")
            .trim();

        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error("No JSON in AI response:", aiText);
            return res.status(502).json({
                message: "AI returned an invalid response. Please try again.",
            });
        }

        let report;
        try {
            report = JSON.parse(jsonMatch[0]);
        } catch {
            console.error("Failed to parse AI JSON:", jsonMatch[0]);
            return res.status(502).json({
                message: "AI returned malformed data. Please try again.",
            });
        }

        // STEP 9: Return
        return res.status(200).json({
            ...report,
            stats: {
                total_students: totalEligible,
                average_score: overallStats.average_score,
                average_pct: overallStats.average_pct,
                total_marks: quiz.total_marks,
                question_breakdown: questionAnalysis.map((q) => ({
                    question: q.question_text.substring(0, 60) + "...",
                    correct_pct: q.correct_pct,
                    wrong_pct: q.wrong_pct,
                    skipped_pct: q.skipped_pct,
                    difficulty: q.difficulty,
                })),
            },
        });
    } catch (err) {
        console.error("AI Report Error:", err);
        return res
            .status(500)
            .json({ message: "Server error. Please try again." });
    }
};

module.exports = {
    // ...spread your existing exports here
    generateAiQuizReport,
};