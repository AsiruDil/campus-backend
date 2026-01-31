import express from "express";
import { createUser, getAllUsers, getUser, loginUser, updateUser } from "../controllers/userController.js";

const userRouter= express.Router();

userRouter.post("/",createUser)
userRouter.post("/login",loginUser)
userRouter.put("/",updateUser)
userRouter.get("/:userName",getUser)
userRouter.get("/",getAllUsers)

export default userRouter;