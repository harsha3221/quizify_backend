const User = require('../model/user');
const bcrypt = require('bcrypt');
const Teacher = require('../model/teacher.js');
const Student = require('../model/student');
const crypto = require('crypto');
const emailService = require('../services/emailService');


exports.postSignup = async (req, res, next) => {
  try {
    const { name, email, password, confirmPassword, role, department, year } = req.body;

    if (!role || !["teacher", "student"].includes(role)) {
      return res.status(400).json({ message: "Invalid role selected" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    const [existing] = await User.findEmail(email);
    if (existing.length > 0) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

    const expiryMinutes = Number(process.env.TOKEN_EXPIRY_MINUTES) || 15;
    const expiryDate = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // ✅ PASS DATE DIRECTLY (NO toISOString)
    const user = new User(
      name,
      email,
      hashedPassword,
      role,
      false,
      hashedToken,
      expiryDate
    );

    const [result] = await user.insert();
    const userId = result.insertId;

    if (role === "teacher") {
      const teacher = new Teacher(userId, department);
      await teacher.insert();
    } else {
      const student = new Student(userId, null, year);
      await student.insert();
    }

    const verificationLink = `${process.env.BASE_URL}/verify?token=${rawToken}`;
    await emailService.sendVerificationEmail(email, verificationLink);

    return res.status(201).json({
      message: "Registration successful. Please check your email to verify your account."
    });

  } catch (err) {
    next(err);
  }
};




exports.verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ message: "Token is missing" });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    const [rows] = await User.findByVerificationToken(hashedToken);

    // 1. Check if user exists
    if (rows.length === 0) {
      return res.status(404).json({ message: "Invalid or expired token" });
    }


    const expiryTime = new Date(rows[0].verification_token_expiry);
    if (expiryTime < new Date()) {
      return res.status(410).json({ message: "Token has expired" });
    }


    await User.verifyUser(rows[0].id);


    return res.status(200).json({ message: "Email verified successfully" });

  } catch (err) {
    next(err);
  }
};


exports.resendVerification = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const [rows] = await User.findEmail(email);

    if (rows.length === 0) {
      return res.status(400).json({ message: "User not found" });
    }

    const user = rows[0];

    if (user.is_verified) {
      return res.status(400).json({ message: "Account already verified" });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

    const expiryMinutes = Number(process.env.TOKEN_EXPIRY_MINUTES) || 15;
    const expiryDate = new Date(Date.now() + expiryMinutes * 60 * 1000);

    
    await User.updateVerificationToken(user.id, hashedToken, expiryDate);

    const verificationLink = `${process.env.BASE_URL}/verify?token=${rawToken}`;
    await emailService.sendVerificationEmail(email, verificationLink);

    return res.status(200).json({
      message: "Verification email resent successfully."
    });

  } catch (err) {
    console.error("Resend verification error:", err);
    return res.status(500).json({
      message: err.message
    });
    next(err);
  }
};



exports.postLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const [rows] = await User.findEmail(email);
    if (rows.length === 0) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const user = rows[0];

    if (!user.is_verified) {
      return res.status(403).json({
        message: "Email not verified",
        needsVerification: true,
        email: user.email,
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    req.session.isLoggedIn = true;

    if (user.role === "teacher") {
      const [teacherRows] = await Teacher.findByUserId(user.id);
      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        teacher_id: teacherRows[0].teacher_id,
      };
    } else {
      const [studentRows] = await Student.findByUserId(user.id);
      req.session.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        student_id: studentRows[0].student_id,
      };
    }

    
    req.session.save((err) => {
      if (err) return next(err);

      return res.status(200).json({
        message: "Login successful",
        user: req.session.user,
      });
    });
  } catch (err) {
    next(err);
  }
};

exports.logout = (req, res, next) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.status(200).json({ message: "Logged out successfully" });
  });
};
