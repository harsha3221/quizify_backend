// controllers/studentController.js

const Student = require('../model/student');
const Subject = require('../model/subject');
const Quiz = require('../model/quiz');
const Question = require('../model/question');
const StudentQuizAttempt = require('../model/studentQuizAttempt');
const QuizResult = require('../model/quizResult.js');
const StudentAnswer = require('../model/studentAnswer');

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function ensureStudentAndEnrollment(studentId, quizId) {
  const quiz = await Quiz.getQuizWithSubjectAndTeacher(quizId);
  if (!quiz) throw { code: 404, message: "Quiz not found" };

  const enrolled = await Student.isEnrolled(studentId, quiz.subject_id);
  if (!enrolled) throw { code: 403, message: "Student not enrolled in this subject" };

  return { quiz };
}

exports.createQuizAttempt = async (req, res, next) => {
  try {
    if (!req.session.user || req.session.user.role !== "student")
      return res.status(403).json({ message: "Unauthorized" });

    const studentId = req.session.user.student_id;
    const quizId = req.params.quizId;

    await ensureStudentAndEnrollment(studentId, quizId);

    const { attempt } = await StudentQuizAttempt.findOrCreateAttemptAtomic(studentId, quizId);
    res.json({ message: "Attempt created", attempt });
  } catch (err) {
    next(err);
  }
};

exports.getRegisteredCourses = async (req, res, next) => {
  try {
    if (!req.session.user || req.session.user.role !== 'student')
      return res.status(403).json({ message: 'Unauthorized access' });

    const studentId = req.session.user.student_id;
    const [availableSubjects] = await Subject.getAllAvailable();
    const [joinedSubjects] = await Student.getJoinedSubjects(studentId);
    const [studentRows] = await Student.findByUserId(req.session.user.id);

    res.status(200).json({
      student: studentRows[0],
      availableSubjects,
      joinedSubjects
    });
  } catch (err) {
    next(err);
  }
};

exports.getAvailableCourses = async (req, res, next) => {
  try {
    if (!req.session.user || req.session.user.role !== 'student')
      return res.status(403).json({ message: 'Unauthorized access' });

    const studentId = req.session.user.student_id;
    const [availableSubjects] = await Subject.getAllAvailable();
    const [joinedSubjects] = await Student.getJoinedSubjects(studentId);

    res.status(200).json({ availableSubjects, joinedSubjects });
  } catch (err) {
    next(err);
  }
};

exports.joinSubject = async (req, res, next) => {
  try {
    if (!req.session.user || req.session.user.role !== 'student')
      return res.status(403).json({ message: 'Unauthorized access' });

    const { subjectId } = req.body;
    const studentId = req.session.user.student_id;

    const [existing] = await Student.isAlreadyJoined(studentId, subjectId);
    if (existing.length > 0)
      return res.status(400).json({ message: 'Already joined this course' });

    await Student.joinSubject(studentId, subjectId);
    const [[subjectDetails]] = await Subject.findById(subjectId);

    res.status(200).json({
      message: 'Successfully joined course',
      subject: subjectDetails
    });
  } catch (err) {
    next(err);
  }
};

exports.getSubjectQuizzes = async (req, res, next) => {
  try {
    if (!req.session.user || req.session.user.role !== 'student')
      return res.status(403).json({ message: 'Unauthorized access' });

    const studentId = req.session.user.student_id;
    const subjectId = Number(req.params.subjectId);
    const rows = await Quiz.getQuizzesForStudentSubject(subjectId, studentId);

    res.status(200).json({
      quizzes: rows.map(r => ({
        id: r.quiz_id,
        title: r.title,
        description: r.description,
        duration_minutes: r.duration_minutes,
        start_time: r.start_time,
        end_time: r.end_time,
        status: r.status || "draft",
        results_published: !!r.results_published,
        teacher: { id: r.teacher_id, name: r.teacher_name },
        created_at: r.created_at,
        attempted: !!r.attempted,
        submitted: !!r.submitted
      }))
    });
  } catch (err) {
    next(err);
  }
};

exports.startQuizForStudent = async (req, res, next) => {
  try {
    if (!req.session.user || req.session.user.role !== 'student')
      return res.status(403).json({ message: "Unauthorized" });

    const studentId = req.session.user.student_id;
    const quizId = req.params.quizId;

    // 1. Ensure enrollment and fetch quiz master info
    const { quiz } = await ensureStudentAndEnrollment(studentId, quizId);

    // 2. Register or fetch the active attempt structure
    const { isNew, attempt } = await StudentQuizAttempt.findOrCreateAttemptAtomic(studentId, quizId);

    // 3. Fetch questions belonging to this quiz
    // (Ensure your Question model has getByQuizId or a student-safe query variant)
    const rawQuestions = await Question.getByQuizId(quizId);

    // 4. Parse option strings if stored as text JSON arrays in MySQL
    let questions = rawQuestions.map(q => ({
      ...q,
      options: typeof q.options === 'string' ? JSON.parse(q.options) : (q.options || [])
    }));

    // 5. Optional: Shuffle questions or options here if desired for student integrity

    // 6. Fetch existing student answers if they are resuming an active attempt
    // const [existingAnswers] = await StudentAnswer.getStudentAnswersForQuiz(studentId, quizId);

    // Return everything the React frontend needs to render the screen cleanly
    res.json({
      message: isNew ? "Quiz started successfully." : "Quiz session resumed.",
      attempt,
      quiz,
      questions,
      existingAnswers: [] // replace with actual database pull if saving state dynamically
    });
  } catch (err) {
    next(err);
  }
};
exports.saveStudentAnswer = async (req, res, next) => {
  try {
    if (!req.session.user || req.session.user.role !== 'student')
      return res.status(403).json({ message: "Unauthorized" });

    const studentId = req.session.user.student_id;
    const quizId = req.params.quizId;
    const { question_id, option_id, option_ids } = req.body;

    const { quiz } = await ensureStudentAndEnrollment(studentId, quizId);
    const { attempt } = await StudentQuizAttempt.findOrCreateAttemptAtomic(studentId, quizId);

    if (attempt.submitted) {
      return res.status(403).json({ message: "Quiz already submitted" });
    }

    const tz = process.env.NODE_ENV === 'production' ? 'UTC' : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const localizedNowStr = new Date().toLocaleString("en-US", { timeZone: tz });
    const now = new Date(localizedNowStr);

    if (quiz.start_time && new Date(quiz.start_time) > now) {
      return res.status(403).json({ message: "Quiz has not started yet" });
    }

    if (attempt.started_at && quiz.duration_minutes) {
      const startTime = new Date(attempt.started_at).getTime();
      const durationMs = quiz.duration_minutes * 60 * 1000;
      const personalDeadline = startTime + durationMs;

      if (now.getTime() > personalDeadline + 5000) {
        return res.status(403).json({ message: "Your personal quiz time has expired" });
      }
    }

    const ids = option_ids || (option_id ? [option_id] : []);
    await StudentAnswer.saveAnswersBulk(studentId, quizId, question_id, ids);

    res.json({ message: "Saved" });
  } catch (err) {
    next(err);
  }
};

exports.submitStudentQuiz = async (req, res, next) => {
  try {
    if (!req.session.user || req.session.user.role !== 'student')
      return res.status(403).json({ message: "Unauthorized" });

    const studentId = req.session.user.student_id;
    const quizId = req.params.quizId;

    const timing = await StudentQuizAttempt.getAttemptTiming(studentId, quizId);

    if (timing) {
      const startTime = new Date(timing.started_at).getTime();
      const allowedDurationMs = timing.duration_minutes * 60 * 1000;
      const absoluteDeadline = startTime + allowedDurationMs + 30000;

      if (Date.now() > absoluteDeadline) {
        await StudentQuizAttempt.forceTimeoutSubmit(studentId, quizId);
        return res.status(403).json({
          message: "Submission Rejected: The allotted time for this quiz has expired."
        });
      }
    }

    const successfullySubmitted = await StudentQuizAttempt.submitAttemptAtomic(studentId, quizId);

    if (!successfullySubmitted) {
      return res.status(400).json({
        message: "Quiz already submitted or processing request in progress."
      });
    }

    const { total, obtained } = await QuizResult.evaluateAndSubmit(studentId, quizId);

    res.json({
      message: "Submitted",
      total_marks: total,
      obtained_marks: obtained
    });
  } catch (err) {
    next(err);
  }
};

exports.getQuizSummary = async (req, res, next) => {
  try {
    if (!req.session.user || req.session.user.role !== "student")
      return res.status(403).json({ message: "Unauthorized" });

    const studentId = req.session.user.student_id;
    const quizId = req.params.quizId;

    const { quiz } = await ensureStudentAndEnrollment(studentId, quizId);

    res.json({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        teacher_name: quiz.teacher_name || "",
        start_time: quiz.start_time,
        end_time: quiz.end_time
      }
    });
  } catch (err) {
    next(err);
  }
};

exports.getStudentQuizResult = async (req, res, next) => {
  try {
    if (!req.session.user || req.session.user.role !== "student")
      return res.status(403).json({ message: "Unauthorized" });

    const studentId = req.session.user.student_id;
    const quizId = req.params.quizId;

    await ensureStudentAndEnrollment(studentId, quizId);

    const published = await Quiz.isResultPublished(quizId);
    if (!published)
      return res.status(403).json({ message: "Results not published yet" });

    const result = await QuizResult.getStudentResult(studentId, quizId);
    if (!result)
      return res.status(404).json({ message: "Result not found" });

    res.json({ result });
  } catch (err) {
    next(err);
  }
};