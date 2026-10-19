import "dotenv/config";
import { Resend } from "resend";

export const resendClient = new Resend(process.env.RESEND_API_KEY || "re_not_configured");

function requireEmailConfiguration() {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM) {
    const error = new Error("Email delivery is not configured. Set RESEND_API_KEY and RESEND_FROM on the backend.");
    error.status = 503;
    throw error;
  }
}

// Shared delivery boundary; tests replace this method without sending real email.
export const mailDelivery = {
  async sendMail(options) {
    requireEmailConfiguration();
    let result;
    try {
      result = await resendClient.emails.send({ ...options, from: process.env.RESEND_FROM });
    } catch {
      const error = new Error("Email provider is unavailable. Please try again later.");
      error.status = 502;
      throw error;
    }
    if (result.error || !result.data?.id) {
      const providerError = result.error;
      // Log only provider diagnostics, never API keys, request headers, or OTP content.
      console.error("Resend delivery rejected:", {
        name: providerError?.name,
        statusCode: providerError?.statusCode,
        message: providerError?.message,
      });
      const detail = String(providerError?.message || "");
      let message = "Email delivery failed. Check the backend logs for the Resend error.";
      if (/only send testing emails|own email address/i.test(detail)) {
        message = "Resend test mode can send OTPs only to your Resend account email. To email other users, verify a domain in Resend and set RESEND_FROM to an address on that domain.";
      } else if (/api.?key|unauthorized|invalid token/i.test(detail)) {
        message = "Resend rejected the API key. Update RESEND_API_KEY in the backend .env and restart the backend.";
      } else if (/domain|from address|sender/i.test(detail)) {
        message = "Resend rejected the sender. Verify its domain in Resend and set RESEND_FROM to an address on that verified domain.";
      } else if (providerError?.statusCode === 429) {
        message = "The email provider limit has been reached. Please try again later.";
      }
      const error = new Error(message);
      error.status = 502;
      throw error;
    }
    return {
      id: result.data.id,
      accepted: options.bcc || (Array.isArray(options.to) ? options.to : [options.to]),
      rejected: [],
    };
  },
};

export async function sendMail(options) {
  requireEmailConfiguration();
  return mailDelivery.sendMail(options);
}

export async function sendApplicantMail({ recipients, subject, message }) {
  // BCC prevents disclosure of applicants' addresses to one another.
  return sendMail({
    to: process.env.RESEND_FROM,
    bcc: recipients,
    subject,
    text: message,
  });
}
