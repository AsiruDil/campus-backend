import Apply from "../models/apply.js";
import JobVacancy from "../models/jobVacancyModel.js";


// export function checkUser(req,res){
//     if(req.user == null){
//         return res.status(401).json({
//             message : "You are not logged in",
//             success : false
//         })
//     }
//     if(req.user != null){
//         return res.status(200).json({
//             message : "You are logged in",
//             success : true,
//             user : {
//                 firstName : req.user.firstName,
//                 lastName : req.user.lastName,
//                 email : req.user.email
//             }

//         })
//     }
// }

export async function saveApply(req, res) {
    if (!req.user ||req.user.isBlocked === true) {
        return res.status(401).json({
            message: "Unauthorized",
            success: false
        });
    }
    
    const jobnew= await JobVacancy.findOne({jobId:req.body.jobId})
   
    const user=req.user;
    const apply = new Apply({
        jobId: req.body.jobId,
        jobRole:jobnew.jobRole,
        userName: user.userName,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        cv: req.body.cv,
        mobileNumber: req.body.mobileNumber
    });
    apply.save()
        .then(() => {
            res.status(201).json({
                message: "Application saved successfully",
                success: true
            });  
        }) 
        .catch((error) => {
            res.status(500).json({
                message: "Failed to save application",
                success: false,
                error
            });
        });


}

export async function getApplies(req, res) {

    try {
        if (req.user.role == "admin") {
            const applies = await Apply.find()
            res.json(applies)
        }
        else if(req.user.role == "madam") {
            const applies = await Apply.find({isAvailable : true})
            res.json(applies)
        }
        else{
          
            res.status(403).json({
                message:"You are not authorized to get applies"
            })
        }


    } catch (err) {
        res.json({
            message: "Failed to get applies",
            error: err
        })
    }
}