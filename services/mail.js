import "dotenv/config";
import nodemailer from "nodemailer";

export const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

export async function sendApplicantMail({ recipients, subject, message }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    const error = new Error(
      "Email delivery is not configured. Please contact the administrator.",
    );
    error.status = 503;
    throw error;
  }
  // BCC prevents disclosure of applicants' email addresses to one another.
  const result = await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_USER,
    bcc: recipients,
    subject,
    text: message,
  });
  return result;
}
