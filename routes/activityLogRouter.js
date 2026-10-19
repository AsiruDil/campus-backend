import express from 'express';
import ActivityLog from '../models/activityLog.js';
import { requireRoles, ROLES } from '../middleware/access.js';

const router = express.Router();
router.get('/', requireRoles('superadmin'), async (req, res) => {
  const page = Number(req.query.page || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return res.status(400).json({ message: 'Invalid page.' });
  const filter = {};
  if (req.query.role) {
    if (!ROLES.includes(req.query.role)) return res.status(400).json({ message: 'Invalid role.' });
    filter.role = req.query.role;
  }
  if (req.query.userName) {
    if (typeof req.query.userName !== 'string' || req.query.userName.length > 200) return res.status(400).json({ message: 'Invalid username.' });
    filter.userName = req.query.userName;
  }
  const limit = 25;
  const [items, total] = await Promise.all([
    ActivityLog.find(filter).sort({ occurredAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ActivityLog.countDocuments(filter),
  ]);
  res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});
export default router;
