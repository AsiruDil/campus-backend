import mongoose from "mongoose";

const jobVacancySchema = new mongoose.Schema(
    {
        jobId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        jobRole: {
            type: String,
            required: true
        },
        location: {
            type: String,
            required: true
        },
        faculty: {
            type: String,
            required: true
        },
        department: {
            type: String,
            required: true
        },

        jobDescription: String,

        jobResponsibilities: String,

        jobQualifications: String,

        postDate: {
            type: Date,
            default: Date.now
        },
        deadline: {
            type: Date,
            required: true,
            validate: {
                validator: function (value) {
                    return !value || value > this.postDate;
                },
                message: "Deadline must be after post date"
            }
        }
        ,
        jobType: {
            type: String,
            enum: ["Full-time", "Part-time", "Temporary"],
            required: false
        },
        salary: {
            type: Number,
            required: false
        },
        isAvailable: {
            type: Boolean,
            required: false,
            default: true
        }        
    },
    {
        timestamps: true

    }
)

const JobVacancy = mongoose.model("JobVacancy", jobVacancySchema);

export default JobVacancy;