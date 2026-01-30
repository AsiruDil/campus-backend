import express from "express";
import { createUser, loginUser, updateUser } from "../controllers/userController.js";

const userRouter= express.Router();

userRouter.post("/",createUser)
userRouter.post("/login",loginUser)
userRouter.put("/",updateUser)

export default userRouter;