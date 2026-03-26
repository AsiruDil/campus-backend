import express from "express";
// Import your new passport config
import "../util/passport.js"; // Adjust the path to where you saved passport.js
import passport from "passport";

import { 
    createUser, getAllUsers, getMessagesByEmail, getUser, 
    loginUser, sendGroupEmail, toggleBlockUser, updateUser,
    verifyEmail, forgotPassword, resetPassword, 
    googleAuthCallback // <-- Import the new controller
} from "../controllers/userController.js";

const userRouter = express.Router();

// --- NEW GOOGLE ROUTES ---
// 1. Route that triggers the Google popup
userRouter.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));

// 2. Route Google redirects to after the user signs in
userRouter.get(
    "/auth/google/callback", 
    passport.authenticate("google", { session: false }), 
    googleAuthCallback
);

// --- EXISTING ROUTES ---
userRouter.post("/verify-email", verifyEmail);
userRouter.post("/forgot-password", forgotPassword);
userRouter.post("/reset-password", resetPassword);
userRouter.post("/", createUser);
userRouter.post("/login", loginUser);
userRouter.put("/:userName", updateUser);
userRouter.get("/:userName", getUser);
userRouter.get("/", getAllUsers);
userRouter.put("/toggle-block/:userName", toggleBlockUser);
userRouter.post('/send-email', sendGroupEmail);
userRouter.get('/history/:email', getMessagesByEmail);

export default userRouter;