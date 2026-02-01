import express from 'express';
import { createJob , getAllJobs, getJob , updateJob , activeBtn } from '../controllers/jobVacancyController.js';

const jobVacancyRouter = express.Router();

jobVacancyRouter.post('/', createJob);
jobVacancyRouter.get('/', getAllJobs);
jobVacancyRouter.get('/:id', getJob);
jobVacancyRouter.put('/:id', updateJob);
jobVacancyRouter.patch('/:id', activeBtn);


export default jobVacancyRouter;