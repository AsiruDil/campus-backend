import express from "express";
import { getApplies, saveApply } from "../controllers/applyConroller.js";


const applyRouter = express.Router();

applyRouter.get("/",getApplies);
applyRouter.post("/",saveApply);


export default applyRouter;