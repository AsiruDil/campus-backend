import mongoose from "mongoose";
import dotenv from "dotenv";
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import jwt from "jsonwebtoken";
import userRouter from "./routes/userRoute.js";
import jobVacancyRouter from "./routes/jobVacancyRouter.js";
import applyRouter from "./routes/applyRouter.js";
import User from "./models/user.js";

dotenv.config();
const app=express()
app.set("trust proxy", 1);
app.use(cors())
app.use(bodyParser.json())

app.use((req, res, next) => {
    const tokenString = req.header("Authorization");
    
    if (tokenString != null) {
        const token = tokenString.replace("Bearer ", "");
        
        jwt.verify(token, process.env.JWT_KEY, (err, decoded) => {
            if (err) {
                // If the token is expired, tampered with, or invalid
                console.log(`Token Error: ${err.message}`); // This gives you better debugging info!
                
                // Send a 401 Unauthorized status back to the React app
                return res.status(401).json({
                    message: "Session expired or invalid token"
                });
            } else {
                // Token is good! Attach user data and continue
                req.user = decoded;
                next();
            }
        });
    } else {
        // No token provided (for public routes like login/register)
        next(); 
    } 
});

mongoose.connect(process.env.MONGODB_URL).then(()=>{
    console.log('connect to the database')
}).catch(()=>{
    console.log('database connection failed')
})

app.use("/api/users",userRouter)
app.use('/api/jobs',jobVacancyRouter);
app.use('/api/apply',applyRouter)

app.listen(3000,()=>{
    console.log('server is running on port 3000')
})   