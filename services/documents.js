import multer from "multer";
import JSZip from "jszip";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const CV_LIMIT = 2 * 1024 * 1024;
export const FILE_LIMIT = 5 * 1024 * 1024;
export const CATEGORIES = ["lecturer", "probationary", "demo"];
export const STATUSES = [
  "pending",
  "shortlisted",
  "selected",
  "rejected",
  "hold",
];
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: FILE_LIMIT,
    files: 11,
    fields: 10,
    fieldSize: 4096,
  },
}).fields([
  { name: "cv", maxCount: 1 },
  { name: "supporting", maxCount: 10 },
]);

export function documentError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}
export function storageRoot() {
  return path.resolve(process.env.UPLOAD_DIR || "./uploads");
}
function storagePath(key) {
  if (!/^[a-f0-9-]+\.zip$/.test(key))
    throw documentError("Invalid document reference.");
  return path.join(storageRoot(), key);
}
function validDocument(file, cv = false) {
  const ext = path.extname(file.originalname).toLowerCase();
  const pdf =
    ext === ".pdf" && file.buffer.subarray(0, 5).toString() === "%PDF-";
  const png =
    ext === ".png" &&
    file.buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpg =
    [".jpg", ".jpeg"].includes(ext) &&
    file.buffer[0] === 255 &&
    file.buffer[1] === 216 &&
    file.buffer[2] === 255;
  if (!(pdf || (!cv && (png || jpg))))
    throw documentError(
      cv
        ? "The CV must be a PDF document."
        : "Supporting documents must be PDF, PNG or JPEG files.",
    );
  if (!file.size || file.size > (cv ? CV_LIMIT : FILE_LIMIT))
    throw documentError(
      cv
        ? "The CV must be no larger than 2 MB."
        : "Each supporting document must be no larger than 5 MB.",
    );
}
export async function createArchive(files) {
  const cv = files?.cv?.[0];
  if (!cv)
    throw documentError("Please upload your CV as a PDF (maximum 2 MB).");
  validDocument(cv, true);
  const zip = new JSZip();
  zip.file("CV.pdf", cv.buffer);
  const supportingDocuments = (files.supporting || []).map((file, i) => {
    validDocument(file);
    const name = path
      .basename(file.originalname)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(-120);
    const archiveName = `supporting/${i + 1}-${name}`;
    zip.file(archiveName, file.buffer);
    return {
      name: file.originalname.slice(0, 200),
      size: file.size,
      archiveName,
    };
  });
  const key = `${randomUUID()}.zip`;
  await mkdir(storageRoot(), { recursive: true, mode: 0o700 });
  await writeFile(
    storagePath(key),
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
    { mode: 0o600, flag: "wx" },
  );
  return { archiveKey: key, cvSize: cv.size, supportingDocuments };
}
export function readArchive(key) {
  return readFile(storagePath(key));
}
export async function readCV(key) {
  const zip = await JSZip.loadAsync(await readArchive(key));
  return zip.file("CV.pdf").async("nodebuffer");
}
export async function removeArchive(key) {
  try {
    await unlink(storagePath(key));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
// Delete legacy public Supabase CVs only through a trusted, explicitly configured bucket.
export async function removeLegacyCV(url) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error(
      "Legacy storage deletion requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.",
    );
  const target = new URL(url);
  const base = new URL(process.env.SUPABASE_URL);
  const prefix = "/storage/v1/object/public/cv/";
  if (
    base.protocol !== "https:" ||
    target.origin !== base.origin ||
    !target.pathname.startsWith(prefix)
  )
    throw new Error(
      "Unrecognized legacy CV storage location; document was preserved.",
    );
  const object = decodeURIComponent(target.pathname.slice(prefix.length));
  const response = await fetch(`${base.origin}/storage/v1/object/cv`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefixes: [object] }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      "Legacy CV storage deletion failed; application record was preserved.",
    );
}
export function retentionCutoff(now = new Date()) {
  const cutoff = new Date(now);
  const month = cutoff.getUTCMonth();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 5);
  if (cutoff.getUTCMonth() !== month) cutoff.setUTCDate(0);
  return cutoff;
}

// Historical vacancies did not have a structured category. Prefer explicit metadata.
export function inferCategory(title = "") {
  if (/probationary/i.test(title)) return "probationary";
  if (/\bdemo(?:nstrator)?\b/i.test(title)) return "demo";
  if (/lecturer/i.test(title)) return "lecturer";
  return undefined;
}
