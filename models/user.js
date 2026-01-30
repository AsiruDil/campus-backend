import mongoose from "mongoose";

const userSchema  =mongoose.Schema({
    email:{
        type:String,
        required:true,
        unique:true,
    },
     userName:{
        type:String,
        unique:true,
        required:true,
    },
    firstName:{
        type:String,
        required:true,
    },
    lastName:{
        type:String,
        required:true,
    },

    password:{
        type:String,
        required:true,
    },
   
    id:{
        type:String,
        required:false,

    },
    age:{
        type:Number,
        required:false,
    },
    gender:{
        type:String,
        required:false,
    },
    birthday:{
        type:String,
        required:false,
    },
    role:{
        type:String,
        required:true,
        default:"user"
    },
    isBlocked:{
        type:Boolean,
        required:true,
        default:false
    },
    img:{
        type:String,
        required:false,
        default:"https://avatar.iran.liara.run/public/boy?username=Ash"
    },
    date:{
        type:Date,
        default:Date.now
    }


}) 

const User=mongoose.model("users",userSchema)
export default User;