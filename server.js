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

    
    if (user.role === "teacher" && user.teacher_id) {
        const teacherRoom = `teacher_${user.teacher_id}`;
        socket.join(teacherRoom);
        console.log(`👨‍🏫 Monitoring Active: ${user.name} joined room ${teacherRoom}`);
    }

    
    if (user.role === "student" && user.student_id) {
        const studentRoom = `student_${user.student_id}`;
        socket.join(studentRoom);
        console.log(`🎓 Student Active: ${user.name} in room ${studentRoom}`);
    }

    socket.on("disconnect", () => {
        console.log(`🔌 ${user.name} disconnected.`);
    });
});


io.engine.on("connection_error", (err) => {
    console.error("Socket Connection Error:", err.message);
});

const port = process.env.port || 3000;
server.listen(port, () => {
    console.log(` Server + Socket running on port ${port}`);
});