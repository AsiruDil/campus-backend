
import mongoose from "mongoose";

const applySchema = mongoose.Schema({

    jobId: {
        type: String,
        required: true,
    },
     jobRole: {
        type: String,
        required: true,
    },


    userName: {
        type: String
    },
    firstName: {
        type: String,
        required: true,
    },
    lastName: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
        
    },
    date: {
        type: Date,
        default: Date.now

    },
    isAvailable: {
        type: Boolean,
        default: true
    },
    mobileNumber: {
        type: String,
        required: true
    },
    cv: {
        type: String,
        required: true
    }
  
})

const Apply = mongoose.model("applies", applySchema);

export default Apply;