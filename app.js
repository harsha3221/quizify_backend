require("dotenv").config();
const express = require("express");
const app = express();

// 🚀 CRITICAL FOR RATE LIMITING & SECURE COOKIES IN DEPLOYMENT
// Tells Express to trust upstream reverse proxies (Render, AWS, Heroku, etc.)
app.set("trust proxy", 1);

const db = require("./config/database");
const authRoute = require("./routes/auth");
const analyticsRoutes = require("./routes/analytics");
const teacherRoute = require("./routes/teacher");
const studentRoutes = require("./routes/student");
const quizRoutes = require("./routes/quiz");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const cors = require("cors");
const csrf = require("csurf");
const path = require("path");
const cheatingRoutes = require('./routes/cheating.js');

const allowedOrigins = process.env.frontend_url ? process.env.frontend_url.split(',') : [];
/* ---------------- CORS ---------------- */
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const isProduction = process.env.NODE_ENV === 'production';

/* ---------------- SESSION ---------------- */
const sessionStore = new MySQLStore({
  clearExpired: true,
  checkExpirationInterval: 900000,
}, db.db);

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "your_secret_here",
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  proxy: true, // Working in tandem with app.set("trust proxy", 1)
  cookie: {
    maxAge: 1000 * 60 * 60, // 1 hour
    httpOnly: true,
    // CONDITIONAL SETTINGS (Safe for local HTTP and production HTTPS):
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
  },
});

app.use(sessionMiddleware);

/* ---------------- CSRF ---------------- */
const csrfProtection = csrf({ cookie: false });

/* ---------------- ROUTES ---------------- */
app.use(authRoute);
app.use("/analytics", analyticsRoutes);

app.get("/csrf-token", csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});
app.get("/me", csrfProtection, (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  res.json({
    user: req.session.user,
    csrfToken: req.csrfToken(),
  });
});

/* ✅ APPLY CSRF ONLY TO MUTATING ROUTES */
app.use("/quiz", csrfProtection, quizRoutes);
app.use("/teacher", csrfProtection, teacherRoute);
app.use("/student", csrfProtection, studentRoutes);
app.use("/api", csrfProtection, cheatingRoutes);

/* -------------- ERROR HANDLER ------------- */
const errorHandler = require("./middlewares/errorHandler");
app.use(errorHandler);

module.exports = { app, sessionMiddleware };