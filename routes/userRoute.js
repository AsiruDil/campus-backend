import { avatarUpload, saveAvatar, getAvatar } from '../services/avatars.js';
import { limitConcurrentUploads } from '../middleware/security.js';
import { authLimiter, otpLimiter, emailLimiter, notificationLimiter, validateAuthInput, startGoogleState, checkGoogleState } from '../middleware/security.js';
import express from "express";
import "../util/passport.js";
import passport from "passport";

import {
    createUser, getAllUsers, getMessagesByEmail, getUser,
    loginUser, sendGroupEmail, toggleBlockUser, updateUser,
    verifyEmail, forgotPassword, resetPassword,
    googleAuthCallback
} from "../controllers/userController.js";

import { requireRoles } from '../middleware/access.js';
const userRouter = express.Router();

// --- STATIC ROUTES FIRST ---
userRouter.get('/avatar/:key', getAvatar);
userRouter.post('/profile-photo', requireRoles(), notificationLimiter, limitConcurrentUploads, avatarUpload, saveAvatar);
userRouter.post("/verify-email", otpLimiter, validateAuthInput("verify"), verifyEmail);
userRouter.post("/forgot-password", emailLimiter, validateAuthInput("email"), forgotPassword);
userRouter.post("/reset-password", otpLimiter, validateAuthInput("reset"), resetPassword);
userRouter.post("/login", authLimiter, validateAuthInput("login"), loginUser);
userRouter.post("/", emailLimiter, validateAuthInput("register"), (req, res, next) => req.user ? requireRoles()(req, res, next) : next(), createUser);
userRouter.get("/", requireRoles("superadmin"), getAllUsers);
userRouter.post("/send-email", requireRoles("superadmin"), notificationLimiter, sendGroupEmail);

// --- GOOGLE AUTH ROUTES ---
const googleConfigured = (req, res, next) => process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? next() : res.status(503).json({ message: 'Google sign-in is not configured. Please sign in with your password.' });
userRouter.get("/auth/google", googleConfigured, authLimiter, startGoogleState, (req, res, next) => passport.authenticate("google", { scope: ["profile", "email"], state: req.oauthState })(req, res, next));
userRouter.get(
    "/auth/google/callback", googleConfigured, checkGoogleState,
    passport.authenticate("google", { session: false }),
    googleAuthCallback
);

// --- PREFIXED DYNAMIC-LIKE ROUTES (before /:userName) ---
userRouter.get("/history/:email", requireRoles(), (req, res, next) => {
    if (!['superadmin'].includes(req.user.role) && req.user.email !== req.params.email) return res.status(403).json({ message: 'Access denied.' });
    next();
}, getMessagesByEmail);
userRouter.put("/toggle-block/:userName", requireRoles("superadmin"), toggleBlockUser);

// --- DYNAMIC ROUTES LAST ---
userRouter.put("/:userName", requireRoles(), updateUser);
userRouter.get("/:userName", requireRoles(), getUser);

export default userRouter;
