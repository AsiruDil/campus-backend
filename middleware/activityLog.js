import ActivityLog from '../models/activityLog.js';

// Route templates keep secrets and arbitrary query/body contents out of the log.
const actions = {
  'POST /api/users/login': 'Signed in',
  'GET /api/users/auth/google/callback': 'Signed in with Google',
  'POST /api/users/': 'Requested account registration',
  'POST /api/users/verify-email': 'Verified email',
  'POST /api/users/reset-password': 'Reset password',
  'POST /api/users/profile-photo': 'Uploaded profile photo',
  'POST /api/users/send-email': 'Sent group email',
  'PUT /api/users/toggle-block/:userName': 'Changed account block status',
  'PUT /api/users/:userName': 'Updated user profile or permissions',
  'GET /api/users/': 'Viewed users',
  'POST /api/jobs/': 'Created vacancy',
  'PUT /api/jobs/:id': 'Updated vacancy',
  'PATCH /api/jobs/:id': 'Changed vacancy availability',
  'GET /api/jobs/': 'Viewed vacancies',
  'GET /api/jobs/:id': 'Viewed vacancy',
  'GET /api/apply/': 'Viewed applications',
  'POST /api/apply/': 'Submitted application',
  'PATCH /api/apply/:id/status': 'Reviewed application',
  'POST /api/apply/email': 'Emailed applicants',
  'GET /api/apply/:id/documents': 'Downloaded application documents',
  'GET /api/apply/:id/cv': 'Downloaded CV',
  'GET /api/apply/retention': 'Viewed document retention',
  'DELETE /api/apply/retention': 'Deleted expired documents',
};

export function activityLogger(req, res, next) {
  res.once('finish', () => {
    const actor = req.auditActor || req.user;
    const prefix = req.originalUrl.split('?')[0].split('/').slice(0, 3).join('/');
    const action = actions[`${req.method} ${prefix}${req.route?.path}`];
    // Only successful actions by identified accounts are recorded.
    if (!action || !actor?.userName || !actor.role || res.statusCode >= 400) return;
    ActivityLog.create({
      userName: actor.userName, role: actor.role, action,
      target: String(req.params.userName || req.params.id || ''),
      method: req.method, status: res.statusCode,
    }).catch(() => console.error('Activity log could not be saved.'));
  });
  next();
}
