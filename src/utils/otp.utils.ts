import { sendEmail } from '../services/email.service';
import { sendSMS } from '../services/sms.service';

// Generate a 6-digit OTP
export const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// OTP expires in 10 minutes
export const getOTPExpiry = (): Date => {
  const expiry = new Date();
  expiry.setMinutes(expiry.getMinutes() + 10);
  return expiry;
};

// Send OTP via email
export const sendOTPEmail = async (email: string, otp: string): Promise<void> => {
  await sendEmail({
    to: email,
    subject: 'Your Relun Verification Code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Welcome to Relun!</h2>
        <p style="font-size: 16px; color: #555;">Your verification code is:</p>
        <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
          <h1 style="color: #FF6B6B; margin: 0; letter-spacing: 5px;">${otp}</h1>
        </div>
        <p style="font-size: 14px; color: #777;">This code will expire in 10 minutes.</p>
        <p style="font-size: 14px; color: #777;">If you didn't request this code, please ignore this email.</p>
      </div>
    `,
    text: `Your Relun verification code is: ${otp}. Valid for 10 minutes.`,
  });
};

// Send OTP via SMS
export const sendOTPSMS = async (phone: string, otp: string): Promise<void> => {
  await sendSMS({
    to: phone,
    message: `Your Relun verification code is: ${otp}. Valid for 10 minutes.`,
  });
};

// Verify OTP
export const verifyOTP = (storedOTP: string, providedOTP: string, expiry: Date): boolean => {
  if (new Date() > expiry) {
    return false; // OTP expired
  }
  return storedOTP === providedOTP;
};
