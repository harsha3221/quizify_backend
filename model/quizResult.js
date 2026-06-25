const db = require("../config/database");

class QuizResult {
    static async getSubmittedStudents(quizId) {
        const [rows] = await db.execute(
            `SELECT student_id
             FROM student_quiz_attempts
             WHERE quiz_id = ? AND submitted = 1`,
            [quizId]
        );
        return rows;
    }

    static async exists(studentId, quizId) {
        const [[row]] = await db.execute(
            `SELECT id FROM quiz_results
             WHERE student_id = ? AND quiz_id = ?`,
            [studentId, quizId]
        );
        return !!row;
    }

    static async getEvaluationData(studentId, quizId) {
        const [rows] = await db.execute(
            `SELECT q.id AS question_id,
                    q.marks,
                    o.id AS option_id,
                    o.is_correct,
                    a.option_id AS answered_option
             FROM questions q
             JOIN options o ON o.question_id = q.id
             LEFT JOIN student_quiz_answers a
                    ON a.question_id = q.id
                   AND a.student_id = ?
             WHERE q.quiz_id = ?`,
            [studentId, quizId]
        );
        return rows;
    }

    static async insert(studentId, quizId, total, obtained) {
        return db.execute(
            `INSERT INTO quiz_results
             (student_id, quiz_id, total_marks, obtained_marks)
             VALUES (?, ?, ?, ?)`,
            [studentId, quizId, total, obtained]
        );
    }

    static async getResultsForQuiz(quizId) {
        const [rows] = await db.execute(
            `SELECT 
                u.name AS student_name,
                r.student_id,
                r.total_marks,
                r.obtained_marks,
                r.evaluated_at,
                (SELECT COUNT(*) 
                 FROM cheating_logs cl 
                 WHERE cl.student_id = r.student_id 
                 AND cl.quiz_id = r.quiz_id) AS cheating_count
            FROM quiz_results r
            JOIN students s ON r.student_id = s.id
            JOIN users u ON s.user_id = u.id
            WHERE r.quiz_id = ?
            ORDER BY u.name ASC`,
            [quizId]
        );
        return rows;
    }

    static async upsertResultWithTransaction(conn, studentId, quizId, total, obtained) {
        const [existing] = await conn.execute(
            `SELECT id FROM quiz_results WHERE student_id = ? AND quiz_id = ?`,
            [studentId, quizId]
        );

        if (existing.length > 0) {
            await conn.execute(
                `UPDATE quiz_results 
                 SET total_marks=?, obtained_marks=?, evaluated_at=NOW()
                 WHERE id=?`,
                [total, obtained, existing[0].id]
            );
        } else {
            await conn.execute(
                `INSERT INTO quiz_results (student_id, quiz_id, total_marks, obtained_marks) 
                 VALUES (?, ?, ?, ?)`,
                [studentId, quizId, total, obtained]
            );
        }
    }

    static async evaluateAndSubmit(studentId, quizId) {
        // Safe access to the raw pool instance to draw connection
        const pool = db.db;
        const conn = await pool.promise().getConnection();

        try {
            await conn.beginTransaction();

            const [rows] = await conn.execute(
                `SELECT q.id AS question_id, q.marks, 
                        o.id AS option_id, o.is_correct,
                        a.option_id AS answered_option
                 FROM questions q
                 LEFT JOIN options o ON q.id = o.question_id
                 LEFT JOIN student_quiz_answers a 
                        ON a.question_id = q.id AND a.student_id = ?
                 WHERE q.quiz_id = ?`,
                [studentId, quizId]
            );

            const byQuestion = {};

            rows.forEach(r => {
                if (!byQuestion[r.question_id]) {
                    byQuestion[r.question_id] = {
                        marks: r.marks || 0,
                        correctSet: new Set(),
                        selectedSet: new Set()
                    };
                }

                if (r.is_correct) {
                    byQuestion[r.question_id].correctSet.add(r.option_id);
                }

                if (r.answered_option && r.answered_option === r.option_id) {
                    byQuestion[r.question_id].selectedSet.add(r.answered_option);
                }
            });

            let totalMarks = 0;
            let obtainedMarks = 0;

            for (let qid in byQuestion) {
                const q = byQuestion[qid];
                totalMarks += q.marks;

                const isCorrect =
                    q.correctSet.size === q.selectedSet.size &&
                    [...q.correctSet].every(id => q.selectedSet.has(id));

                if (isCorrect) {
                    obtainedMarks += q.marks;
                }
            }

            await this.upsertResultWithTransaction(conn, studentId, quizId, totalMarks, obtainedMarks);

            await conn.execute(
                `UPDATE student_quiz_attempts
                 SET submitted = 1, submitted_at = NOW()
                 WHERE student_id = ? AND quiz_id = ?`,
                [studentId, quizId]
            );

            await conn.commit();
            return { total: totalMarks, obtained: obtainedMarks };
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    }

    static async getStudentResult(studentId, quizId) {
        const [rows] = await db.execute(
            `SELECT obtained_marks, total_marks, evaluated_at
             FROM quiz_results
             WHERE student_id = ? AND quiz_id = ?`,
            [studentId, quizId]
        );
        return rows[0];
    }
}

module.exports = QuizResult;