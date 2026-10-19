import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema({
  userName: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin', 'superadmin'], required: true },
  action: { type: String, required: true },
  target: { type: String, default: '' },
  method: { type: String, required: true },
  status: { type: Number, required: true },
  occurredAt: { type: Date, default: Date.now, required: true },
});
activityLogSchema.index({ occurredAt: -1, _id: -1 });
activityLogSchema.index({ userName: 1, occurredAt: -1 });
export default mongoose.model('ActivityLog', activityLogSchema);
