import express from 'express';
import { createJob , getAllJobs, getJob , updateJob , activeBtn } from '../controllers/jobVacancyController.js';

import { requireRoles } from '../middleware/access.js';
const jobVacancyRouter = express.Router();

jobVacancyRouter.post('/', requireRoles('superadmin'), createJob);
jobVacancyRouter.get('/', getAllJobs);
jobVacancyRouter.get('/:id', getJob);
jobVacancyRouter.put('/:id', requireRoles('superadmin'), updateJob);
jobVacancyRouter.patch('/:id', requireRoles('superadmin'), activeBtn);


export default jobVacancyRouter;
