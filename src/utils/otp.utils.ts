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

// Send OTP via email (mock for now - integrate with email service)
export const sendOTPEmail = async (email: string, otp: string): Promise<void> => {
  // TODO: Integrate with email service (SendGrid, AWS SES, etc.)
  console.log(`[EMAIL] Sending OTP ${otp} to ${email}`);
  
  // For development, just log it
  // In production, use actual email service:
  // await emailService.send({
  //   to: email,
  //   subject: 'Your Relun Verification Code',
  //   text: `Your verification code is: ${otp}. Valid for 10 minutes.`,
  // });
};

// Send OTP via SMS (mock for now - integrate with SMS service)
export const sendOTPSMS = async (phone: string, otp: string): Promise<void> => {
  // TODO: Integrate with SMS service (Twilio, AWS SNS, etc.)
  console.log(`[SMS] Sending OTP ${otp} to ${phone}`);
  
  // For development, just log it
  // In production, use actual SMS service:
  // await smsService.send({
  //   to: phone,
  //   message: `Your Relun verification code is: ${otp}. Valid for 10 minutes.`,
  // });
};

// Verify OTP
export const verifyOTP = (storedOTP: string, providedOTP: string, expiry: Date): boolean => {
  if (new Date() > expiry) {
    return false; // OTP expired
  }
  return storedOTP === providedOTP;
};
