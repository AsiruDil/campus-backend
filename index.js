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

// ✅ Render Proxy Fix
app.set("trust proxy", 1);

// ✅ CORS Configuration
app.use(cors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true
}));

app.use(bodyParser.json());

// ✅ Token Middleware (FIXED: Won't block Public Routes)
app.use((req, res, next) => {
    const tokenString = req.header("Authorization");

    if (tokenString && tokenString.startsWith("Bearer ")) {
        const token = tokenString.replace("Bearer ", "");

        jwt.verify(token, process.env.JWT_KEY, (err, decoded) => {
            if (err) {
                // Token එක වැරදි වුණත් request එක block කරන්නේ නැහැ, 
                // ඒත් req.user එකට data වැටෙන්නේ නැහැ.
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

// ✅ Routes
app.use("/api/users", userRouter);
app.use('/api/jobs', jobVacancyRouter);
app.use('/api/apply', applyRouter);

// ✅ Database Connection
mongoose.connect(process.env.MONGODB_URL)
    .then(() => console.log('Connected to the database'))
    .catch((err) => console.log('Database connection failed:', err));

// ✅ Port Binding (FIXED for Render)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});