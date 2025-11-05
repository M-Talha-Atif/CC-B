const twilio = require("twilio");

// Initialize Twilio client
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const smsService = {
  // Send OTP using Twilio Verify API
  async sendOTP(phoneNumber, otpCode) {
    try {
      if (
        !process.env.TWILIO_ACCOUNT_SID ||
        !process.env.TWILIO_AUTH_TOKEN ||
        !process.env.TWILIO_PHONE_NUMBER
      ) {
        console.log(
          `Would send OTP "${otpCode}" to ${phoneNumber} (Twilio credentials missing)`
        );
        return { success: true, message: "OTP sent (development mode)" };
      }

      const message = await client.messages.create({
        body: `Cuno Covo: Your registration code is ${otpCode}. Do not share this with anyone.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phoneNumber,
      });

      return {
        success: true,
        sid: message.sid,
        message: "OTP sent successfully",
      };
    } catch (error) {
      console.error("Send OTP Error:", error);
      throw new Error("Failed to send OTP");
    }
  },

  // Verify OTP using Twilio Verify API
  async verifyOTP(phoneNumber, code) {
    try {
      const verification_check = await client.verify.v2
        .services(process.env.TWILIO_VERIFY_SERVICE_SID)
        .verificationChecks.create({ to: phoneNumber, code });

      return {
        success: verification_check.status === "approved",
        status: verification_check.status,
        message:
          verification_check.status === "approved"
            ? "OTP verified successfully"
            : "Invalid or expired OTP",
      };
    } catch (error) {
      console.error("Verify OTP Error:", error);
      throw new Error("Failed to verify OTP");
    }
  },

  // Validate phone number format
  validatePhoneNumber(phoneNumber) {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phoneNumber.replace(/\s+/g, ""));
  },
};

module.exports = smsService;
