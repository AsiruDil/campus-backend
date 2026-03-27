import mongoose from "mongoose";
import dotenv from "dotenv";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import jwt from "jsonwebtoken";
import userRouter from "./routes/userRoute.js";
import jobVacancyRouter from "./routes/jobVacancyRouter.js";
import applyRouter from "./routes/applyRouter.js";

dotenv.config();
const app = express();

// ✅ 1. Render/Proxy Fix (Google Auth සඳහා අනිවාර්යයි)
app.set("trust proxy", 1);

// ✅ 2. CORS Configuration
// ⚠️ මෙතන Vercel URL එක ඔයාගේ සැබෑ ලින්ක් එකටම සමානදැයි බලන්න (Spelling check)
const allowedOrigins = [
  "https://university-job-finder.vercel.app", // මෙතන spelling බලන්න
  "https://univerty-job-finder.vercel.app",   // ඔයා කලින් එවපු spelling එකත් මම ඇතුළත් කළා
  "http://localhost:5173"
];

const corsOptions = {
    origin: function (origin, callback) {
        // allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
            callback(null, true);
        } else {
            callback(new Error('CORS policy violation'));
        }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
};

// Middleware පිළිවෙල ඉතා වැදගත්!
app.use(cors(corsOptions));
app.use(bodyParser.json());
app.use(express.json()); // අමතර ආරක්ෂාවට

// ✅ 3. Token Verification Middleware
app.use((req, res, next) => {
    const tokenString = req.header("Authorization");

    if (tokenString && tokenString.startsWith("Bearer ")) {
        const token = tokenString.replace("Bearer ", "");

        jwt.verify(token, process.env.JWT_KEY, (err, decoded) => {
            if (err) {
                // Token එකේ ප්‍රශ්නයක් තිබුණත් request එක ඉදිරියට යවනවා 
                // (Controller එකේදී req.user නැත්නම් 401 දිය හැක)
                console.log(`Token Info: ${err.message}`);
                next();
            } else {
                req.user = decoded;
                next();
            }
        });
    } else {
        next();
    }
});

// ✅ 4. API Routes
app.use("/api/users", userRouter);
app.use('/api/jobs', jobVacancyRouter);
app.use('/api/apply', applyRouter);

// Server එක වැඩදැයි බලන්න Home route එකක්
app.get("/", (req, res) => res.send("Backend is Live and Running! 🚀"));

// ✅ 5. Database Connection
mongoose.connect(process.env.MONGODB_URL)
    .then(() => console.log('✅ Connected to the database'))
    .catch((err) => console.error('❌ Database connection failed:', err));

// ✅ 6. Port Binding (Render විසින් PORT එක ලබා දෙයි)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});    