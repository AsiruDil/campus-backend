import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import jwt from "jsonwebtoken";
import JSZip from "jszip";
import app from "../app.js";
import User from "../models/user.js";
import Apply from "../models/apply.js";
import Job from "../models/jobVacancyModel.js";
import Message from "../models/message.js";
import { transporter } from "../services/mail.js";
import { migrateLegacyRoles } from "../services/roleMigration.js";
import { retentionCutoff, CV_LIMIT } from "../services/documents.js";

process.env.JWT_KEY = "test-only-signing-key-not-for-production";
process.env.EMAIL_USER = "sender@example.test";
process.env.EMAIL_PASS = "test-only-mail-transport";
let mongo, temp, primary, outside, originalMail;
const tokens = {};
const cv = Buffer.from("%PDF-1.4\nTest CV\n%%EOF");
function auth(role) {
  return `Bearer ${tokens[role]}`;
}
function submit(jobId = "JOB00001", overrides = {}) {
  const body = {
    jobId,
    mobileNumber: "+94771234567",
    nic: "200012345678",
    category: "lecturer",
    ...overrides,
  };
  let operation = request(app)
    .post("/api/apply")
    .set("Authorization", auth("user"));
  for (const [key, value] of Object.entries(body))
    operation = operation.field(key, value);
  return operation;
}
before(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), "campus-tests-"));
  process.env.UPLOAD_DIR = temp;
  if (process.env.MONGODB_TEST_URL) {
    await mongoose.connect(process.env.MONGODB_TEST_URL, {
      dbName: `campus_test_${Date.now()}`,
    });
  } else {
    mongo = await MongoMemoryServer.create({ binary: { version: "8.0.12" } });
    await mongoose.connect(mongo.getUri());
  }
  for (const role of ["user", "other", "admin", "superadmin", "unassigned"]) {
    const account = await User.create({
      userName: role,
      firstName: role,
      lastName: "Applicant",
      email: `${role}@example.test`,
      password: "not-used",
      role: ["other"].includes(role)
        ? "user"
        : role === "unassigned"
          ? "admin"
          : role,
      faculty: role === "admin" ? "Science" : undefined,
      department: role === "admin" ? "Computing" : undefined,
      isVerified: true,
    });
    tokens[role] = jwt.sign(
      { userName: account.userName, role: account.role },
      process.env.JWT_KEY,
    );
  }
  await Job.create([
    {
      jobId: "JOB00001",
      jobRole: "Lecturer in Computing",
      category: "lecturer",
      faculty: "Science",
      department: "Computing",
      location: "Main Campus",
      deadline: new Date(Date.now() + 86400000),
    },
    {
      jobId: "JOB00002",
      jobRole: "Demonstrator",
      category: "demo",
      faculty: "Arts",
      department: "History",
      location: "Main Campus",
      deadline: new Date(Date.now() + 86400000),
    },
    {
      jobId: "JOB00003",
      jobRole: "Probationary lecturer",
      category: "probationary",
      faculty: "Science",
      department: "Physics",
      location: "Main Campus",
      deadline: new Date(Date.now() + 86400000),
    },
    {
      jobId: "CLOSED",
      jobRole: "Lecturer",
      faculty: "Science",
      department: "Computing",
      location: "Main Campus",
      postDate: new Date("2020-01-01"),
      deadline: new Date("2021-01-01"),
    },
  ]);
  originalMail = transporter.sendMail;
});
after(async () => {
  transporter.sendMail = originalMail;
  if (mongoose.connection.readyState === 1)
    await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  if (temp) await rm(temp, { recursive: true, force: true });
});

test("legacy role migration is correct and idempotent", async () => {
  await User.collection.insertMany([
    { userName: "oldAdmin", email: "oldadmin@example.test", role: "admin" },
    { userName: "oldMadam", email: "oldmadam@example.test", role: "madam" },
  ]);
  await migrateLegacyRoles();
  await migrateLegacyRoles();
  assert.equal(
    (await User.findOne({ userName: "oldAdmin" })).role,
    "superadmin",
  );
  assert.equal((await User.findOne({ userName: "oldMadam" })).role, "admin");
  assert.equal((await User.findOne({ userName: "admin" })).role, "admin");
});
test("authenticated multipart submission creates a ZIP with CV and supporting files", async () => {
  const response = await submit()
    .attach("cv", cv, "resume.pdf")
    .attach("supporting", cv, "certificate.pdf")
    .expect(201);
  primary = await Apply.findById(response.body.id);
  assert.equal(primary.nic, "200012345678");
  assert.equal(primary.status, "pending");
  assert.equal(primary.category, "lecturer");
  assert.equal(primary.faculty, "Science");
  const download = await request(app)
    .get(`/api/apply/${primary.id}/documents`)
    .set("Authorization", auth("admin"))
    .buffer(true)
    .parse((response, done) => {
      const data = [];
      response.on("data", (chunk) => data.push(chunk));
      response.on("end", () => done(null, Buffer.concat(data)));
    })
    .expect(200);
  const zip = await JSZip.loadAsync(download.body);
  assert.deepEqual(await zip.file("CV.pdf").async("nodebuffer"), cv);
  assert.deepEqual(
    await zip.file("supporting/1-certificate.pdf").async("nodebuffer"),
    cv,
  );
});
test("CV limit is enforced on the server; exactly 2 MB is accepted", async () => {
  const large = Buffer.alloc(CV_LIMIT + 1);
  cv.copy(large);
  await submit().attach("cv", large, "large.pdf").expect(400);
  const exact = Buffer.alloc(CV_LIMIT);
  cv.copy(exact);
  await submit().attach("cv", exact, "exact.pdf").expect(201);
});
test("missing or invalid NIC, missing CV, disguised files, and excessive attachments are rejected", async () => {
  for (const nic of ["", "abc"])
    await submit("JOB00001", { nic })
      .attach("cv", cv, "resume.pdf")
      .expect(400);
  await submit().expect(400);
  await submit()
    .attach("cv", Buffer.from("not a PDF"), "resume.pdf")
    .expect(400);
  await submit()
    .attach("cv", cv, "resume.pdf")
    .attach("supporting", Buffer.from("executable"), "certificate.pdf")
    .expect(400);
  let operation = submit().attach("cv", cv, "resume.pdf");
  for (let i = 0; i < 11; i++)
    operation = operation.attach("supporting", cv, `paper${i}.pdf`);
  await operation.expect(400);
});
test("unauthenticated submissions and JSON URL uploads cannot bypass file validation", async () => {
  await request(app).post("/api/apply").send({}).expect(401);
  await request(app)
    .post("/api/apply")
    .set("Authorization", auth("user"))
    .send({
      jobId: "JOB00001",
      nic: "200012345678",
      mobileNumber: "+94771234567",
      category: "lecturer",
      cv: "https://example.test/huge.pdf",
    })
    .expect(400);
});
test("expired, missing and inactive vacancies reject applications without orphaned files", async () => {
  const before = await readdir(temp);
  await submit("CLOSED").attach("cv", cv, "resume.pdf").expect(400);
  await submit("MISSING").attach("cv", cv, "resume.pdf").expect(404);
  await Job.updateOne({ jobId: "JOB00001" }, { $set: { isAvailable: false } });
  await submit().attach("cv", cv, "resume.pdf").expect(400);
  await Job.updateOne({ jobId: "JOB00001" }, { $set: { isAvailable: true } });
  assert.deepEqual(await readdir(temp), before);
});
test("vacancy category overrides user input", async () => {
  const response = await submit("JOB00002", { category: "lecturer" })
    .attach("cv", cv, "resume.pdf")
    .expect(201);
  outside = await Apply.findById(response.body.id);
  assert.equal(outside.category, "demo");
});
test("Admins see only assigned faculty AND department; Super Admin sees all", async () => {
  await submit("JOB00003").attach("cv", cv, "resume.pdf").expect(201);
  const admin = await request(app)
    .get("/api/apply")
    .set("Authorization", auth("admin"))
    .expect(200);
  assert(admin.body.length > 0);
  assert(
    admin.body.every(
      (a) => a.faculty === "Science" && a.department === "Computing",
    ),
  );
  assert(admin.body.every((a) => !("archiveKey" in a)));
  const all = await request(app)
    .get("/api/apply")
    .set("Authorization", auth("superadmin"))
    .expect(200);
  assert(all.body.length > admin.body.length);
  const unassigned = await request(app)
    .get("/api/apply")
    .set("Authorization", auth("unassigned"))
    .expect(200);
  assert.equal(unassigned.body.length, 0);
  await request(app)
    .get("/api/apply")
    .set("Authorization", auth("user"))
    .expect(403);
});
test("historical applications remain pending and respect vacancy scope", async () => {
  const legacy = await Apply.collection.insertOne({
    jobId: "JOB00001",
    jobRole: "Lecturer",
    userName: "user",
    firstName: "Old",
    lastName: "Applicant",
    email: "old@example.test",
    mobileNumber: "0771234567",
    date: new Date(),
    isAvailable: true,
    cv: "https://example.test/old.pdf",
  });
  const response = await request(app)
    .get("/api/apply?status=pending&category=lecturer")
    .set("Authorization", auth("admin"))
    .expect(200);
  assert(
    response.body.some(
      (a) => a._id === legacy.insertedId.toString() && a.status === "pending",
    ),
  );
});
test("Admin can shortlist, approve/select, reject and hold with audit history and filters", async () => {
  for (const status of [
    "shortlisted",
    "selected",
    "rejected",
    "hold",
    "pending",
  ]) {
    const response = await request(app)
      .patch(`/api/apply/${primary.id}/status`)
      .set("Authorization", auth("admin"))
      .send({ status })
      .expect(200);
    assert.equal(response.body.status, status);
    const list = await request(app)
      .get(`/api/apply?status=${status}&category=lecturer`)
      .set("Authorization", auth("admin"))
      .expect(200);
    assert(list.body.some((a) => a._id === primary.id));
  }
  assert.equal((await Apply.findById(primary.id)).reviewHistory.length, 5);
  await request(app)
    .patch(`/api/apply/${outside.id}/status`)
    .set("Authorization", auth("admin"))
    .send({ status: "selected" })
    .expect(409);
  await request(app)
    .patch(`/api/apply/${primary.id}/status`)
    .set("Authorization", auth("user"))
    .send({ status: "selected" })
    .expect(403);
  await request(app)
    .patch(`/api/apply/${primary.id}/status`)
    .set("Authorization", auth("admin"))
    .send({ status: "invalid" })
    .expect(400);
});
test("downloads enforce ownership, reviewer scope, login, and no-store caching", async () => {
  const url = `/api/apply/${primary.id}/cv`;
  await request(app).get(url).expect(401);
  await request(app).get(url).set("Authorization", auth("other")).expect(403);
  const own = await request(app)
    .get(url)
    .set("Authorization", auth("user"))
    .expect(200);
  assert.equal(own.headers["cache-control"], "private, no-store");
  assert.deepEqual(own.body, cv);
  await request(app)
    .get(`/api/apply/${outside.id}/documents`)
    .set("Authorization", auth("admin"))
    .expect(404);
});
test("bulk email deduplicates recipients, uses BCC, and records only accepted recipients", async () => {
  let sent;
  transporter.sendMail = async (options) => {
    sent = options;
    return { accepted: options.bcc, rejected: [] };
  };
  await Apply.updateMany(
    { faculty: "Science", department: "Computing" },
    { $set: { status: "shortlisted" } },
  );
  const second = await Apply.findOne({
    _id: { $ne: primary._id },
    archiveKey: { $exists: true },
    faculty: "Science",
    department: "Computing",
  });
  const response = await request(app)
    .post("/api/apply/email")
    .set("Authorization", auth("admin"))
    .send({
      applicationIds: [primary.id, second.id],
      subject: "Interview",
      message: "Please attend",
      shortlistedOnly: true,
    })
    .expect(200);
  assert.equal(response.body.sent, 1);
  assert.deepEqual(sent.bcc, ["user@example.test"]);
  assert.equal(sent.to, process.env.EMAIL_USER);
  assert.equal(await Message.countDocuments({ subject: "Interview" }), 1);
  assert((await Apply.findById(primary.id)).lastNotifiedAt);
});
test("bulk mail enforces scope, shortlist validation and input limits before contacting SMTP", async () => {
  let called = false;
  transporter.sendMail = async () => {
    called = true;
    return { accepted: [] };
  };
  await request(app)
    .post("/api/apply/email")
    .set("Authorization", auth("admin"))
    .send({ applicationIds: [outside.id], subject: "X", message: "Y" })
    .expect(400);
  await request(app)
    .post("/api/apply/email")
    .set("Authorization", auth("superadmin"))
    .send({
      applicationIds: [outside.id],
      subject: "X",
      message: "Y",
      shortlistedOnly: true,
    })
    .expect(400);
  await request(app)
    .post("/api/apply/email")
    .set("Authorization", auth("user"))
    .send({ applicationIds: [primary.id], subject: "X", message: "Y" })
    .expect(403);
  await request(app)
    .post("/api/apply/email")
    .set("Authorization", auth("admin"))
    .send({
      applicationIds: [primary.id],
      subject: "X\r\nBcc: injection",
      message: "Y",
    })
    .expect(400);
  assert.equal(called, false);
});
test("mail configuration failures and partial rejections are reported accurately", async () => {
  delete process.env.EMAIL_PASS;
  await request(app)
    .post("/api/apply/email")
    .set("Authorization", auth("admin"))
    .send({ applicationIds: [primary.id], subject: "X", message: "Y" })
    .expect(503);
  process.env.EMAIL_PASS = "test-only-mail-transport";
  transporter.sendMail = async () => ({
    accepted: [],
    rejected: ["user@example.test"],
  });
  const response = await request(app)
    .post("/api/apply/email")
    .set("Authorization", auth("admin"))
    .send({ applicationIds: [primary.id], subject: "X", message: "Y" })
    .expect(207);
  assert.equal(response.body.sent, 0);
  assert.equal(response.body.failed, 1);
});
test("only Super Admin can set deadlines; invalid dates fail and extended deadlines reopen applications", async () => {
  await request(app)
    .put("/api/jobs/CLOSED")
    .set("Authorization", auth("admin"))
    .send({ deadline: new Date(Date.now() + 86400000) })
    .expect(403);
  await request(app)
    .put("/api/jobs/CLOSED")
    .set("Authorization", auth("superadmin"))
    .send({ deadline: "2020-01-01" })
    .expect(400);
  await request(app)
    .put("/api/jobs/CLOSED")
    .set("Authorization", auth("superadmin"))
    .send({
      deadline: new Date(Date.now() + 86400000),
      category: "probationary",
    })
    .expect(200);
  await submit("CLOSED").attach("cv", cv, "resume.pdf").expect(201);
  await request(app).post("/api/jobs").send({}).expect(401);
});
test("permission changes and account blocking take effect despite stale tokens", async () => {
  await User.updateOne({ userName: "admin" }, { $set: { isBlocked: true } });
  await request(app)
    .get("/api/apply")
    .set("Authorization", auth("admin"))
    .expect(403);
  await User.updateOne({ userName: "admin" }, { $set: { isBlocked: false } });
  await request(app)
    .put("/api/users/user")
    .set("Authorization", auth("user"))
    .send({ role: "superadmin" })
    .expect(403);
  await request(app)
    .put("/api/users/user")
    .set("Authorization", auth("superadmin"))
    .send({ role: "admin" })
    .expect(400);
  const list = await request(app)
    .get("/api/users")
    .set("Authorization", auth("superadmin"))
    .expect(200);
  assert(list.body.every((user) => !("password" in user) && !("otp" in user)));
});
test("retention deletes only five-year-old files, keeps records and recent documents, and is repeatable", async () => {
  assert.equal(retentionCutoff(new Date("2024-02-29T12:00:00Z")).toISOString(), "2019-02-28T12:00:00.000Z");
  const old = new Date(retentionCutoff().getTime() - 86400000);
  await Apply.updateOne({ _id: primary._id }, { $set: { date: old } });
  await request(app)
    .delete("/api/apply/retention")
    .set("Authorization", auth("admin"))
    .send({ confirm: "DELETE_EXPIRED_DOCUMENTS" })
    .expect(403);
  await request(app)
    .delete("/api/apply/retention")
    .set("Authorization", auth("superadmin"))
    .send({})
    .expect(400);
  const preview = await request(app)
    .get("/api/apply/retention")
    .set("Authorization", auth("superadmin"))
    .expect(200);
  assert.equal(preview.body.count, 1);
  const response = await request(app)
    .delete("/api/apply/retention")
    .set("Authorization", auth("superadmin"))
    .send({ confirm: "DELETE_EXPIRED_DOCUMENTS" })
    .expect(200);
  assert.equal(response.body.deleted, 1);
  assert.equal(response.body.failed, 0);
  const retained = await Apply.findById(primary.id);
  assert(retained.documentsDeletedAt);
  assert.equal(retained.archiveKey, null);
  await request(app)
    .get(`/api/apply/${primary.id}/cv`)
    .set("Authorization", auth("superadmin"))
    .expect(404);
  await request(app)
    .get(`/api/apply/${outside.id}/documents`)
    .set("Authorization", auth("superadmin"))
    .expect(200);
  const repeated = await request(app)
    .delete("/api/apply/retention")
    .set("Authorization", auth("superadmin"))
    .send({ confirm: "DELETE_EXPIRED_DOCUMENTS" })
    .expect(200);
  assert.equal(repeated.body.deleted, 0);
});
test("legacy deletion failures and CVs shared by recent applications are preserved for retry", async () => {
  const legacy = await Apply.collection.insertOne({
    jobId: "JOB00001",
    cv: "https://example.test/old.pdf",
    date: new Date("2010-01-01"),
  });
  const sharedUrl = 'https://example.test/shared.pdf';
  const shared = await Apply.collection.insertMany([
    { jobId: 'JOB00001', cv: sharedUrl, date: new Date('2010-01-01') },
    { jobId: 'JOB00001', cv: sharedUrl, date: new Date() },
  ]);
  const response = await request(app)
    .delete("/api/apply/retention")
    .set("Authorization", auth("superadmin"))
    .send({ confirm: "DELETE_EXPIRED_DOCUMENTS" })
    .expect(200);
  assert.equal(response.body.failed, 2);
  assert(response.body.failures.some(failure => failure.message.includes('recent application')));
  assert.equal((await Apply.findById(shared.insertedIds[1])).cv, sharedUrl);
  assert.equal(
    (await Apply.findById(legacy.insertedId)).cv,
    "https://example.test/old.pdf",
  );
});
