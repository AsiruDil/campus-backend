import User from "../models/user.js"
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken";
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import Message from "../models/message.js";

dotenv.config()

// Helper function to generate a 6-digit OTP
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// ✅ Render/Cloud servers සඳහා වඩාත් ගැලපෙන Transporter එක
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // 587 සඳහා මෙය false විය යුතුයි
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS 
    },
    tls: {
        rejectUnauthorized: false // Cloud server එකේ ආරක්ෂක බාධක මගහැරීමට
    }
});
export async function createUser(req, res) {
    // Admin checks
    if (req.body.role === "admin" || req.body.role === "madam") {
        if (!req.user || req.user.role !== "admin") {
            return res.status(403).json({ message: "Only admin can create privileged roles" });
        }
    }

    try {
        const findName = await User.findOne({ userName: req.body.userName });
        const findEmail = await User.findOne({ email: req.body.email });

        if (findName) return res.status(403).json({ message: "UserName already exists" });
        if (findEmail) return res.status(403).json({ message: "Email already exists" });

        const hashedPassword = bcrypt.hashSync(req.body.password, 10);
        const otp = generateOTP();
        const otpExpires = Date.now() + 10 * 60 * 1000;

        const user = new User({
            email: req.body.email,
            userName: req.body.userName,
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            password: hashedPassword,
            role: req.body.role || "user",
            otp: otp,
            otpExpires: otpExpires
        });
 
        await user.save();

        // ✅ 2. Email එක යැවීමේ කොටස
        const mailOptions = {
            from: `"Job Finder" <${process.env.EMAIL_USER}>`,
            to: req.body.email,
            subject: "Verify Your Account - Job Finder",
            text: `Welcome to Job Finder! Your verification OTP is: ${otp}. It will expire in 10 minutes.`
        };

        try {
            await transporter.sendMail(mailOptions);
            console.log("✅ Registration OTP sent successfully to:", req.body.email);
            res.json({ message: "User created successfully. Please check your email for the OTP." });
        } catch (emailErr) {
            console.error("❌ NODEMAILER ERROR (Registration):", emailErr);
            // User සේව් වුණත් email එක අසාර්ථක වුවහොත් පණිවිඩය වෙනස් කරයි
            res.status(500).json({ message: "User created, but failed to send OTP email.", error: emailErr.message });
        }

    } catch (err) {
        console.error("❌ CRITICAL REGISTRATION ERROR:", err);
        res.status(500).json({ message: "Registration failed", error: err.message });
    }
}

export function loginUser(req, res) {
    const email = req.body.email;
    const password = req.body.password;
    const userName = req.body.userName;

    User.findOne({
        $or: [
            { email: email },
            { userName: userName }
        ]
    }).then((user) => {
        if (user == null) {
            return res.status(404).json({ message: "User not found" });
        }
        
        if (user.isBlocked) {
            return res.status(403).json({ message: "Your account has been blocked. Please contact support." });
        }

        if (!user.isVerified) {
            return res.status(403).json({ message: "Please verify your email address before logging in." });
        }

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
                process.env.JWT_KEY, // ✅ Ensure this matches your ENV
                { expiresIn: '1d' } 
            );
            
            res.json({
                message: "login successfully",
                token: token,
                type: user.role
            });
        } else {
            res.status(401).json({ message: "invalid password" });
        }
    }).catch((error) => {
        console.error("Login Error:", error);
        res.status(500).json({ message: "Internal server error" });
    });
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
        return res.status(400).json({ message: "OTP has expired." });
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
      user.otpExpires = Date.now() + 10 * 60 * 1000;
      await user.save();
  
      const mailOptions = {
        from: `"Job Finder" <${process.env.EMAIL_USER}>`,
        to: user.email,
        subject: "Password Reset OTP - Job Finder",
        text: `Your OTP for password reset is: ${otp}. It is valid for 10 minutes.`
      };
  
      await transporter.sendMail(mailOptions);
      console.log("✅ Forgot Password OTP sent to:", user.email);
      res.status(200).json({ message: "OTP sent to email successfully" });
    } catch (error) {
      console.error("❌ NODEMAILER ERROR (Forgot Password):", error);
      res.status(500).json({ message: "Failed to send reset OTP", error: error.message });
    }
}

export async function resetPassword(req, res) {
    const { email, otp, newPassword } = req.body;
  
    try {
      const user = await User.findOne({ email });
      if (!user) return res.status(404).json({ message: "User not found" });
  
      if (user.otp !== otp) return res.status(400).json({ message: "Invalid OTP" });
      if (user.otpExpires < Date.now()) return res.status(400).json({ message: "OTP has expired." });
  
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

    if (!emails || emails.length === 0) {
        return res.status(400).json({ message: "No email addresses provided" });
    }

    try {
        const mailOptions = {
            from: `"Job Finder Admin" <${process.env.EMAIL_USER}>`,
            bcc: emails.join(','),
            subject: subject,
            text: message
        };

        await transporter.sendMail(mailOptions);
        
        const newMessage = new Message({
            recipients: emails,
            subject: subject,
            message: message
        });
        await newMessage.save();

        res.json({ message: "Emails sent and history saved successfully!" });

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
    const user = req.user;

    if (user.isBlocked) {
        return res.redirect(`${process.env.FRONTEND_URL}/?error=blocked`);
    }

    const token = jwt.sign({
        email: user.email,
        userName: user.userName,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        img: user.img
    }, process.env.JWT_KEY,
    { expiresIn: '1d' }
    );  

    res.redirect(`${process.env.FRONTEND_URL}/?token=${token}&type=${user.role}`);
}