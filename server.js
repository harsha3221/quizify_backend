require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");

const { app, sessionMiddleware } = require("./app");
const server = http.createServer(app);

const allowedOrigins = process.env.frontend_url ? process.env.frontend_url.split(',') : [];

const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        credentials: true,
    },
});

io.engine.use(sessionMiddleware);

global.io = io;

io.on("connection", (socket) => {
    const user = socket.request.session?.user;

    if (!user) {
        console.log(`⚠️ Anonymous connection rejected: ${socket.id}`);
        return socket.disconnect(true);
    }

    console.log(`✨ Connected: ${user.name} (Role: ${user.role})`);

    // 👨‍🏫 TEACHER ROOM ACCESS REGULATION
    if (user.role === "teacher" && user.teacher_id) {
        const teacherRoom = `teacher_${user.teacher_id}`;
        socket.join(teacherRoom);
        console.log(`👨‍🏫 Monitoring Active: ${user.name} joined room ${teacherRoom}`);
    }
    // 🎓 STUDENT ROOM ACCESS REGULATION
    else if (user.role === "student" && user.student_id) {
        const studentRoom = `student_${user.student_id}`;
        socket.join(studentRoom);
        console.log(`🎓 Student Active: ${user.name} in room ${studentRoom}`);
    }
    // 🚫 MALFORMED ROLE REJECTION
    else {
        console.warn(`⚠️ Connection rejected due to unrecognized role metadata: ${socket.id}`);
        return socket.disconnect(true);
    }

    // INTERCEPT SPOOFED INBOUND ROOM MANIPULATION REQUESTS
    socket.on("join", (requestedRoom) => {
        console.warn(`⚠️ Blocked unauthorized dynamic room join attempt from ${user.name}: ${requestedRoom}`);
        // Silently drop or inform client they cannot dynamically register rooms outside of setup boundaries
    });

    socket.on("disconnect", (reason) => {
        console.log(`🔌 ${user.name} disconnected. Reason: ${reason}`);
        // Socket.io cleanly removes the socket from all rooms automatically upon drop, 
        // but tracking the reason aids in debugging proctoring disconnect bypasses.
    });
});

io.engine.on("connection_error", (err) => {
    console.error("Socket Connection Error:", err.message);
});

const port = process.env.port || 3000;
server.listen(port, () => {
    console.log(` Server + Socket running on port ${port}`);
});