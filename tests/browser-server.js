import { mockPhotoStorage } from './mock-photo-storage.js';
// Isolated browser-test fixture. Never connect this fixture to a production database.
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcrypt";
import User from "../models/user.js";
import Job from "../models/jobVacancyModel.js";
import Apply from "../models/apply.js";
import { createArchive } from "../services/documents.js";
import { mailDelivery } from "../services/mail.js";

process.env.CORS_ORIGINS = "http://127.0.0.1:5174";
mockPhotoStorage();
process.env.JWT_KEY = "browser-test-only-key";
const { default: app } = await import("../app.js");
process.env.RESEND_FROM = "testing@example.test";
process.env.RESEND_API_KEY = "test-mail-transport";
const directory = await mkdtemp(path.join(os.tmpdir(), "campus-browser-"));
process.env.UPLOAD_DIR = directory;
let mongo;
if (process.env.MONGODB_TEST_URL)
  await mongoose.connect(process.env.MONGODB_TEST_URL, {
    dbName: `campus_browser_${Date.now()}`,
  });
else {
  mongo = await MongoMemoryServer.create({ binary: { version: "8.0.12" } });
  await mongoose.connect(mongo.getUri());
}
mailDelivery.sendMail = async (options) => ({
  accepted: options.bcc,
  rejected: [],
});
for (const role of ["user", "admin", "superadmin"])
  await User.create({
    id: "200012345678", age: 26, gender: "Male", birthday: "2000-05-02",
    userName: role,
    firstName: role === "user" ? "Nimali" : role,
    lastName: "Test",
    email: `${role}@example.test`,
    password: bcrypt.hashSync("BrowserTest!234", 4),
    role,
    isVerified: true,
    faculty: role === "admin" ? "Science" : undefined,
    department: role === "admin" ? "Computing" : undefined,
    img: "/profile.png",
  });
await Job.create({
  jobId: "JOB00001",
  jobRole: "Lecturer in Computing",
  category: "lecturer",
  faculty: "Science",
  department: "Computing",
  location: "Main Campus",
  deadline: new Date(Date.now() + 7 * 86400000),
  jobType: "Full-time",
});
const buffer = Buffer.from("%PDF-1.4\nTest fixture\n%%EOF");
const archive = await createArchive({
  cv: [{ originalname: "resume.pdf", size: buffer.length, buffer }],
});
const old = new Apply({
  ...archive,
  jobId: "JOB00001",
  jobRole: "Lecturer in Computing",
  category: "lecturer",
  faculty: "Science",
  department: "Computing",
  userName: "user",
  firstName: "Expired",
  lastName: "Applicant",
  email: "expired@example.test",
  mobileNumber: "0771234567",
  nic: "200012345678",
  date: new Date("2010-01-01"),
});
old.cv = `/api/apply/${old._id}/cv`;
await old.save();
const server = app.listen(3001, "127.0.0.1", () =>
  console.log("Browser fixture ready on port 3001"),
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  await rm(directory, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
