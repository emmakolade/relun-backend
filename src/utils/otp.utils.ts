import crypto from 'crypto';
import { sendEmail } from '../services/email.service';
import { otpEmail } from '../services/emailTemplates';
import { sendSMS } from '../services/sms.service';

// Generate a 6-digit OTP
export const generateOTP = (): string => {
  return crypto.randomInt(100000, 1000000).toString();
};

export const OTP_TTL_MINUTES = 10;
// Wrong guesses allowed before the code is thrown away.
export const OTP_MAX_ATTEMPTS = 5;
// Minimum gap between codes sent to the same email or phone.
export const OTP_RESEND_SECONDS = 60;

export const getOTPExpiry = (): Date => {
  const expiry = new Date();
  expiry.setMinutes(expiry.getMinutes() + OTP_TTL_MINUTES);
  return expiry;
};

// Send OTP via email
export const sendOTPEmail = async (email: string, otp: string): Promise<void> => {
  const message = otpEmail({ code: otp, minutes: OTP_TTL_MINUTES, recipient: email });
  await sendEmail({ to: email, ...message });
};

// Send OTP via SMS
export const sendOTPSMS = async (phone: string, otp: string): Promise<void> => {
  await sendSMS({
    to: phone,
    message: `Your Relun verification code is: ${otp}. Valid for ${OTP_TTL_MINUTES} minutes.`,
  });
};

// Verify OTP
export const verifyOTP = (storedOTP: string, providedOTP: string, expiry: Date): boolean => {
  if (new Date() > expiry) {
    return false;
  }
  const stored = Buffer.from(storedOTP);
  const provided = Buffer.from(String(providedOTP));
  return stored.length === provided.length && crypto.timingSafeEqual(stored, provided);
};
