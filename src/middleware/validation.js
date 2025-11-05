const Joi = require('joi');

// Validation schemas
const registrationSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': 'Please provide a valid business email address',
    'any.required': 'Email is required'
  }),
  password: Joi.string().min(8).required().messages({
    'string.min': 'Password must be at least 8 characters long',
    'any.required': 'Password is required'
  }),
  userType: Joi.string().valid('creative', 'couple').default('creative')
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const referralCodeSchema = Joi.object({
  referralCode: Joi.string().required().messages({
    'any.required': 'Referral code is required'
  })
});

const phoneNumberSchema = Joi.object({
  phone: Joi.string().pattern(/^\+?[\d\s\-\(\)]+$/).required().messages({
    'string.pattern.base': 'Please provide a valid phone number',
    'any.required': 'Phone number is required'
  })
});

const otpSchema = Joi.object({
  phone: Joi.string().required(),
  otpCode: Joi.string().length(6).pattern(/^\d+$/).required().messages({
    'string.length': 'OTP must be exactly 6 digits',
    'string.pattern.base': 'OTP must contain only numbers',
    'any.required': 'OTP code is required'
  })
});

const profileSchema = Joi.object({
  businessName: Joi.string().min(2).max(255).required().messages({
    'string.min': 'Business name must be at least 2 characters',
    'any.required': 'Business name is required'
  }),
  website: Joi.string().uri().required().messages({
    'string.uri': 'Please provide a valid website URL',
    'any.required': 'Website is required'
  }),
  instagram: Joi.string().pattern(/^@?[\w\.\-]+$/).required().messages({
    'string.pattern.base': 'Please provide a valid Instagram handle',
    'any.required': 'Instagram handle is required'
  }),
  creativeDomains: Joi.array().items(
    Joi.string().valid('photography', 'videography', 'florist', 'planner')
  ).min(1).max(2).required().messages({
    'array.min': 'Please select at least one creative domain',
    'array.max': 'You can select maximum 2 creative domains',
    'any.required': 'Creative domains are required'
  })
});

// Validation middleware functions
const validateRegistration = (req, res, next) => {
  const { error } = registrationSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: error.details.map(detail => ({
        field: detail.path[0],
        message: detail.message
      }))
    });
  }
  next();
};

const validateLogin = (req, res, next) => {
  const { error } = loginSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: error.details.map(detail => ({
        field: detail.path[0],
        message: detail.message
      }))
    });
  }
  next();
};

const validateReferralCode = (req, res, next) => {
  const { error } = referralCodeSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: error.details.map(detail => ({
        field: detail.path[0],
        message: detail.message
      }))
    });
  }
  next();
};

const validatePhoneNumber = (req, res, next) => {
  const { error } = phoneNumberSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: error.details.map(detail => ({
        field: detail.path[0],
        message: detail.message
      }))
    });
  }
  next();
};

const validateOTP = (req, res, next) => {
  const { error } = otpSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: error.details.map(detail => ({
        field: detail.path[0],
        message: detail.message
      }))
    });
  }
  next();
};

const validateProfile = (req, res, next) => {
  const { error } = profileSchema.validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: error.details.map(detail => ({
        field: detail.path[0],
        message: detail.message
      }))
    });
  }
  next();
};

module.exports = {
  validateRegistration,
  validateLogin,
  validateReferralCode,
  validatePhoneNumber,
  validateOTP,
  validateProfile
};