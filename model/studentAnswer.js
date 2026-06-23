// model/studentAnswer.js
const db = require("../config/database");

class StudentAnswer {

    static async getAnswers(studentId, quizId) {
        const [rows] = await db.execute(
            `SELECT question_id, option_id
             FROM student_quiz_answers
             WHERE student_id = ? AND quiz_id = ?`,
            [studentId, quizId]
        );
        return rows;
    }

    /**
     * Efficiently updates selected options without destructive deletions
     */
    static async saveAnswersBulk(studentId, quizId, questionId, optionIds) {
        // If empty, it means they unselected all checkboxes for this question
        if (!optionIds || optionIds.length === 0) {
            return db.execute(
                `DELETE FROM student_quiz_answers 
                 WHERE student_id = ? AND quiz_id = ? AND question_id = ?`,
                [studentId, quizId, questionId]
            );
        }

        // 1. Clean up ONLY the options that the student explicitly unchecked
        await db.execute(
            `DELETE FROM student_quiz_answers 
             WHERE student_id = ? AND quiz_id = ? AND question_id = ? 
             AND option_id NOT IN (${optionIds.map(() => '?').join(',')})`,
            [studentId, quizId, questionId, ...optionIds]
        );

        // 2. Perform a clean bulk insert / skip update for the rest
        const values = optionIds.map(oid => [studentId, quizId, questionId, oid]);

        return db.query(
            `INSERT INTO student_quiz_answers (student_id, quiz_id, question_id, option_id)
             VALUES ?
             ON DUPLICATE KEY UPDATE answered_at = NOW()`,
            [values]
        );
    }
}

module.exports = StudentAnswer;