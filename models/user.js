import mongoose from "mongoose";

const userSchema = mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
    },
    userName: {
        type: String,
        unique: true,
        required: true,
    },
    firstName: {
        type: String,
        required: true,
    },
    lastName: {
        type: String,
        required: true,
    },
    password: {
        type: String,
        required: true,
    },
    id: {
        type: String,
        required: false,
    },
    age: {
        type: Number,
        required: false,
    },
    gender: {
        type: String,
        required: false,
    },
    birthday: {
        type: String,
        required: false,
    },
    authVersion: { type: Number, default: 0 },
    roleVersion: { type: Number, default: 2 },
    faculty: { type: String, trim: true },
    department: { type: String, trim: true },
    role: {
        type: String,
        required: true,
        default: "user"
    },
    isBlocked: {
        type: Boolean,
        required: true,
        default: false
    },
    img: {
        type: String,
        required: false,
        default: "/profile.png"
    },
    date: {
        type: Date,
        default: Date.now
    },

    isVerified: {
        type: Boolean,
        default: false
    },
    otp: {
        type: String,
        required: false,
        default: null
    },
    otpExpires: {
        type: Date,
        required: false,
        default: null
    }
});

const User = mongoose.model("users", userSchema);
export default User;
