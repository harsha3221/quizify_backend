const db = require("../config/database");

class Question {
    /* ---------------- CREATE ---------------- */
    static async createWithOptions(quizId, questionText, marks, options, imageUrl = null) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            // Insert question
            const [qResult] = await conn.query(
                `INSERT INTO questions (quiz_id, question_text, image_url, marks)
                 VALUES (?, ?, ?, ?)`,
                [quizId, questionText, imageUrl, marks]
            );

            const questionId = qResult.insertId;

            // Insert options
            if (options && options.length > 0) {
                const values = options.map((opt) => [
                    questionId,
                    opt.option_text || "",
                    opt.image_url || null,
                    opt.is_correct ? 1 : 0,
                ]);

                await conn.query(
                    `INSERT INTO options (question_id, option_text, image_url, is_correct)
                     VALUES ?`,
                    [values]
                );
            }

            await conn.commit();
            return { questionId };

        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    }

    /* ---------------- FETCH ---------------- */
    static async getByQuizId(quizId) {
        const [rows] = await db.query(
            `SELECT 
            q.id,
            q.question_text,
            q.marks,
            q.image_url,
            COALESCE(
                (
                    SELECT JSON_ARRAYAGG(
                        JSON_OBJECT(
                            'id', o.id,
                            'option_text', o.option_text,
                            'is_correct', CAST(o.is_correct AS UNSIGNED),
                            'image_url', IFNULL(o.image_url, '')
                        )
                    )
                    FROM options o
                    WHERE o.question_id = q.id
                ),
                JSON_ARRAY()
            ) AS options
        FROM questions q
        WHERE q.quiz_id = ?
        ORDER BY q.id ASC`,
            [quizId]
        );

        return rows.map((row) => {
            let parsedOptions = [];

            try {
                if (Array.isArray(row.options)) {
                    parsedOptions = row.options;
                } else if (typeof row.options === "string") {
                    parsedOptions = JSON.parse(row.options);
                } else {
                    parsedOptions = [];
                }
            } catch (err) {
                console.error("Error parsing options JSON:", err);
                parsedOptions = [];
            }

            return {
                ...row,
                options: parsedOptions,
            };
        });
    }
    /* ---------------- DELETE ---------------- */
    static async deleteById(questionId) {
        // Note: Ensure your DB schema has "ON DELETE CASCADE" for options table
        // otherwise, you'll need to delete options manually first.
        return db.query(`DELETE FROM questions WHERE id = ?`, [questionId]);
    }

    /* ---------------- GET IMAGES (For Cleanup Logic) ---------------- */
    static async getImagesById(questionId) {
        const [rows] = await db.query(
            `SELECT 
                q.image_url AS question_image,
                o.image_url AS option_image
             FROM questions q
             LEFT JOIN options o ON q.id = o.question_id
             WHERE q.id = ?`,
            [questionId]
        );
        return rows;
    }

    /* ---------------- UPDATE (FIXED 🛠️) ---------------- */
    /* ---------------- UPDATE (SAFE & OPTIMIZED 🛠️) ---------------- */
    static async updateQuestion(quizId, questionId, questionText, marks, options, imageUrl) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            // 1️⃣ Update core question details
            await conn.execute(
                `UPDATE questions
                 SET question_text = ?, 
                     marks = ?, 
                     image_url = ?
                 WHERE id = ? AND quiz_id = ?`,
                [questionText, marks, imageUrl, questionId, quizId]
            );

            if (options && options.length > 0) {
                // Collect IDs of options sent by the frontend that already exist
                const existingOptionIds = options
                    .map(opt => opt.id)
                    .filter(id => id !== undefined && id !== null);

                // 2️⃣ Delete only the options that were removed in the UI
                if (existingOptionIds.length > 0) {
                    await conn.execute(
                        `DELETE FROM options 
                         WHERE question_id = ? AND id NOT IN (${existingOptionIds.map(() => '?').join(',')})`,
                        [questionId, ...existingOptionIds]
                    );
                } else {
                    // If no IDs match, the teacher replaced all options entirely
                    await conn.execute(`DELETE FROM options WHERE question_id = ?`, [questionId]);
                }

                // 3️⃣ Loop options to dynamically UPSERT (Insert new ones, Update old ones text)
                for (const opt of options) {
                    if (opt.id) {
                        // Option exists -> Update text and correctness state, preserving the ID
                        await conn.execute(
                            `UPDATE options 
                             SET option_text = ?, image_url = ?, is_correct = ? 
                             WHERE id = ? AND question_id = ?`,
                            [opt.option_text || "", opt.image_url || null, opt.is_correct ? 1 : 0, opt.id, questionId]
                        );
                    } else {
                        // No ID -> This option is newly added to the question
                        await conn.execute(
                            `INSERT INTO options (question_id, option_text, image_url, is_correct) 
                             VALUES (?, ?, ?, ?)`,
                            [questionId, opt.option_text || "", opt.image_url || null, opt.is_correct ? 1 : 0]
                        );
                    }
                }
            } else {
                // If options array is completely empty, wipe them out
                await conn.execute(`DELETE FROM options WHERE question_id = ?`, [questionId]);
            }

            await conn.commit();
            return true;

        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }
}

module.exports = Question;