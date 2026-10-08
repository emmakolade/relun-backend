import { sendEmail } from '../services/email.service';
import { otpEmail } from '../services/emailTemplates';
import { sendSMS } from '../services/sms.service';

// Generate a 6-digit OTP
export const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const OTP_TTL_MINUTES = 10;

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
  return storedOTP === providedOTP;
};
