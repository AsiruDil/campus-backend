import User from "../models/user.js"
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken";
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import Message from "../models/message.js";

dotenv.config()

// Helper function to generate a 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

export async function createUser(req,res){

    // ✅ FIXED: only admin can create admin
    if(req.body.role === "admin"){
        if(!req.user || req.user.role !== "admin"){
            return res.status(403).json({
                message:"Only admin can create admin"
            })
        }
    }

    // ✅ FIXED: only admin can create moderator (madam)
    if(req.body.role === "madam"){
        if(!req.user || req.user.role !== "admin"){
            return res.status(403).json({
                message:"Only admin can create moderator"
            })
        }
    }

    try{    
        const findName = await User.findOne({userName:req.body.userName})
        const findEmail = await User.findOne({email:req.body.email})

        if(findName!=null){
            return res.status(403).json({ message:"UserName already exists" })
        }
        else if(findEmail!=null){
             return res.status(403).json({ message:"Email already exists" })
        }

        const hashedPassword=bcrypt.hashSync(req.body.password,10)
        
        // --- NEW: Generate OTP and Expiration ---
        const otp = generateOTP();
        const otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

        const user = new User({
            email:req.body.email,
            userName:req.body.userName,
            firstName: req.body.firstName,
            lastName :req.body.lastName,
            password:hashedPassword,
            role:req.body.role,
            otp: otp, // Save OTP
            otpExpires: otpExpires // Save Expiration
        })

        await user.save()

        // --- NEW: Send Verification Email ---
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER, 
                pass: process.env.EMAIL_PASS 
            }
        });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: req.body.email,
            subject: "Verify Your Account - Job Finder",
            text: `Welcome to Job Finder! Your verification OTP is: ${otp}. It will expire in 10 minutes.`
        };

        await transporter.sendMail(mailOptions);

        res.json({ message:"User created successfully. Please check your email for the OTP." })
            
    }catch(err){
        res.status(500).json({ message:"failed to create user", error:err })
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
                res.status(404).json({ message:"User not found" })
                return
            }
            
            // ✅ NEW: Prevent login if the account is blocked
            if(user.isBlocked){
                res.status(403).json({ message:"Your account has been blocked. Please contact support." })
                return
            }

            // --- NEW: Prevent login if email is not verified ---
            if(!user.isVerified){
                res.status(403).json({ message:"Please verify your email address before logging in." })
                return
            }

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
                res.status(401).json({ message:"invalid password" })
            }
    })
}


// ==========================================
// NEW CONTROLLER: Verify Email OTP
// ==========================================
export async function verifyEmail(req, res) {
    const { email, otp } = req.body;
  
    try {
      const user = await User.findOne({ email });
      if (!user) return res.status(404).json({ message: "User not found" });
  
      if (user.otp !== otp) {
        return res.status(400).json({ message: "Invalid OTP" });
      }
      if (user.otpExpires < Date.now()) {
        return res.status(400).json({ message: "OTP has expired. Please register again or request a new one." });
      }
  
      user.isVerified = true;
      user.otp = null;
      user.otpExpires = null;
      await user.save();
  
      res.status(200).json({ message: "Email verified successfully" });
    } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
    }
}

// ==========================================
// NEW CONTROLLER: Request Password Reset
// ==========================================
export async function forgotPassword(req, res) {
    const { email } = req.body;
  
    try {
      const user = await User.findOne({ email });
      if (!user) return res.status(404).json({ message: "User not found" });
  
      const otp = generateOTP();
      user.otp = otp;
      user.otpExpires = Date.now() + 10 * 60 * 1000; // 10 mins
      await user.save();
  
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER, 
            pass: process.env.EMAIL_PASS 
        }
      });
  
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: "Password Reset OTP - Job Finder",
        text: `Your OTP for password reset is: ${otp}. It is valid for 10 minutes.`
      };
  
      await transporter.sendMail(mailOptions);
  
      res.status(200).json({ message: "OTP sent to email successfully" });
    } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
    }
}

// ==========================================
// NEW CONTROLLER: Verify OTP & Change Password
// ==========================================
export async function resetPassword(req, res) {
    const { email, otp, newPassword } = req.body;
  
    try {
      const user = await User.findOne({ email });
      if (!user) return res.status(404).json({ message: "User not found" });
  
      if (user.otp !== otp) {
        return res.status(400).json({ message: "Invalid OTP" });
      }
      if (user.otpExpires < Date.now()) {
        return res.status(400).json({ message: "OTP has expired. Please request a new one." });
      }
  
      const hashedPassword = bcrypt.hashSync(newPassword, 10);
  
      user.password = hashedPassword;
      user.otp = null;
      user.otpExpires = null;
      await user.save();
  
      res.status(200).json({ message: "Password reset successfully" });
    } catch (error) {
      res.status(500).json({ message: "Server error", error: error.message });
    }
}

export async function updateUser(req, res) {
    try {
        const userName = req.params.userName;

        // ✅ Only admin can change roles
        if (req.body.role === "admin" || req.body.role === "madam") {
            if (!req.user || req.user.role !== "admin") {
                return res.status(403).json({
                    message: "Only admin can change roles"
                });
            }
        }

        // ✅ Admin can update any user
        if (req.user.role === "admin") {
            await User.updateOne(
                { userName: userName },
                { $set: req.body } 
            );
            return res.json({
                message: "User updated successfully"
            });
        }  

       
        if (req.user.userName !== userName) {
            return res.status(403).json({
                message: "You can only update your own profile"
            });
        }

        const { age, gender, birthday, img } = req.body;
        const updatingData = { age, gender, birthday, img };

        await User.updateOne(
            { userName: userName },
            { $set: updatingData }
        );

        res.json({
            message: "Details updated successfully"
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
            message: "Internal server error",
            error: err
        });
    }
}
export function isAdmin(req){
    if (req.user == null){
        return false
    }

    if (req.user.role != "admin"){
        return false
 
    }

    return true

}

export async function getUser(req,res){
    const userName=req.params.userName
    try{
      
        if(!req.user){
            return res.status(401).json({
                message:"Unauthorized"
            })
        }
  
        const user=await User.findOne({userName:userName})

        if(user==null){
            res.status(404).json({
                message:"user not found"
            })
            return
        }
        
        if (req.user.userName === userName) {
            return res.json(user);
        }

        if(user.isBlocked === false && user.role !== "admin" && user.role !== "madam"){
            res.json(user)
        }
        else{
            if(!isAdmin(req)){
                res.status(404).json({
                    message:"user not found"
                })
            }else{
                res.json(user)
            }
        }

    }catch(err){
        res.status(500).json({
            message:"internal error",
            error:err
        })
    }
}

export async function getAllUsers(req,res) {
    try{
        if(isAdmin(req)){
            const user=await User.find()
            res.json(user)
        }else{
            res.status(403).json({
                message:"not authorized"
            })
        }
    }catch(error){
   
        res.json({
            message:"failed to get Users",
            error:error
        })
    }
}

export async function toggleBlockUser(req, res) {
    if (!req.user || req.user.role !== "admin") {
        return res.status(403).json({ message: "Unauthorized: Admins Only" });
    }

    try {
        const user = await User.findOne({ userName: req.params.userName });
        if (!user) return res.status(404).json({ message: "User not found" });

        user.isBlocked = !user.isBlocked;
        await user.save();

        res.json({ 
            message: `User ${user.isBlocked ? 'blocked' : 'unblocked'} successfully`,
            isBlocked: user.isBlocked 
        });
    } catch (error) {
        res.status(500).json({ message: "Toggle block status failed" });
    }
}



// 1. Email යවන සහ Save කරන Function එක
export async function sendGroupEmail(req, res) {
    const { emails, subject, message } = req.body; 

    if (!emails || emails.length === 0) {
        return res.status(400).json({ message: "No email addresses provided" });
    }

    try {
        // --- Nodemailer Setup ---
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER, 
                pass: process.env.EMAIL_PASS 
            }
        });

        const mailOptions = {
            from: process.env.EMAIL_USER,
            bcc: emails.join(','),
            subject: subject,
            text: message
        };

        // Email එක යැවීම
        await transporter.sendMail(mailOptions);
        
        // --- Database එකේ Save කිරීම ---
        // Email එක සාර්ථකව ගියොත් පමණක් DB එකට දත්ත ඇතුලත් වේ
        const newMessage = new Message({
            recipients: emails,
            subject: subject,
            message: message
        });
        await newMessage.save();

        res.json({ message: "Emails sent and history saved successfully!" });

    } catch (error) {
        console.error("Operation failed:", error);
        res.status(500).json({ message: "Failed to process request", error: error.message });
    }
}


export async function getSentMessages(req, res) {
    try {
    
        const history = await Message.find().sort({ date: -1 });
        res.status(200).json(history);
    } catch (error) {
        res.status(500).json({ message: "Error fetching message history", error: error.message });
    }
}

// 
export async function getMessagesByEmail(req, res) {
    const { email } = req.params; 

    try {
      
        const history = await Message.find({ recipients: email }).sort({ date: -1 });
        res.status(200).json(history);
    } catch (error) {
        res.status(500).json({ message: "Error fetching user history", error: error.message });
    }
}

export function googleAuthCallback(req, res) {
    // req.user contains the user data from Passport
    const user = req.user;

    // Prevent login if blocked
    if (user.isBlocked) {
        return res.redirect(`${process.env.FRONTEND_URL}/?error=blocked`);
    }

    // Generate JWT token
    const token = jwt.sign({
        email: user.email,
        userName: user.userName,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        img: user.img
    }, process.env.JWT_KEY);

    // Redirect back to frontend with the token and user type
    res.redirect(`${process.env.FRONTEND_URL}/?token=${token}&type=${user.role}`);
}