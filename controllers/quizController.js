// controllers/quizController.js
const Quiz = require('../model/quiz');
const Teacher = require('../model/teacher');
const Question = require("../model/question");
const { uploadToCloudinary, deleteFromCloudinary } = require("../services/imageService");
const fs = require("fs");
const cloudinary = require('../config/cloudinary');
const path = require("path");
const db = require('../config/database');

async function ensureQuizBelongsToTeacher(quizId, userId) {
    const [teacherRows] = await Teacher.findByUserId(userId);
    if (teacherRows.length === 0) {
        throw new Error("Teacher not found");
    }
    const teacherId = teacherRows[0].teacher_id;

    const [rows] = await Quiz.findById(quizId);
    if (rows.length === 0) {
        throw new Error("Quiz not found");
    }
    const quiz = rows[0];

    if (quiz.teacher_id !== teacherId) {
        throw new Error("Quiz does not belong to this teacher");
    }

    return { teacherId, quiz };
}

exports.getQuizQuestions = async (req, res, next) => {
    try {
        if (!req.session.user || req.session.user.role !== "teacher") {
            return res.status(403).json({ message: "Unauthorized access" });
        }

        const { quizId } = req.params;
        const userId = req.session.user.id;

        await ensureQuizBelongsToTeacher(quizId, userId);
        const rows = await Question.getByQuizId(quizId);

        const questions = rows.map(q => ({
            ...q,
            options: typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || [])
        }));

        res.status(200).json({ questions });
    } catch (err) {
        next(err);
    }
};

exports.addQuizQuestion = async (req, res, next) => {
    try {
        const { question_text, marks, options, image_url } = req.body;
        const { quizId } = req.params;

        if (!question_text || !options || options.length < 2) {
            return res.status(400).json({ message: "Invalid data" });
        }

        const { questionId } = await Question.createWithOptions(
            quizId,
            question_text,
            marks,
            options,
            image_url
        );

        res.status(201).json({ message: "Question created", questionId });
    } catch (err) {
        next(err);
    }
};

// 🛠️ TIMEZONE-AWARE DYNAMIC HELPER
const toMySQLDateTime = (date) => {
    const tz = process.env.NODE_ENV === 'production' ? 'UTC' : Intl.DateTimeFormat().resolvedOptions().timeZone;

    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: 'numeric', minute: '2-digit', second: '2-digit',
        hour12: false
    });

    const parts = formatter.formatToParts(date).reduce((acc, part) => {
        acc[part.type] = part.value;
        return acc;
    }, {});

    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
};

exports.createQuiz = async (req, res, next) => {
    try {
        if (!req.session.user || req.session.user.role !== 'teacher') {
            return res.status(403).json({ message: 'Unauthorized access' });
        }

        const { subject_id, title, description, duration_minutes, start_time, end_time } = req.body;

        if (!subject_id || !title || !duration_minutes || !start_time || !end_time) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const start = new Date(start_time);
        const end = new Date(end_time);
        const now = new Date();

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ message: 'Invalid date format' });
        }

        if (start < new Date(now.getTime() - 60000)) {
            return res.status(400).json({ message: 'Start time cannot be in the past' });
        }

        if (end <= start) {
            return res.status(400).json({ message: 'End time must be after start time' });
        }

        const duration = Number(duration_minutes);
        const userId = req.session.user.id;
        const [teacherRows] = await Teacher.findByUserId(userId);

        if (teacherRows.length === 0) {
            return res.status(404).json({ message: 'Teacher not found' });
        }

        const teacherId = teacherRows[0].teacher_id;

        const overlappingQuizzes = await Quiz.checkOverlap(
            subject_id,
            teacherId,
            toMySQLDateTime(start),
            toMySQLDateTime(end)
        );

        if (overlappingQuizzes) {
            return res.status(400).json({
                message: 'Another quiz overlaps with this time period.',
            });
        }

        const result = await Quiz.createQuiz(
            subject_id,
            teacherId,
            title,
            description || '',
            duration,
            toMySQLDateTime(start),
            toMySQLDateTime(end)
        );

        res.status(201).json({
            message: 'Quiz created successfully',
            quiz_id: result.insertId,
        });

    } catch (err) {
        next(err);
    }
};

exports.getTeacherQuizzes = async (req, res, next) => {
    try {
        if (!req.session.user || req.session.user.role !== 'teacher') {
            return res.status(403).json({ message: 'Unauthorized access' });
        }

        const userId = req.session.user.id;
        const [teacherRows] = await Teacher.findByUserId(userId);
        if (teacherRows.length === 0) {
            return res.status(404).json({ message: 'Teacher not found' });
        }

        const teacherId = teacherRows[0].teacher_id;
        const quizzes = await Quiz.getQuizzesByTeacher(teacherId);

        res.status(200).json({ quizzes });
    } catch (err) {
        next(err);
    }
};

exports.getQuizzesBySubjectForTeacher = async (req, res, next) => {
    try {
        if (!req.session.user || req.session.user.role !== 'teacher') {
            return res.status(403).json({ message: 'Unauthorized access' });
        }

        const userId = req.session.user.id;
        const [teacherRows] = await Teacher.findByUserId(userId);
        if (teacherRows.length === 0) {
            return res.status(404).json({ message: 'Teacher not found' });
        }

        const teacherId = teacherRows[0].teacher_id;
        const subjectId = req.params.subjectId;
        const quizzes = await Quiz.getQuizzesBySubjectAndTeacher(subjectId, teacherId);

        res.status(200).json({
            subjectName: quizzes[0]?.subject_name || 'Subject',
            quizzes,
        });
    } catch (err) {
        next(err);
    }
};

exports.getQuizById = async (req, res, next) => {
    try {
        const quizId = req.params.id;
        const [quizRows] = await Quiz.findById(quizId);

        if (quizRows.length === 0) {
            return res.status(404).json({ message: 'Quiz not found' });
        }

        res.status(200).json({ quiz: quizRows[0] });
    } catch (err) {
        next(err);
    }
};

exports.updateQuizStatus = async (req, res, next) => {
    try {
        if (!req.session.user || req.session.user.role !== 'teacher') {
            return res.status(403).json({ message: 'Unauthorized access' });
        }

        const { quiz_id, status } = req.body;
        const validStatuses = ['draft', 'active', 'completed'];

        if (!quiz_id || !status || !validStatuses.includes(status)) {
            return res.status(400).json({ message: 'Invalid quiz_id or status' });
        }

        await Quiz.updateStatus(quiz_id, status);
        res.status(200).json({ message: `Quiz status updated to '${status}'` });
    } catch (err) {
        next(err);
    }
};

exports.deleteQuizQuestion = async (req, res, next) => {
    try {
        if (!req.session.user || req.session.user.role !== "teacher") {
            return res.status(403).json({ message: "Unauthorized access" });
        }

        const { quizId, questionId } = req.params;
        await ensureQuizBelongsToTeacher(quizId, req.session.user.id);

        const imageRows = await Question.getImagesById(questionId);
        const imagePaths = new Set();

        imageRows.forEach(row => {
            if (row.question_image) imagePaths.add(row.question_image);
            if (row.option_image) imagePaths.add(row.option_image);
        });

        for (const imgUrl of imagePaths) {
            await deleteFromCloudinary(imgUrl);
        }

        await Question.deleteById(questionId);
        res.status(200).json({ message: "Question deleted successfully" });
    } catch (err) {
        next(err);
    }
};

exports.updateQuestion = async (req, res, next) => {
    try {
        if (!req.session.user || req.session.user.role !== "teacher") {
            return res.status(403).json({ message: "Unauthorized access" });
        }

        const { quizId, questionId } = req.params;
        const { question_text, marks, options, image_url } = req.body;

        await ensureQuizBelongsToTeacher(quizId, req.session.user.id);

        await Question.updateQuestion(
            quizId,
            questionId,
            question_text,
            marks,
            options,
            image_url
        );

        res.json({ message: "Question updated successfully" });
    } catch (err) {
        next(err);
    }
};

exports.deleteQuiz = async (req, res, next) => {
    try {
        if (!req.session.user || req.session.user.role !== "teacher") {
            return res.status(403).json({ message: "Unauthorized access" });
        }

        const quizId = req.params.quizId;
        const userId = req.session.user.id;

        const { teacherId, quiz } = await ensureQuizBelongsToTeacher(quizId, userId);
        const now = new Date();

        if (quiz.start_time && new Date(quiz.start_time) <= now) {
            return res.status(400).json({
                message: "Cannot delete quiz that has started or completed",
            });
        }

        await Quiz.deleteQuiz(quizId, teacherId);
        res.status(200).json({ message: "Quiz deleted successfully" });
    } catch (err) {
        next(err);
    }
};

exports.getUploadSignature = async (req, res, next) => {
    try {
        if (!req.session.user) return res.status(401).json({ message: "Unauthorized" });

        const timestamp = Math.round(new Date().getTime() / 1000);
        const folder = req.query.folder || 'quiz_uploads';

        const signature = cloudinary.utils.api_sign_request(
            { timestamp, folder },
            process.env.CLOUDINARY_API_SECRET
        );

        res.json({
            signature,
            timestamp,
            cloudName: process.env.CLOUDINARY_CLOUD_NAME,
            apiKey: process.env.CLOUDINARY_API_KEY,
            folder
        });
    } catch (err) {
        next(err);
    }
};