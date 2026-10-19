
import mongoose from "mongoose";

const applySchema = mongoose.Schema({

    nic: { type: String }, // Optional on historical records; required by submission validation.
    category: { type: String, trim: true, maxlength: 150 },
    faculty: String,
    department: String,
    status: { type: String, enum: ['pending', 'shortlisted', 'selected', 'rejected', 'hold'], default: 'pending' },
    archiveKey: String,
    cvSize: Number,
    supportingDocuments: [{ name: String, size: Number, archiveName: String }],
    reviewedBy: String,
    reviewedAt: Date,
    reviewHistory: [{ status: String, by: String, date: Date }],
    lastNotifiedAt: Date,
    documentsDeletedAt: Date,
    documentsDeletedBy: String,
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
    cv: { type: String }

})

const Apply = mongoose.model("applies", applySchema);

export default Apply;
