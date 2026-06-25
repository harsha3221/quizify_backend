const db = require("../config/database");

class StudentQuizAttempt {

    /**
     * Create attempt row if not exists
     */
    static async createIfNotExists(studentId, quizId) {
        await db.execute(
            `
            INSERT INTO student_quiz_attempts
              (student_id, quiz_id, started_at, submitted)
            VALUES (?, ?, NOW(), 0)
            ON DUPLICATE KEY UPDATE
              student_id = student_id
            `,
            [studentId, quizId]
        );

        // fetch the attempt row
        const [[attempt]] = await db.execute(
            `
            SELECT student_id, quiz_id, started_at, submitted
            FROM student_quiz_attempts
            WHERE student_id = ? AND quiz_id = ?
            `,
            [studentId, quizId]
        );

        return attempt;
    }

    /**
     * Check if already submitted
     */
    static async isSubmitted(studentId, quizId) {
        const [[row]] = await db.execute(
            `
            SELECT submitted
            FROM student_quiz_attempts
            WHERE student_id = ? AND quiz_id = ?
            `,
            [studentId, quizId]
        );
        return row?.submitted === 1;
    }

    /**
     * ATOMIC SUBMIT CHECK (Fixed 🛠️)
     * Locks and flags the row simultaneously. 
     * Returns true if this request won the race, false if it's a double-submit.
     */
    static async submitAttemptAtomic(studentId, quizId) {
        const [result] = await db.execute(
            `
            UPDATE student_quiz_attempts 
            SET submitted = 1, 
                submitted_at = NOW() 
            WHERE student_id = ? AND quiz_id = ? AND submitted = 0
            `,
            [studentId, quizId]
        );

        // affectedRows is 1 if it changed 0 -> 1. 
        // affectedRows is 0 if it was already 1 (lost the race).
        return result.affectedRows > 0;
    }

    /**
     * Mark quiz as submitted (Fallback method)
     */
    static async markSubmitted(studentId, quizId) {
        await db.execute(
            `
            UPDATE student_quiz_attempts
            SET submitted = 1,
                submitted_at = NOW()
            WHERE student_id = ? AND quiz_id = ?
            `,
            [studentId, quizId]
        );
    }
    static async getAttemptTiming(studentId, quizId) {
        const [rows] = await db.execute(
            `SELECT sqa.started_at, q.duration_minutes 
       FROM student_quiz_attempts sqa
       JOIN quizzes q ON sqa.quiz_id = q.id
       WHERE sqa.quiz_id = ? AND sqa.student_id = ?`,
            [quizId, studentId]
        );
        return rows.length > 0 ? rows[0] : null;
    }

    static async forceTimeoutSubmit(studentId, quizId) {
        await db.execute(
            `UPDATE student_quiz_attempts 
       SET submitted = 1, submitted_at = NOW() 
       WHERE quiz_id = ? AND student_id = ?`,
            [quizId, studentId]
        );
    }

}

module.exports = StudentQuizAttempt;