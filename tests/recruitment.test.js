import { mockPhotoStorage } from './mock-photo-storage.js';
import { storageTransport } from '../services/storage.js';
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
import PendingRegistration from "../models/pendingRegistration.js";
import Apply from "../models/apply.js";
import Job from "../models/jobVacancyModel.js";
import Message from "../models/message.js";
import ActivityLog from '../models/activityLog.js';
import { mailDelivery } from "../services/mail.js";
import { migrateLegacyRoles } from "../services/roleMigration.js";
import { retentionCutoff, CV_LIMIT } from "../services/documents.js";

process.env.JWT_KEY = "test-only-signing-key-not-for-production";
process.env.RESEND_FROM = "sender@example.test";
process.env.RESEND_API_KEY = "test-only-mail-transport";
let mongo, temp, primary, outside, originalMail, restoreStorage;
const tokens = {};
const cv = Buffer.from("%PDF-1.4\nTest CV\n%%EOF");
function auth(role) {
  return `Bearer ${tokens[role]}`;
}
test('activity records persist with actor and time and are restricted to super admins', async () => {
  await request(app).get('/api/activity-logs').expect(401);
  for (const role of ['user', 'admin']) {
    await request(app).get('/api/activity-logs').set('Authorization', auth(role)).expect(403);
  }
  await request(app).put('/api/users/user').set('Authorization', auth('user'))
    .send({ age: 27, password: 'must-not-be-logged', otp: 'secret' }).expect(200);
  // Logging follows response completion; wait for the persisted record.
  let entry;
  for (let attempt = 0; attempt < 50 && !entry; attempt++) {
    entry = await ActivityLog.findOne({ userName: 'user', action: 'Updated user profile or permissions' }).lean();
    if (!entry) await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert(entry);
  assert.equal(entry.role, 'user');
  assert.equal(entry.target, 'user');
  assert(entry.occurredAt instanceof Date);
  assert(!JSON.stringify(entry).includes('must-not-be-logged'));
  assert(!JSON.stringify(entry).includes('secret'));
  const response = await request(app).get('/api/activity-logs?role=user&userName=user').set('Authorization', auth('superadmin')).expect(200);
  assert(response.body.items.some(item => item._id === String(entry._id)));
  await request(app).get('/api/activity-logs?page=-1').set('Authorization', auth('superadmin')).expect(400);
});
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
  restoreStorage = mockPhotoStorage();
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
      id: "200012345678", age: 26, gender: "Male", birthday: "2000-05-02",
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
  originalMail = mailDelivery.sendMail;
});
after(async () => {
  mailDelivery.sendMail = originalMail;
  restoreStorage();
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
test("incomplete profiles cannot submit applications and can continue after completing their profile", async () => {
  await User.updateOne({ userName: 'user' }, { $unset: { id: 1, birthday: 1, age: 1, gender: 1 } });
  try {
    const result = await submit().attach('cv', cv, 'CV.pdf').expect(400);
    assert.equal(result.body.code, 'PROFILE_INCOMPLETE');
    assert.deepEqual(result.body.missingFields.sort(), ['age', 'birthday', 'gender', 'id']);
    await request(app).put('/api/users/user').set('Authorization', auth('user'))
      .send({ id: '200012345678', age: 26, gender: 'Male', birthday: '2000-05-02' }).expect(200);
  } finally {
    await User.updateOne({ userName: 'user' }, { $set: { id: '200012345678', age: 26, gender: 'Male', birthday: '2000-05-02' } });
  }
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
test("Super Admin can assign all faculties and departments without bypassing specific restrictions", async () => {
  const physics = await Apply.create({ jobId: "JOB00003", jobRole: "Probationary lecturer", category: "probationary", faculty: "Science", department: "Physics", userName: "user", firstName: "Scope", lastName: "Test", email: "scope@example.test", mobileNumber: "0771234567" });
  try {
    for (const [faculty, department, includesOutside, includesPhysics] of [
      ["Science", "*", false, true],
      ["*", "Computing", false, false],
      ["*", "*", true, true],
    ]) {
      await request(app).put("/api/users/admin").set("Authorization", auth("superadmin"))
        .send({ role: "admin", faculty, department }).expect(200);
      const result = await request(app).get("/api/apply").set("Authorization", auth("admin")).expect(200);
      assert(result.body.some(a => a._id === primary.id));
      assert.equal(result.body.some(a => a._id === outside.id), includesOutside);
      assert.equal(result.body.some(a => a._id === physics.id), includesPhysics);
    }
    await request(app).put("/api/users/admin").set("Authorization", auth("user"))
      .send({ faculty: "*", department: "*" }).expect(403);
  } finally {
    await User.updateOne({ userName: "admin" }, { $set: { faculty: "Science", department: "Computing" } });
    await Apply.deleteOne({ _id: physics._id });
  }
});

test("custom position categories, faculties and job types work through job creation and application review", async () => {
  await request(app).post("/api/jobs").set("Authorization", auth("superadmin")).send({
    jobRole: "Research Fellow", category: "Research fellow", faculty: "Graduate Studies",
    department: "Research", jobType: "Contract", location: "Main Campus",
    deadline: new Date(Date.now() + 86400000).toISOString(),
  }).expect(201);
  const job = await Job.findOne({ jobRole: "Research Fellow" });
  assert.equal(job.category, "Research fellow");
  assert.equal(job.faculty, "Graduate Studies");
  assert.equal(job.jobType, "Contract");
  try {
    await submit(job.jobId).attach("cv", cv, "CV.pdf").expect(201);
    const response = await request(app).get("/api/apply").query({ category: "Research fellow" })
      .set("Authorization", auth("superadmin")).expect(200);
    assert.equal(response.body.length, 1);
    assert.equal(response.body[0].jobId, job.jobId);
    assert.equal(response.body[0].category, "Research fellow");
  } finally {
    // Application files are cleaned by the test suite's temporary directory cleanup.
    await Apply.deleteMany({ jobId: job.jobId });
    await Job.deleteOne({ _id: job._id });
  }
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
  mailDelivery.sendMail = async (options) => {
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
  assert.equal(sent.to, process.env.RESEND_FROM);
  assert.equal(await Message.countDocuments({ subject: "Interview" }), 1);
  assert((await Apply.findById(primary.id)).lastNotifiedAt);
});
test("bulk mail enforces scope, shortlist validation and input limits before contacting Resend", async () => {
  let called = false;
  mailDelivery.sendMail = async () => {
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
  delete process.env.RESEND_API_KEY;
  await request(app)
    .post("/api/apply/email")
    .set("Authorization", auth("admin"))
    .send({ applicationIds: [primary.id], subject: "X", message: "Y" })
    .expect(503);
  process.env.RESEND_API_KEY = "test-only-mail-transport";
  mailDelivery.sendMail = async () => ({
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


test("profile photos require authentication, validate content and cannot delete another account's photo", async () => {
  const restoreStorage = mockPhotoStorage();
  try {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=', 'base64');
  await request(app).post('/api/users/profile-photo').attach('photo', png, 'avatar.png').expect(401);
  await request(app).post('/api/users/profile-photo').set('Authorization', auth('user')).attach('photo', Buffer.from('<script>bad</script>'), 'avatar.png').expect(400);
  const uploaded = await request(app).post('/api/users/profile-photo').set('Authorization', auth('user')).attach('photo', png, 'avatar.png').expect(201);
  assert.match(uploaded.body.img, /^\/api\/users\/avatar\/supabase~photos~[a-f0-9-]+\.png$/);
  const photo = await request(app).get(uploaded.body.img).expect(200).expect('Content-Type', /image\/png/);
  assert(photo.body.equals(png));
  assert.equal(photo.headers['cross-origin-resource-policy'], 'cross-origin');
  await request(app).put('/api/users/other').set('Authorization', auth('other')).send({ img: uploaded.body.img }).expect(200);
  await request(app).post('/api/users/profile-photo').set('Authorization', auth('other')).attach('photo', png, 'avatar.png').expect(201);
  await request(app).get(uploaded.body.img).expect(200);
  await request(app).post('/api/users/profile-photo').set('Authorization', auth('user')).attach('photo', png, 'avatar.png').expect(201);
  await request(app).get(uploaded.body.img).expect(404);
  await request(app).get('/api/users/avatar/' + 'a'.repeat(24) + '-11111111-1111-1111-1111-111111111111.png').expect(404);
  } finally { restoreStorage(); }
});

test("Supabase avatars remain behind the same photo API and support replacement", async () => {
  const saved = Object.fromEntries(['STORAGE_PROVIDER', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_AVATARS_BUCKET'].map(key => [key, process.env[key]]));
  const originalFetch = storageTransport.fetch;
  const objects = new Map();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=', 'base64');
  try {
    Object.assign(process.env, { STORAGE_PROVIDER: 'supabase', SUPABASE_URL: 'https://storage.example.test', SUPABASE_SERVICE_ROLE_KEY: 'server-test-key', SUPABASE_AVATARS_BUCKET: 'photos' });
    storageTransport.fetch = async (url, options) => {
      const route = new URL(url).pathname;
      if (options.method === 'POST') { objects.set(route, Buffer.from(options.body)); return Response.json({}); }
      if (options.method === 'DELETE') { for (const key of JSON.parse(options.body).prefixes) objects.delete(`${route}/${key}`); return Response.json([]); }
      const key = route.replace('/authenticated/', '/');
      return objects.has(key) ? new Response(objects.get(key)) : Response.json({ statusCode: 404 }, { status: 400 });
    };
    const first = await request(app).post('/api/users/profile-photo').set('Authorization', auth('user')).attach('photo', png, 'avatar.png').expect(201);
    assert(first.body.img.includes('supabase~photos~'));
    await request(app).get(first.body.img).expect(200).expect('Content-Type', /image\/png/);
    await request(app).post('/api/users/profile-photo').set('Authorization', auth('user')).attach('photo', png, 'avatar.png').expect(201);
    await request(app).get(first.body.img).expect(404);
    assert.equal(objects.size, 1);
  } finally {
    storageTransport.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await User.updateOne({ userName: 'user' }, { $set: { img: '/profile.png' } });
  }
});

test("password reset revokes existing sessions and accepts only the new password", async () => {
  await User.updateOne({ userName: 'other' }, { $set: { otp: '123456', otpExpires: new Date(Date.now() + 60000) } });
  try {
    await request(app).post('/api/users/reset-password').send({ email: 'other@example.test', otp: '123456', newPassword: 'NewPassword123!' }).expect(200);
    await request(app).get('/api/users/other').set('Authorization', auth('other')).expect(401);
    const login = await request(app).post('/api/users/login').send({ email: 'other@example.test', password: 'NewPassword123!' }).expect(200);
    await request(app).get('/api/users/other').set('Authorization', `Bearer ${login.body.token}`).expect(200);
  } finally { await User.updateOne({ userName: 'other' }, { $set: { authVersion: 0 } }); }
});

test("signup is temporary until valid OTP; failed email, wrong OTP and expired OTP create no account", async () => {
  const original = mailDelivery.sendMail;
  const details = { firstName: "Pending", lastName: "Applicant", userName: "otp-signup", email: "otp-signup@example.test", password: "TestPassword123!" };
  try {
    mailDelivery.sendMail = async () => { const error = new Error("Resend test mode can send OTPs only to your Resend account email. Verify a domain and set RESEND_FROM."); error.status = 502; throw error; };
    const failure = await request(app).post("/api/users").send(details).expect(502);
    assert.equal(failure.body.message, "We could not send your verification code. Please try again later.");
    assert(!JSON.stringify(failure.body).includes("RESEND_FROM"));
    assert.equal(await User.countDocuments({ email: details.email }), 0);
    assert.equal(await PendingRegistration.countDocuments({ email: details.email }), 0);
    mailDelivery.sendMail = async () => ({ accepted: [details.email], rejected: [] });
    await request(app).post("/api/users").send(details).expect(200);
    assert.equal(await User.countDocuments({ email: details.email }), 0);
    let pending = await PendingRegistration.findOne({ email: details.email });
    assert(pending);
    assert.notEqual(pending.password, details.password);
    await request(app).post("/api/users/login").send(details).expect(404);
    await request(app).post("/api/users/verify-email").send({ email: details.email, otp: "invalid" }).expect(400);
    assert.equal(await User.countDocuments({ email: details.email }), 0);
    await PendingRegistration.updateOne({ _id: pending._id }, { $set: { otpExpires: new Date(Date.now() - 1000) } });
    await request(app).post("/api/users/verify-email").send({ email: details.email, otp: pending.otp }).expect(400);
    await request(app).post("/api/users").send(details).expect(200);
    pending = await PendingRegistration.findOne({ email: details.email });
    await request(app).post("/api/users/verify-email").send({ email: details.email, otp: pending.otp }).expect(200);
    assert.equal((await User.findOne({ email: details.email })).isVerified, true);
    assert.equal(await PendingRegistration.countDocuments({ email: details.email }), 0);
    const login = await request(app).post("/api/users/login").send(details).expect(200);
    assert(login.body.token);
    await request(app).post("/api/users").send(details).expect(403);
  } finally {
    mailDelivery.sendMail = original;
  }
});
