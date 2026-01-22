// test-email.js
require('dotenv').config();
const emailService = require('./emailService');

async function testEmail() {
  console.log('🔍 Environment Check:');
  console.log('PLUNK_API_KEY:', process.env.PLUNK_API_KEY ? '✅ Set' : '❌ Not Set');
  console.log('EMAIL_USER:', process.env.EMAIL_USER || '❌ Not Set');
  console.log('BACKEND_URL:', process.env.BACKEND_URL || '❌ Not Set');
  console.log('');

  if (!process.env.PLUNK_API_KEY) {
    console.error('❌ PLUNK_API_KEY is not set in .env file!');
    console.log('📝 Please add: PLUNK_API_KEY=your_secret_key_here');
    return;
  }

  try {
    console.log('📧 Sending test email...');
    const result = await emailService.sendEmailVerification(
      'talhaboss60@gmail.com', // Replace with your email
      'test-token-123'
    );
    console.log('✅ Test Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ Test Failed:', error.message);
    console.error('Full Error:', error);
  }
}

testEmail();
