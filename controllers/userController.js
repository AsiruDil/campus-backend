import User from "../models/user.js"
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken";
import dotenv from 'dotenv';

dotenv.config()

export async function createUser(req,res){

  

    if(req.body.role=="admin"){
        if(req.user!=null){
            if(req.user.role != "admin"){
                res.status(403).json({
                    message:"You are not authorized to create an admin account"
                })
                return
            }
        }else{
            res.status(403).json({
                message:"you are not authorized to create an admin accouts please login first"
            })
            return
        }
    }



    const hashedPassword=bcrypt.hashSync(req.body.password,10)
    const user =new User({
        email:req.body.email,
        userName:req.body.userName,
        firstName: req.body.firstName,
        lastName :req.body.lastName,
        password:hashedPassword,
        role:req.body.role,
    })

    try{    
            const findName = await User.findOne({userName:req.body.userName})
            const findEmail = await User.findOne({email:req.body.email})

            if(findName!=null){
                res.status(403).json({
                    message:"UserName already exit"
                })
                return
            }
             else if(findEmail!=null){
                res.status(403).json({
                    message:"Gmail already exit"
                })
                return
            }

            else{
  
                await user.save()
                res.json({
                message:"user created suceessfully"
       })
    }
            
      
    }catch(err){
            res.status(500).json({
            message:"failed to create user",
            error:err
        })
    
}
}

export function loginUser(req,res){
    const email=req.body.email
    const password=req.body.password
    const userName=req.body.userName

    User.findOne({
        $or:[
            {email:email},
            {userName:userName}
        ]
    }).then((user)=>{
            if(user==null){
                res.status(404).json({
                    message:"User not found"
                })
                return
            }else{
                const isPasswordCorrect=bcrypt.compareSync(password,user.password)
                if(isPasswordCorrect){
                    const token = jwt.sign({
                        email:user.email,
                        userName:user.userName,
                        firstName:user.firstName,
                        lastName:user.lastName,
                        role:user.role,
                        img:user.img
                    },
                      process.env.JWT_KEY
                )
                  res.json({
                    message:"login successfully",
                    token:token,
                    type:user.role
                  })
                }else{
                    res.status(401).json({
                        message:"invalid password"
                    })
                }
            }
    })
}