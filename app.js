import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import passport from "passport";
import userRouter from "./routes/userRoute.js";
import jobVacancyRouter from "./routes/jobVacancyRouter.js";
import applyRouter from "./routes/applyRouter.js";
import activityLogRouter from './routes/activityLogRouter.js';
import { activityLogger } from './middleware/activityLog.js';

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY_HOPS) app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS));
app.use(helmet());
const allowedOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173').split(',').map(value => value.trim());
app.use(cors({ origin(origin, callback) { callback(null, !origin || allowedOrigins.includes(origin)); } }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/ready', (req, res) => res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({ status: mongoose.connection.readyState === 1 ? 'ready' : 'not-ready' }));
app.use(express.json({ limit: "100kb" }));
app.use(passport.initialize());
app.use((req, res, next) => {
  const header = req.header("Authorization");
  if (!header) return next();
  try {
    req.user = jwt.verify(
      header.replace(/^Bearer /i, ""),
      process.env.JWT_KEY,
      { algorithms: ["HS256"] },
    );
    next();
  } catch {
    res
      .status(401)
      .json({ message: "Session expired or invalid. Please log in again." });
  }
});
app.use('/api', activityLogger);
app.use('/api/activity-logs', activityLogRouter);
app.use("/api/users", userRouter);
app.use("/api/jobs", jobVacancyRouter);
app.use("/api/apply", applyRouter);
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.name === "MulterError")
    return res
      .status(400)
      .json({
        message:
          error.code === "LIMIT_FILE_SIZE"
            ? "Each file must be no larger than 5 MB; CVs are limited to 2 MB."
            : "Upload one CV and up to 10 supporting documents.",
      });
  if (error.name === "ValidationError" || error.name === "CastError")
    return res
      .status(400)
      .json({ message: "Please check the supplied fields." });
  const status = error.status || 500;
  res
    .status(status)
    .json({
      message:
        status < 500
          ? error.message
          : "The request could not be completed. Please try again.",
    });
});
export default app;
