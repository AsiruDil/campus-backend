import mongoose from "mongoose";
import { applicationScope } from "../middleware/access.js";
import Apply from "../models/apply.js";
import JobVacancy from "../models/jobVacancyModel.js";
import Message from "../models/message.js";
import { sendApplicantMail } from "../services/mail.js";
import {
  createArchive,
  readArchive,
  readCV,
  removeArchive,
  removeLegacyCV,
  retentionCutoff,
  CATEGORIES,
  STATUSES,
  documentError,
  inferCategory,
} from "../services/documents.js";

export async function saveApply(req, res) {
  let archive;
  try {
    const job = await JobVacancy.findOne({ jobId: req.body.jobId });
    if (!job)
      return res
        .status(404)
        .json({ message: "This vacancy no longer exists." });
    if (!job.isAvailable || job.deadline <= new Date())
      return res
        .status(400)
        .json({ message: "Applications for this position are closed." });
    const nic = String(req.body.nic || "")
      .trim()
      .toUpperCase();
    if (!/^(\d{9}[VX]|\d{12})$/.test(nic))
      throw documentError(
        "Enter a valid NIC: 9 digits followed by V/X, or 12 digits.",
      );
    const mobileNumber = String(req.body.mobileNumber || "").trim();
    if (!/^\+?[\d\s()-]{7,20}$/.test(mobileNumber))
      throw documentError("Enter a valid mobile number.");
    const category =
      job.category || inferCategory(job.jobRole) || req.body.category;
    if (!CATEGORIES.includes(category))
      throw documentError("Please select a position category.");
    archive = await createArchive(req.files);
    const application = new Apply({
      ...archive,
      jobId: job.jobId,
      jobRole: job.jobRole,
      category,
      faculty: job.faculty,
      department: job.department,
      userName: req.user.userName,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      email: req.user.email,
      nic,
      mobileNumber,
    });
    application.cv = `/api/apply/${application._id}/cv`;
    await application.save();
    res.status(201).json({
      message:
        "Application submitted. Your CV and supporting documents are stored together as a ZIP.",
      success: true,
      id: application._id,
    });
  } catch (error) {
    if (archive) await removeArchive(archive.archiveKey).catch(() => {});
    res.status(error.status || 500).json({
      message: error.status
        ? error.message
        : "Could not save the application. Please try again.",
    });
  }
}

export async function getApplies(req, res) {
  const query = req.user.role === "admin" ? { isAvailable: true } : {};
  const { category, status, jobId } = req.query;
  if (category && !CATEGORIES.includes(category))
    throw documentError("Invalid position category.");
  if (status && !STATUSES.includes(status))
    throw documentError("Invalid application status.");
  // Old applications have no status; they are pending, and remain visible.
  if (status === "pending")
    query.$or = [{ status: "pending" }, { status: { $exists: false } }];
  else if (status) query.status = status;
  if (jobId) query.jobId = String(jobId);
  const applications = await Apply.find({
    $and: [query, await applicationScope(req.user)],
  })
    .select("-archiveKey")
    .sort({ date: -1 })
    .lean();
  const legacyJobs = await JobVacancy.find({
    jobId: { $in: applications.filter((a) => !a.category).map((a) => a.jobId) },
  })
    .select("jobId category jobRole")
    .lean();
  const jobCategories = new Map(
    legacyJobs.map((job) => [
      job.jobId,
      job.category || inferCategory(job.jobRole),
    ]),
  );
  const results = applications.map((application) => ({
    ...application,
    category:
      application.category ||
      jobCategories.get(application.jobId) ||
      inferCategory(application.jobRole),
    status: application.status || "pending",
    hasArchive: Boolean(
      application.cv && application.cv.startsWith("/api/apply/"),
    ),
  }));
  res.json(
    category
      ? results.filter((application) => application.category === category)
      : results,
  );
}

export async function updateStatus(req, res) {
  const { status } = req.body;
  if (!STATUSES.includes(status))
    throw documentError("Invalid application status.");
  if (!mongoose.isValidObjectId(req.params.id))
    throw documentError("Invalid application.");
  const filter = { _id: req.params.id };
  const application = await Apply.findOneAndUpdate(
    { $and: [filter, await applicationScope(req.user)] },
    {
      $set: { status, reviewedBy: req.user.userName, reviewedAt: new Date() },
      $push: {
        reviewHistory: { status, by: req.user.userName, date: new Date() },
      },
    },
    { new: true, runValidators: true },
  ).select("-archiveKey");
  if (!application)
    return res.status(409).json({
      message:
        "Application unavailable or already has a final decision. Refresh the list.",
    });
  res.json(application);
}

export async function downloadDocuments(req, res) {
  if (!mongoose.isValidObjectId(req.params.id))
    throw documentError("Invalid application.");
  const application = await Apply.findOne({
    $and: [{ _id: req.params.id }, await applicationScope(req.user)],
  });
  if (!application)
    return res.status(404).json({ message: "Application not found." });
  if (req.user.role === "user" && application.userName !== req.user.userName)
    return res
      .status(403)
      .json({ message: "You can only download your own documents." });
  if (!application.archiveKey || application.documentsDeletedAt)
    return res.status(404).json({
      message:
        "These documents are unavailable or have been removed under the retention policy.",
    });
  const cvOnly = req.path.endsWith("/cv");
  try {
    const data = cvOnly
      ? await readCV(application.archiveKey)
      : await readArchive(application.archiveKey);
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.type(cvOnly ? "application/pdf" : "application/zip");
    res
      .attachment(`application-${application._id}.${cvOnly ? "pdf" : "zip"}`)
      .send(data);
  } catch (error) {
    if (error.code === "ENOENT")
      return res.status(404).json({
        message: "Document file not found. Contact the administrator.",
      });
    throw error;
  }
}

export async function emailApplicants(req, res) {
  const { applicationIds, subject, message } = req.body;
  if (
    !Array.isArray(applicationIds) ||
    !applicationIds.length ||
    applicationIds.length > 200 ||
    applicationIds.some((id) => !mongoose.isValidObjectId(id))
  )
    throw documentError("Select between 1 and 200 applications.");
  if (
    typeof subject !== "string" ||
    !subject.trim() ||
    subject.length > 200 ||
    /[\r\n]/.test(subject) ||
    typeof message !== "string" ||
    !message.trim() ||
    message.length > 10000
  )
    throw documentError(
      "Enter a subject (up to 200 characters) and message (up to 10,000 characters).",
    );
  const applications = await Apply.find({
    $and: [{ _id: { $in: applicationIds } }, await applicationScope(req.user)],
  });
  if (applications.length !== new Set(applicationIds).size)
    throw documentError(
      "One or more selected applications no longer exist. Refresh and try again.",
    );
  if (
    req.body.shortlistedOnly &&
    applications.some((a) => !["shortlisted", "selected"].includes(a.status))
  )
    throw documentError(
      "Only shortlisted or selected applicants can receive this notification.",
    );
  const recipients = [...new Set(applications.map((a) => a.email))];
  const delivery = await sendApplicantMail({
    recipients,
    subject: subject.trim(),
    message: message.trim(),
  });
  const accepted = recipients.filter((email) =>
    (delivery.accepted || []).some(
      (value) => String(value).toLowerCase() === email.toLowerCase(),
    ),
  );
  await Message.create({
    sender: req.user.userName,
    recipients: accepted,
    subject: subject.trim(),
    message: message.trim(),
  });
  await Apply.updateMany(
    { _id: { $in: applicationIds }, email: { $in: accepted } },
    { $set: { lastNotifiedAt: new Date() } },
  );
  const failed = recipients.length - accepted.length;
  res.status(failed ? 207 : 200).json({
    message: failed
      ? `${accepted.length} accepted for delivery; ${failed} could not be sent. Refresh before retrying.`
      : `Email accepted for delivery to ${accepted.length} applicant(s).`,
    sent: accepted.length,
    failed,
  });
}

const expiredQuery = () => ({
  date: { $lte: retentionCutoff() },
  documentsDeletedAt: null,
  $or: [
    { archiveKey: { $type: "string" } },
    { cv: { $type: "string", $ne: "" } },
  ],
});
export async function retentionPreview(req, res) {
  res.json({
    count: await Apply.countDocuments(expiredQuery()),
    cutoff: retentionCutoff(),
  });
}
export async function deleteExpiredDocuments(req, res) {
  if (req.body.confirm !== "DELETE_EXPIRED_DOCUMENTS")
    throw documentError("Confirm deletion of documents older than five years.");
  const applications = await Apply.find(expiredQuery());
  let deleted = 0;
  const failures = [];
  for (const application of applications) {
    try {
      if (application.archiveKey) await removeArchive(application.archiveKey);
      else if (application.cv) {
        const shared = await Apply.exists({
          _id: { $ne: application._id },
          cv: application.cv,
          date: { $gt: retentionCutoff() },
          documentsDeletedAt: null,
        });
        if (shared)
          throw new Error(
            "This legacy CV is also attached to a recent application and was preserved.",
          );
        await removeLegacyCV(application.cv);
      }
      await Apply.updateOne(
        { _id: application._id },
        {
          $set: {
            cv: "",
            archiveKey: null,
            supportingDocuments: [],
            documentsDeletedAt: new Date(),
            documentsDeletedBy: req.user.userName,
          },
        },
      );
      deleted++;
    } catch (error) {
      failures.push({ id: application._id, message: error.message });
    }
  }
  res.json({
    deleted,
    failed: failures.length,
    failures,
    message: `${deleted} expired document package(s) deleted.${failures.length ? ` ${failures.length} could not be deleted and were preserved for retry.` : ""}`,
  });
}
