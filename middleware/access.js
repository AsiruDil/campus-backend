import User from "../models/user.js";

export const ROLES = ["user", "admin", "superadmin"];
export const REVIEWERS = ["admin", "superadmin"];

// Always use current permissions, so blocking or changing a role takes effect immediately.
export function requireRoles(...roles) {
  return async (req, res, next) => {
    if (!req.user?.userName)
      return res.status(401).json({ message: "Please log in." });
    const user = await User.findOne({ userName: req.user.userName }).select(
      "-password -otp -otpExpires",
    );
    if (user && (req.user.authVersion || 0) !== (user.authVersion || 0)) return res.status(401).json({ message: "Session expired. Please log in again." });
    if (!user || user.isBlocked)
      return res
        .status(403)
        .json({ message: "Account unavailable or blocked." });
    if (roles.length && !roles.includes(user.role))
      return res
        .status(403)
        .json({ message: "You do not have permission for this action." });
    req.user = user;
    next();
  };
}

export async function applicationScope(user) {
  if (user.role !== "admin") return {};
  if (!user.faculty || !user.department) return { _id: { $in: [] } };
  // Explicit wildcard assignments grant access across that dimension.
  // Missing assignments still deny access above.
  const scope = {};
  if (user.faculty !== "*") scope.faculty = user.faculty;
  if (user.department !== "*") scope.department = user.department;
  if (!Object.keys(scope).length) return {};
  // Historical applications did not store faculty/department; resolve them via their vacancy.
  const { default: JobVacancy } = await import("../models/jobVacancyModel.js");
  const jobs = await JobVacancy.find(scope).select("jobId").lean();
  return {
    $or: [
      scope,
      {
        faculty: { $exists: false },
        jobId: { $in: jobs.map((job) => job.jobId) },
      },
    ],
  };
}
