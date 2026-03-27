import JobVacancy from "../models/jobVacancyModel.js";
import { isAdmin } from "./userController.js"


export async function createJob(req, res) {
    try {
        // Find the job with the highest jobId string
        const lastJob = await JobVacancy
            .findOne()
            .sort({ jobId: -1 })
            .select('jobId'); 

        // Start at 0 if the database is empty
        let nextJobId = "JOB00000";

        if (lastJob && lastJob.jobId) {
            // Extract the number and increment it
            const lastNumber = parseInt(lastJob.jobId.replace("JOB", ""), 10);
            if (!isNaN(lastNumber)) {
                nextJobId = `JOB${String(lastNumber + 1).padStart(5, "0")}`;
            }
        }

        const jobVacancy = new JobVacancy({
            jobId: nextJobId,
            jobRole: req.body.jobRole,
            location: req.body.location,
            faculty: req.body.faculty,
            department: req.body.department,
            jobDescription: req.body.jobDescription,
            jobResponsibilities: req.body.jobResponsibilities,
            postDate: req.body.postDate || new Date(),
            deadline: req.body.deadline,
            jobType: req.body.jobType,
            salary: req.body.salary
        });

        const savedJob = await jobVacancy.save();

        res.status(201).json({ 
            message: "Job Vacancy Created Successfully",
            data: savedJob 
        });

    } catch (err) {
        console.error("Database Save Error:", err);

        if (err.code === 11000) {
            return res.status(400).json({
                message: "Duplicate Error: A job with this ID already exists."
            });
        }

        res.status(500).json({
            message: "Internal Server Error",
            error: err.message 
        });
    }
}
export async function getAllJobs(req, res) {


    try{
        const jobVacancy=await JobVacancy.find();
        res.status(200).json(jobVacancy);
    }
    catch(err){
        res.status(500).send({ message: "Error Fetching Job Vacancies", error: err });
    }
}

export async function getJob(req,res) {

    const jobId=req.params.id;

    try{
        const jobVacancy=await JobVacancy.findOne({jobId:jobId});

        if(jobVacancy){
            res.status(200).json(jobVacancy);
        } else {
            res.status(404).send({ message: "Job Vacancy Not Found" });
        }
    }
    catch(err){
        res.status(500).send({ message: "Error Fetching Job Vacancy", error: err });
    }
}

export async function updateJob(req,res){

    // if (!req.user) {
    //     return res.status(403).json({
    //         message: "Please log in and try again"
    //     });
    // }

    // if(!isAdmin(req)){
    //     res.status(403).json({
    //         message:"You are not authorized to create job vacancies"
    //     })
    //     return
    // }

    const jobId=req.params.id;
    const updatingData=req.body;

    try{
        await JobVacancy.updateOne(
            {jobId:jobId},
            updatingData
        )
        res.status(200).send({ message: "Job Vacancy Updated Successfully" });
    }
    catch(err){
        res.status(500).send({ message: "Failed to Update Job Vacancy", error: err });
    }
}

export async function activeBtn(req,res){

    // if (!req.user) {
    //     return res.status(403).json({
    //         message: "Please log in and try again"
    //     });
    // }

    // if(!isAdmin(req)){
    //     res.status(403).json({
    //         message:"You are not authorized to create job vacancies"
    //     })
    //     return
    // }

    const jobId=req.params.id;

    const isAvailable=req.body.isAvailable;

    try{
        const jobVacancy=await JobVacancy.findOne(
            {
                jobId:jobId
            }
        )
        if(!jobVacancy){
            return res.status(404).send({ message: "Job Vacancy Not Found" });
        }

        await JobVacancy.updateOne(
            {jobId:jobId},
            { $set: { isAvailable: isAvailable } }
        )
        res.status(200).send({ message: "Job Vacancy Status Updated Successfully" });
    }
    catch(err){
        res.status(500).send({ message: "Failed to Update Job Vacancy Status", error: err });
    }
}