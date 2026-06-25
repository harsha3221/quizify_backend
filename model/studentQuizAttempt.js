const db = require("../config/database");

class StudentQuizAttempt {

    /**
     * ATOMIC INITIALIZATION CHECK (Fixed 🛠️ - Issue #2)
     * Leverages transactions and row-level locking to avoid multi-tab row duplication.
     */
    static async findOrCreateAttemptAtomic(studentId, quizId) {
        const connection = await db.db.promise().getConnection();

        try {
            await connection.beginTransaction();

            const [existing] = await connection.execute(
                `
                SELECT sqa.*, q.duration_minutes 
                FROM student_quiz_attempts sqa
                JOIN quizzes q ON sqa.quiz_id = q.id
                WHERE sqa.student_id = ? AND sqa.quiz_id = ? 
                FOR UPDATE
                `,
                [studentId, quizId]
            );

            if (existing.length > 0) {
                await connection.commit();
                return { isNew: false, attempt: existing[0] };
            }

            await connection.execute(
                `
                INSERT INTO student_quiz_attempts (student_id, quiz_id, started_at, submitted) 
                VALUES (?, ?, NOW(), 0)
                `,
                [studentId, quizId]
            );

            const [inserted] = await connection.execute(
                `
                SELECT sqa.*, q.duration_minutes 
                FROM student_quiz_attempts sqa
                JOIN quizzes q ON sqa.quiz_id = q.id
                WHERE sqa.student_id = ? AND sqa.quiz_id = ?
                `,
                [studentId, quizId]
            );

            await connection.commit();
            return { isNew: true, attempt: inserted[0] };
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    }

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
        return result.affectedRows > 0;
    }

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
            `
            SELECT sqa.started_at, q.duration_minutes 
            FROM student_quiz_attempts sqa
            JOIN quizzes q ON sqa.quiz_id = q.id
            WHERE sqa.quiz_id = ? AND sqa.student_id = ?
            `,
            [quizId, studentId]
        );
        return rows.length > 0 ? rows[0] : null;
    }

    static async forceTimeoutSubmit(studentId, quizId) {
        await db.execute(
            `
            UPDATE student_quiz_attempts 
            SET submitted = 1, submitted_at = NOW() 
            WHERE quiz_id = ? AND student_id = ?
            `,
            [quizId, studentId]
        );
    }
}

module.exports = StudentQuizAttempt;