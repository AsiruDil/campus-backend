import mongoose from "mongoose";
import dotenv from "dotenv";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import jwt from "jsonwebtoken";
import userRouter from "./routes/userRoute.js";

dotenv.config();
const app=express()
app.use(cors())
app.use(bodyParser.json())

app.use((req,res,next)=>{
    const tokenString=req.header("Authorization")
    if(tokenString!=null){
        const token = tokenString.replace("Bearer ","")
        jwt.verify(token,process.env.JWT_KEY,
            (err,decoded)=>{
                if(decoded != null){
                    req.user=decoded
                    next()
                }else{
                    console.log("invalid token")
                    res.status(403).json({
                        message:"invalid token"
                    })
                }
            }
        )
    }else{
        next();
    }
})

mongoose.connect(process.env.MONGODB_URL).then(()=>{
    console.log('connect to the database')
}).catch(()=>{
    console.log('database connection failed')
})

app.use("/api/users",userRouter)

app.listen(3000,()=>{
    console.log('server is running on port 3000')
})  