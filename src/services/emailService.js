const nodemailer = require("nodemailer");

// Create transporter
const createTransporter = () => {
  if (process.env.EMAIL_SERVICE === "gmail") {
    return nodemailer.createTransporter({
      service: "gmail",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  // Default SMTP configuration
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
};

const emailService = {
  // Send welcome email
  async sendWelcomeEmail(email, name) {
    try {
      if (!process.env.EMAIL_USER) {
        console.log(`Email Service: Would send welcome email to ${email}`);
        return {
          success: true,
          message: "Welcome email sent (development mode)",
        };
      }

      const transporter = createTransporter();

      const mailOptions = {
        from: `"CUNO COVO" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Welcome to CUNO COVO!",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Welcome to CUNO COVO, ${name}!</h2>
            <p>Thank you for joining our creative community. We're excited to have you on board!</p>
            <p>Get ready to connect with amazing couples and grow your business.</p>
            <div style="margin: 30px 0; padding: 20px; background-color: #f9f9f9; border-radius: 8px;">
              <h3 style="color: #333; margin-top: 0;">Next Steps:</h3>
              <ul style="color: #666;">
                <li>Complete your profile setup</li>
                <li>Verify your phone number</li>
                <li>Start browsing available opportunities</li>
              </ul>
            </div>
            <p style="color: #666;">If you have any questions, feel free to reach out to our support team.</p>
            <p>Best regards,<br>The CUNO COVO Team</p>
          </div>
        `,
      };

      const info = await transporter.sendMail(mailOptions);
      console.log(
        `Welcome email sent successfully. Message ID: ${info.messageId}`
      );

      return {
        success: true,
        messageId: info.messageId,
        message: "Welcome email sent successfully",
      };
    } catch (error) {
      console.error("Email Service Error:", error);

      // In development, don't throw error - just log it
      if (process.env.NODE_ENV === "development") {
        console.log(
          `Email Service (Dev): Would send welcome email to ${email}`
        );
        return {
          success: true,
          message: "Welcome email sent (development mode)",
        };
      }

      throw new Error(`Failed to send welcome email: ${error.message}`);
    }
  },

  async sendEmailVerification(email, verificationToken) {
    try {
      if (!process.env.EMAIL_USER) {
        console.log(`Email Service: Would send verification email to ${email}`);
        return {
          success: true,
          message: "Verification email sent (development mode)",
        };
      }

      const transporter = createTransporter();
      const verificationUrl = `${process.env.BACKEND_URL}/api/auth/verify-email/${verificationToken}`;

      const mailOptions = {
        from: `"CUNO COVO" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Verify Your Email Address - CUNO COVO",
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #333; margin: 0;">CUNO COVO</h1>
          </div>
          
          <div style="background-color: #f9f9f9; padding: 30px; border-radius: 8px; margin-bottom: 30px;">
            <h2 style="color: #333; margin-top: 0; text-align: center;">Verify Your Email Address</h2>
            <p style="color: #666; line-height: 1.6; text-align: center;">
              Welcome to CUNO COVO! To complete your registration and start using our platform, 
              please verify your email address by clicking the button below.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationUrl}" 
                 style="background-color: #007bff; color: white; padding: 15px 30px; 
                        text-decoration: none; border-radius: 6px; display: inline-block;
                        font-weight: bold; font-size: 16px; border: 2px solid #007bff;">
                Verify Email Address
              </a>
            </div>
            
            <p style="color: #666; font-size: 14px; text-align: center;">
              This verification link will expire in 24 hours for security reasons.
            </p>
          </div>
          
          <div style="border-top: 1px solid #eee; padding-top: 20px;">
            <p style="color: #999; font-size: 12px; text-align: center;">
              If you didn't create an account with CUNO COVO, please ignore this email.
            </p>
            <p style="color: #999; font-size: 12px; text-align: center;">
              If the button doesn't work, copy and paste this link into your browser:<br>
              <span style="word-break: break-all;">${verificationUrl}</span>
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 30px;">
            <p style="color: #666; margin: 0;">
              Best regards,<br>
              The CUNO COVO Team
            </p>
          </div>
        </div>
      `,
      };

      const info = await transporter.sendMail(mailOptions);
      console.log(
        `Verification email sent successfully. Message ID: ${info.messageId}`
      );

      return {
        success: true,
        messageId: info.messageId,
        message: "Verification email sent successfully",
      };
    } catch (error) {
      console.error("Email Service Error:", error);

      // In development, don't throw error - just log it
      if (process.env.NODE_ENV === "development") {
        console.log(
          `Email Service (Dev): Would send verification email to ${email}`
        );
        return {
          success: true,
          message: "Verification email sent (development mode)",
        };
      }

      throw new Error(`Failed to send verification email: ${error.message}`);
    }
  },

  // Send payment success receipt email
  async sendPaymentReceiptEmail(email, name, paymentDetails) {
    try {
      if (!process.env.EMAIL_USER) {
        console.log(
          `Email Service: Would send payment receipt email to ${email}`
        );
        return {
          success: true,
          message: "Payment receipt email sent (development mode)",
        };
      }

      const transporter = createTransporter();
      const {
        inquiryId,
        totalAmount,
        proposalCount,
        creativeType,
        eventType,
        sessionId,
      } = paymentDetails;

      const mailOptions = {
        from: `"CUNO COVO" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Payment Confirmation - CUNO COVO Creative Proposals",
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #333; margin: 0;">CUNO COVO</h1>
          </div>
          
          <div style="background-color: #f0f8f0; padding: 30px; border-radius: 8px; margin-bottom: 30px; border-left: 4px solid #28a745;">
            <h2 style="color: #333; margin-top: 0; text-align: center;">✅ Payment Successful!</h2>
            <p style="color: #666; line-height: 1.6; text-align: center;">
              Thank you ${name}! Your payment has been processed successfully. You're all set to receive proposals from talented ${creativeType} for your ${eventType}.
            </p>
          </div>

          <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
            <h3 style="color: #333; margin-top: 0;">Receipt Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Transaction ID:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #333; font-weight: bold;">${sessionId}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Inquiry ID:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #333; font-weight: bold;">${inquiryId}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Service:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #333;">${proposalCount} Creative Proposals</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #666;">Amount Paid:</td>
                <td style="padding: 8px 0; color: #333; font-weight: bold; font-size: 18px;">$${totalAmount}</td>
              </tr>
            </table>
          </div>

          <div style="margin: 30px 0; padding: 20px; background-color: #f9f9f9; border-radius: 8px;">
            <h3 style="color: #333; margin-top: 0;">What Happens Next?</h3>
            <ul style="color: #666;">
              <li>Complete your wedding details in the chat interface</li>
              <li>Our system will match you with qualified ${creativeType}</li>
              <li>You'll receive ${proposalCount} personalized proposals within 24-48 hours</li>
              <li>Review and connect with your favorite creatives directly</li>
            </ul>
          </div>
          
          <div style="text-align: center; margin-top: 30px;">
            <p style="color: #666; margin: 0;">
              Questions? Contact our support team anytime.<br>
              <strong>The CUNO COVO Team</strong>
            </p>
          </div>
        </div>
      `,
      };

      const info = await transporter.sendMail(mailOptions);
      console.log(
        `Payment receipt email sent successfully. Message ID: ${info.messageId}`
      );

      return {
        success: true,
        messageId: info.messageId,
        message: "Payment receipt email sent successfully",
      };
    } catch (error) {
      console.error("Email Service Error:", error);

      if (process.env.NODE_ENV === "development") {
        console.log(
          `Email Service (Dev): Would send payment receipt email to ${email}`
        );
        return {
          success: true,
          message: "Payment receipt email sent (development mode)",
        };
      }

      throw new Error(`Failed to send payment receipt email: ${error.message}`);
    }
  },

  // Send payment failure email
  async sendPaymentFailureEmail(email, name, failureDetails) {
    try {
      if (!process.env.EMAIL_USER) {
        console.log(
          `Email Service: Would send payment failure email to ${email}`
        );
        return {
          success: true,
          message: "Payment failure email sent (development mode)",
        };
      }

      const transporter = createTransporter();
      const {
        inquiryId,
        totalAmount,
        proposalCount,
        creativeType,
        eventType,
        failureReason = "Payment was not completed",
      } = failureDetails;

      const retryUrl = `${process.env.FRONTEND_URL}/find-creative?inquiry_id=${inquiryId}`;

      const mailOptions = {
        from: `"CUNO COVO" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Payment Issue - CUNO COVO Creative Proposals",
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #333; margin: 0;">CUNO COVO</h1>
          </div>
          
          <div style="background-color: #fff8f0; padding: 30px; border-radius: 8px; margin-bottom: 30px; border-left: 4px solid #ffa500;">
            <h2 style="color: #333; margin-top: 0; text-align: center;">⚠️ Payment Not Completed</h2>
            <p style="color: #666; line-height: 1.6; text-align: center;">
              Hi ${name}, we noticed that your payment for the creative proposals wasn't completed successfully.
            </p>
            <p style="color: #666; line-height: 1.6; text-align: center; font-style: italic;">
              ${failureReason}
            </p>
          </div>

          <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 30px;">
            <h3 style="color: #333; margin-top: 0;">Order Summary</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Inquiry ID:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #333; font-weight: bold;">${inquiryId}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #666;">Service:</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eee; color: #333;">${proposalCount} ${creativeType} proposals for your ${eventType}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #666;">Amount:</td>
                <td style="padding: 8px 0; color: #333; font-weight: bold; font-size: 18px;">$${totalAmount}</td>
              </tr>
            </table>
          </div>

          <div style="margin: 30px 0; padding: 20px; background-color: #f9f9f9; border-radius: 8px;">
            <h3 style="color: #333; margin-top: 0;">No Worries - Try Again!</h3>
            <ul style="color: #666;">
              <li>Your inquiry has been saved and is waiting for you</li>
              <li>You can retry the payment at any time</li>
              <li>No additional fees will be charged</li>
              <li>Contact support if you need assistance</li>
            </ul>
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="${retryUrl}" 
               style="background-color: #000; color: white; padding: 15px 30px; 
                      text-decoration: none; border-radius: 6px; display: inline-block;
                      font-weight: bold; font-size: 16px;">
              Complete Payment
            </a>
          </div>
          
          <div style="border-top: 1px solid #eee; padding-top: 20px;">
            <p style="color: #666; font-size: 14px; text-align: center;">
              If you continue to experience issues, please contact our support team and we'll help you complete your order.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 30px;">
            <p style="color: #666; margin: 0;">
              We're here to help!<br>
              <strong>The CUNO COVO Team</strong>
            </p>
          </div>
        </div>
      `,
      };

      const info = await transporter.sendMail(mailOptions);
      console.log(
        `Payment failure email sent successfully. Message ID: ${info.messageId}`
      );

      return {
        success: true,
        messageId: info.messageId,
        message: "Payment failure email sent successfully",
      };
    } catch (error) {
      console.error("Email Service Error:", error);

      if (process.env.NODE_ENV === "development") {
        console.log(
          `Email Service (Dev): Would send payment failure email to ${email}`
        );
        return {
          success: true,
          message: "Payment failure email sent (development mode)",
        };
      }

      throw new Error(`Failed to send payment failure email: ${error.message}`);
    }
  },

  // Send password reset email
  async sendPasswordResetEmail(email, resetToken) {
    try {
      if (!process.env.EMAIL_USER) {
        console.log(
          `Email Service: Would send password reset email to ${email}`
        );
        return {
          success: true,
          message: "Password reset email sent (development mode)",
        };
      }

      const transporter = createTransporter();
      const resetUrl = `${process.env.FRONTEND_URL}/login/reset-password?token=${resetToken}`;

      const mailOptions = {
        from: `"CUNO COVO" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Reset Your CUNO COVO Password",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Password Reset Request</h2>
            <p>You requested to reset your password for your CUNO COVO account.</p>
            <p>Click the button below to reset your password:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" 
                 style="background-color: #000; color: white; padding: 12px 24px; 
                        text-decoration: none; border-radius: 6px; display: inline-block;">
                Reset Password
              </a>
            </div>
            <p style="color: #666; font-size: 14px;">
              This link will expire in 1 hour. If you didn't request this password reset, 
              please ignore this email.
            </p>
            <p style="color: #666; font-size: 12px;">
              If the button doesn't work, copy and paste this link into your browser: ${resetUrl}
            </p>
          </div>
        `,
      };

      const info = await transporter.sendMail(mailOptions);
      console.log(
        `Password reset email sent successfully. Message ID: ${info.messageId}`
      );

      return {
        success: true,
        messageId: info.messageId,
        message: "Password reset email sent successfully",
      };
    } catch (error) {
      console.error("Email Service Error:", error);

      // In development, don't throw error - just log it
      if (process.env.NODE_ENV === "development") {
        console.log(
          `Email Service (Dev): Would send password reset email to ${email}`
        );
        return {
          success: true,
          message: "Password reset email sent (development mode)",
        };
      }

      throw new Error(`Failed to send password reset email: ${error.message}`);
    }
  },

  // Send user approval email
  async sendUserApprovalEmail(email, name) {
    try {
      if (!process.env.EMAIL_USER) {
        console.log(
          `Email Service: Would send user approval email to ${email}`
        );
        return {
          success: true,
          message: "User approval email sent (development mode)",
        };
      }

      const transporter = createTransporter();
      const loginUrl = `${process.env.FRONTEND_URL}/login`;

      const mailOptions = {
        from: `"CUNO COVO" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Account Approved - Welcome to CUNO COVO!",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #333; margin: 0;">CUNO COVO</h1>
            </div>
            
            <div style="background-color: #f0f8f0; padding: 30px; border-radius: 8px; margin-bottom: 30px; border-left: 4px solid #28a745;">
              <h2 style="color: #333; margin-top: 0; text-align: center;">🎉 Account Approved!</h2>
              <p style="color: #666; line-height: 1.6; text-align: center;">
                Great news, ${name}! Your CUNO COVO account has been approved and is now active. 
                You can now start exploring all the amazing opportunities our platform has to offer.
              </p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${loginUrl}" 
                   style="background-color: #000; color: white; padding: 15px 30px; 
                          text-decoration: none; border-radius: 6px; display: inline-block;
                          font-weight: bold; font-size: 16px;">
                  Access Your Account
                </a>
              </div>
            </div>

            <div style="margin: 30px 0; padding: 20px; background-color: #f9f9f9; border-radius: 8px;">
              <h3 style="color: #333; margin-top: 0;">What's Next?</h3>
              <ul style="color: #666;">
                <li>Complete your profile to showcase your services</li>
                <li>Browse available wedding opportunities</li>
                <li>Connect with couples planning their special day</li>
                <li>Start building your portfolio on our platform</li>
              </ul>
            </div>
            
            <div style="border-top: 1px solid #eee; padding-top: 20px;">
              <p style="color: #666; font-size: 14px; text-align: center;">
                If you have any questions or need assistance getting started, our support team is here to help.
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 30px;">
              <p style="color: #666; margin: 0;">
                Welcome to the CUNO COVO family!<br>
                <strong>The CUNO COVO Team</strong>
              </p>
            </div>
          </div>
        `,
      };

      const info = await transporter.sendMail(mailOptions);
      console.log(
        `User approval email sent successfully. Message ID: ${info.messageId}`
      );

      return {
        success: true,
        messageId: info.messageId,
        message: "User approval email sent successfully",
      };
    } catch (error) {
      console.error("Email Service Error:", error);

      // In development, don't throw error - just log it
      if (process.env.NODE_ENV === "development") {
        console.log(
          `Email Service (Dev): Would send user approval email to ${email}`
        );
        return {
          success: true,
          message: "User approval email sent (development mode)",
        };
      }

      throw new Error(`Failed to send user approval email: ${error.message}`);
    }
  },

  // Send user rejection email
  async sendUserRejectionEmail(email, name, rejectionReason = "") {
    try {
      if (!process.env.EMAIL_USER) {
        console.log(
          `Email Service: Would send user rejection email to ${email}`
        );
        return {
          success: true,
          message: "User rejection email sent (development mode)",
        };
      }

      const transporter = createTransporter();
      const supportUrl = `${process.env.FRONTEND_URL}/contact`;

      const mailOptions = {
        from: `"CUNO COVO" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Account Application Update - CUNO COVO",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h1 style="color: #333; margin: 0;">CUNO COVO</h1>
            </div>
            
            <div style="background-color: #fff8f0; padding: 30px; border-radius: 8px; margin-bottom: 30px; border-left: 4px solid #ffa500;">
              <h2 style="color: #333; margin-top: 0; text-align: center;">Application Status Update</h2>
              <p style="color: #666; line-height: 1.6; text-align: center;">
                Thank you for your interest in joining CUNO COVO, ${name}. After careful review of your application, 
                we regret to inform you that we are unable to approve your account at this time.
              </p>
              
              ${
                rejectionReason
                  ? `
                <div style="margin: 20px 0; padding: 15px; background-color: #f9f9f9; border-radius: 6px;">
                  <h4 style="color: #333; margin-top: 0;">Reason for this decision:</h4>
                  <p style="color: #666; margin-bottom: 0;">${rejectionReason}</p>
                </div>
              `
                  : ""
              }
            </div>

            <div style="margin: 30px 0; padding: 20px; background-color: #f9f9f9; border-radius: 8px;">
              <h3 style="color: #333; margin-top: 0;">What You Can Do:</h3>
              <ul style="color: #666;">
                <li>Review our platform requirements and guidelines</li>
                <li>Address any issues mentioned in the feedback above</li>
                <li>Feel free to reapply in the future when you meet our criteria</li>
                <li>Contact our support team if you have questions about this decision</li>
              </ul>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${supportUrl}" 
                 style="background-color: #000; color: white; padding: 15px 30px; 
                        text-decoration: none; border-radius: 6px; display: inline-block;
                        font-weight: bold; font-size: 16px;">
                Contact Support
              </a>
            </div>
            
            <div style="border-top: 1px solid #eee; padding-top: 20px;">
              <p style="color: #666; font-size: 14px; text-align: center;">
                We appreciate your interest in CUNO COVO and wish you success in your future endeavors.
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 30px;">
              <p style="color: #666; margin: 0;">
                Best regards,<br>
                <strong>The CUNO COVO Team</strong>
              </p>
            </div>
          </div>
        `,
      };

      const info = await transporter.sendMail(mailOptions);
      console.log(
        `User rejection email sent successfully. Message ID: ${info.messageId}`
      );

      return {
        success: true,
        messageId: info.messageId,
        message: "User rejection email sent successfully",
      };
    } catch (error) {
      console.error("Email Service Error:", error);

      // In development, don't throw error - just log it
      if (process.env.NODE_ENV === "development") {
        console.log(
          `Email Service (Dev): Would send user rejection email to ${email}`
        );
        return {
          success: true,
          message: "User rejection email sent (development mode)",
        };
      }

      throw new Error(`Failed to send user rejection email: ${error.message}`);
    }
  },

  // Send general email
  async sendEmail(to, subject, htmlContent, textContent = "") {
    try {
      if (!process.env.EMAIL_USER) {
        console.log(
          `Email Service: Would send email to ${to} with subject: ${subject}`
        );
        return { success: true, message: "Email sent (development mode)" };
      }

      const transporter = createTransporter();

      const mailOptions = {
        from: `"CUNO COVO" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        html: htmlContent,
        text: textContent,
      };

      const info = await transporter.sendMail(mailOptions);
      console.log(`Email sent successfully. Message ID: ${info.messageId}`);

      return {
        success: true,
        messageId: info.messageId,
        message: "Email sent successfully",
      };
    } catch (error) {
      console.error("Email Service Error:", error);

      // In development, don't throw error - just log it
      if (process.env.NODE_ENV === "development") {
        console.log(
          `Email Service (Dev): Would send email to ${to} with subject: ${subject}`
        );
        return { success: true, message: "Email sent (development mode)" };
      }

      throw new Error(`Failed to send email: ${error.message}`);
    }
  },
};

module.exports = emailService;
