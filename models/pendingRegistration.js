import mongoose from "mongoose";
import User from "./user.js";

// These records cannot log in and never appear in the users collection.
const pendingSchema = User.schema.clone();
pendingSchema.index({ otpExpires: 1 }, { expireAfterSeconds: 0 });
export default mongoose.model("pendingRegistrations", pendingSchema);
