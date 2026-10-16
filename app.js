import "dotenv/config";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import passport from "passport";
import userRouter from "./routes/userRoute.js";
import jobVacancyRouter from "./routes/jobVacancyRouter.js";
import applyRouter from "./routes/applyRouter.js";

const app = express();
app.use(cors());
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
        status < 500 || status === 503
          ? error.message
          : "The request could not be completed. Please try again.",
    });
});
export default app;
