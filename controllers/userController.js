import User from "../models/user.js"
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken";
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import Message from "../models/message.js";
import { Resend } from 'resend';

dotenv.config()

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS // ⚠️ මෙතනට අනිවාර්යයෙන්ම App Password එක දෙන්න
    }
});

// Helper function to generate a 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

export async function createUser(req, res) {
    console.log("Registration request received for:", req.body.email);

    try {
        const findName = await User.findOne({ userName: req.body.userName });
        const findEmail = await User.findOne({ email: req.body.email });

        // 🛑 Check if user already exists
        if (findName) {
            console.log("❌ 403: Username exists");
            return res.status(403).json({ message: "UserName already exists" });
        }
        if (findEmail) {
            console.log("❌ 403: Email exists");
            return res.status(403).json({ message: "Email already exists" });
        }

        // 🛑 Role Security Check
        const requestedRole = req.body.role || "user";
        if (requestedRole === "admin" || requestedRole === "madam") {
            // මේ වගේ role එකක් හදන්න පුළුවන් දැනටමත් ලොග් වෙලා ඉන්න Admin කෙනෙකුට විතරයි
            if (!req.user || req.user.role !== "admin") {
                console.log("❌ 403: Unauthorized role creation attempt");
                return res.status(403).json({ message: "Only admin can create privileged roles" });
            }
        }

        const hashedPassword = bcrypt.hashSync(req.body.password, 10);
        const otp = generateOTP();
        const otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

        const user = new User({
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            userName: req.body.userName,
            email: req.body.email,
            password: hashedPassword,
            role: requestedRole,
            otp: otp,
            otpExpires: otpExpires
        });

        await user.save();
        console.log("✅ User saved to DB. Sending OTP email...");

        // Send OTP Email
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: req.body.email,
            subject: 'Verify Your Account - Job Finder',
            html: `<h3>Welcome to Job Finder!</h3>
                   <p>Your verification OTP is: <strong>${otp}</strong></p>
                   <p>This code will expire in 10 minutes.</p>`
        };

        await transporter.sendMail(mailOptions);
        res.json({ message: "User created successfully. Please check your email for the OTP." });

    } catch (err) {
        console.error("❌ REGISTRATION ERROR:", err);
        res.status(500).json({ message: "Registration failed", error: err.message });
    }
}

export function loginUser(req, res) {
    const { email, password, userName } = req.body;

    User.findOne({
        $or: [{ email: email }, { userName: userName }]
    }).then((user) => {
        if (!user) return res.status(404).json({ message: "User not found" });
        if (user.isBlocked) return res.status(403).json({ message: "Account blocked." });
        if (!user.isVerified) return res.status(403).json({ message: "Please verify your email." });

        const isPasswordCorrect = bcrypt.compareSync(password, user.password);
        
        if (isPasswordCorrect) {
            const token = jwt.sign(
                {
                    email: user.email,
                    userName: user.userName,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    role: user.role,
                    img: user.img
                },
                process.env.JWT_KEY,
                { expiresIn: '1d' } 
            );
            
            res.json({ message: "login successfully", token, type: user.role });
        } else {
            res.status(401).json({ message: "invalid password" });
        }
    }).catch((error) => {
        res.status(500).json({ message: "Internal server error" });
    });
}

export async function verifyEmail(req, res) {
    const { email, otp } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });
        if (user.otp !== otp) return res.status(400).json({ message: "Invalid OTP" });
        if (user.otpExpires < Date.now()) return res.status(400).json({ message: "OTP has expired." });

        user.isVerified = true;
        user.otp = null;
        user.otpExpires = null;
        await user.save();
        res.status(200).json({ message: "Email verified successfully" });
    } catch (error) {
        res.status(500).json({ message: "Server error", error: error.message });
    }
}

export async function forgotPassword(req, res) {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });

        const otp = generateOTP();
        user.otp = otp;
        user.otpExpires = Date.now() + 10 * 60 * 1000;
        await user.save();

        // ✅ Gmail හරහා Password Reset OTP යැවීම
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: user.email,
            subject: 'Password Reset OTP - Job Finder',
            html: `<p>Your OTP for password reset is: <strong>${otp}</strong>. Valid for 10 minutes.</p>`
        };

        await transporter.sendMail(mailOptions);
        res.status(200).json({ message: "OTP sent to email successfully" });
    } catch (error) {
        console.error("❌ NODEMAILER ERROR (Forgot Pw):", error);
        res.status(500).json({ message: "Failed to send reset OTP", error: error.message });
    }
}

export async function resetPassword(req, res) {
    const { email, otp, newPassword } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });
        if (user.otp !== otp) return res.status(400).json({ message: "Invalid OTP" });
        if (user.otpExpires < Date.now()) return res.status(400).json({ message: "OTP expired." });

        user.password = bcrypt.hashSync(newPassword, 10);
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



export async function sendGroupEmail(req, res) {
    const { emails, subject, message } = req.body; 
    if (!emails || emails.length === 0) return res.status(400).json({ message: "No emails" });

    try {
        // ✅ Gmail හරහා Group Email යැවීම
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: emails.join(','), // Nodemailer accepts comma separated strings
            subject: subject,
            text: message
        };

        await transporter.sendMail(mailOptions);
        
        const newMessage = new Message({ recipients: emails, subject, message });
        await newMessage.save();

        res.json({ message: "Group emails sent successfully!" });
    } catch (error) {
        console.error("❌ GROUP EMAIL FAILED:", error);
        res.status(500).json({ message: "Failed to send group emails", error: error.message });
    }
}

export async function getSentMessages(req, res) {
    try {
        const history = await Message.find().sort({ date: -1 });
        res.status(200).json(history);
    } catch (error) {
        res.status(500).json({ message: "Error", error: error.message });
    }
}

export async function getMessagesByEmail(req, res) {
    const { email } = req.params; 
    try {
        const history = await Message.find({ recipients: email }).sort({ date: -1 });
        res.status(200).json(history);
    } catch (error) {
        res.status(500).json({ message: "Error", error: error.message });
    }
}

export function googleAuthCallback(req, res) {
    const user = req.user;
    if (user.isBlocked) return res.redirect(`${process.env.FRONTEND_URL}/?error=blocked`);

    const token = jwt.sign({
        email: user.email,
        userName: user.userName,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        img: user.img
    }, process.env.JWT_KEY, { expiresIn: '1d' });  

    res.redirect(`${process.env.FRONTEND_URL}/?token=${token}&type=${user.role}`);
}