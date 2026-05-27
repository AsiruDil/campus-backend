import express from "express";
import "../util/passport.js";
import passport from "passport";

import { 
    createUser, getAllUsers, getMessagesByEmail, getUser, 
    loginUser, sendGroupEmail, toggleBlockUser, updateUser,
    verifyEmail, forgotPassword, resetPassword, 
    googleAuthCallback
} from "../controllers/userController.js";

const userRouter = express.Router();

// --- STATIC ROUTES FIRST ---
userRouter.post("/verify-email", verifyEmail);
userRouter.post("/forgot-password", forgotPassword);
userRouter.post("/reset-password", resetPassword);
userRouter.post("/login", loginUser);
userRouter.post("/", createUser);
userRouter.get("/", getAllUsers);
userRouter.post("/send-email", sendGroupEmail);

// --- GOOGLE AUTH ROUTES ---
userRouter.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
userRouter.get(
    "/auth/google/callback",
    passport.authenticate("google", { session: false }),
    googleAuthCallback
);

// --- PREFIXED DYNAMIC-LIKE ROUTES (before /:userName) ---
userRouter.get("/history/:email", getMessagesByEmail);
userRouter.put("/toggle-block/:userName", toggleBlockUser);

// --- DYNAMIC ROUTES LAST ---
userRouter.put("/:userName", updateUser);
userRouter.get("/:userName", getUser);

export default userRouter;