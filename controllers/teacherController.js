const Teacher = require('../model/teacher');
const Quiz = require("../model/quiz");
const QuizResult = require('../model/quizResult.js');


exports.getDashboard = async (req, res, next) => {
    try {
        if (!req.session.user || req.session.user.role !== 'teacher') {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        const teacherId = req.session.user.teacher_id;

        const [subjects] = await Teacher.getSubjects(teacherId);

        return res.status(200).json({
            teacher: {
                name: req.session.user.name,
                email: req.session.user.email
            },
            subjects
        });

    } catch (err) {
        next(err);
    }
};



exports.createSubject = async (req, res, next) => {
    try {
        if (!req.session.user || req.session.user.role !== 'teacher') {
            return res.status(403).json({ message: 'Unauthorized access' });
        }

        const { name, code, description, semester } = req.body;

        if (!name || !code || !semester) {
            return res.status(400).json({
                message: 'Name, code, and semester are required'
            });
        }

        const teacherId = req.session.user.teacher_id;

        const [result] = await Teacher.createSubject(
            teacherId,
            name,
            code,
            description || '',
            semester
        );

        return res.status(201).json({
            message: 'Subject created successfully',
            subject: {
                id: result.insertId,
                name,
                code,
                description,
                semester
            }
        });

    } catch (err) {
        next(err);
    }
};



exports.viewQuizResults = async (req, res, next) => {
    try {
        if (!req.session.user || req.session.user.role !== "teacher") {
            return res.status(403).json({ message: "Unauthorized" });
        }

        const quizId = req.params.quizId;
        const teacherUserId = req.session.user.id;

        const owns = await Quiz.belongsToTeacher(quizId, teacherUserId);
        if (!owns) {
            return res.status(404).json({ message: "Quiz not found" });
        }

        
        const quiz = await Quiz.getPublishStatus(quizId);

        
        const pendingStudents = await Quiz.getPendingStudents(quizId);

        if (pendingStudents.length > 0) {
            const studentIds = pendingStudents.map(s => s.student_id);

            const rows = await Quiz.getBulkEvaluationRows(quizId, studentIds);

            
            const insertValues = Quiz.computeBulkResults(rows, quizId);

            
            await Quiz.insertBulkResults(insertValues);
        }

        
        const results = await QuizResult.getResultsForQuiz(quizId);

        res.json({
            results,
            results_published: !!quiz?.results_published
        });

    } catch (err) {
        next(err);
    }
};



exports.publishQuizResults = async (req, res, next) => {
    try {
        if (!req.session.user || req.session.user.role !== "teacher") {
            return res.status(403).json({ message: "Unauthorized" });
        }

        const quizId = req.params.quizId;
        const teacherUserId = req.session.user.id;

        const owns = await Quiz.belongsToTeacher(quizId, teacherUserId);
        if (!owns) {
            return res.status(404).json({ message: "Quiz not found" });
        }

        await Quiz.publishResults(quizId);

        res.json({ message: "Results published successfully" });

    } catch (err) {
        next(err);
    }
};
