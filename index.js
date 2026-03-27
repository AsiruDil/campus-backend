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

// ✅ 1. Render Proxy Fix
app.set("trust proxy", 1);

// ✅ 2. CORS Configuration
const allowedOrigins = [
  "https://university-job-finder.vercel.app",
  "http://localhost:5173"
];

const corsOptions = {
    origin: function (origin, callback) {
        // allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        if (allowedOrigins.indexOf(origin) === -1) {
            return callback(new Error('CORS policy violation'), false);
        }
        return callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
};

// ✅ මෙම පේළිය පමණක් ප්‍රමාණවත් (Options එක ඉවත් කළා)
app.use(cors(corsOptions));

app.use(bodyParser.json());

// ✅ 3. Token Middleware
app.use((req, res, next) => {
    const tokenString = req.header("Authorization");

    if (tokenString && tokenString.startsWith("Bearer ")) {
        const token = tokenString.replace("Bearer ", "");

        jwt.verify(token, process.env.JWT_KEY, (err, decoded) => {
            if (err) {
                console.log(`Token Verification Info: ${err.message}`);
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

// Home route to check if server is alive
app.get("/", (req, res) => res.send("Backend is Live! 🚀"));

// ✅ 5. Database Connection
mongoose.connect(process.env.MONGODB_URL)
    .then(() => console.log('✅ Connected to the database'))
    .catch((err) => console.error('❌ Database connection failed:', err));

// ✅ 6. Port Binding
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});