import express from "express";
import { createUser, getAllUsers, getMessagesByEmail, getUser, loginUser, sendGroupEmail, toggleBlockUser, updateUser } from "../controllers/userController.js";

const userRouter= express.Router();

userRouter.post("/",createUser)
userRouter.post("/login",loginUser)
userRouter.put("/:userName",updateUser)
userRouter.get("/:userName",getUser)
userRouter.get("/",getAllUsers)
userRouter.put("/toggle-block/:userName",toggleBlockUser)
userRouter.post('/send-email',sendGroupEmail);
userRouter.get('/history/:email',getMessagesByEmail);

export default userRouter;