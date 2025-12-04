-- First, delete poll votes on this user's posts (by ANY user)
DELETE FROM poll_votes WHERE post_id IN (SELECT id FROM posts WHERE user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728');

-- Then delete poll votes made BY this user on other posts
DELETE FROM poll_votes WHERE user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728';

-- Delete other post-related data
DELETE FROM post_interactions WHERE user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728';
DELETE FROM comment_interactions WHERE user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728';
DELETE FROM comments WHERE user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728';
DELETE FROM chatroom_identities WHERE user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728';
DELETE FROM notifications WHERE user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728' OR actor_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728';

-- NOW delete the posts
DELETE FROM posts WHERE user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728';

-- Continue with rest
DELETE FROM creative_proposals WHERE creative_user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728';
DELETE FROM creative_inquiries WHERE user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728';
DELETE FROM referral_usage WHERE used_by_user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728';
DELETE FROM points_transactions WHERE user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728';
DELETE FROM otp_codes WHERE user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728';
DELETE FROM email_verification_tokens WHERE user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728';
DELETE FROM password_reset_tokens WHERE user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728';
DELETE FROM onboarding_progress WHERE user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728';
DELETE FROM post_rate_limits WHERE user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728';
DELETE FROM admin_referral_codes WHERE assigned_to_user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728';
DELETE FROM referral_code_audit_log WHERE affected_user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728' OR performed_by_user_id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728';
DELETE FROM users WHERE id = '67ec755f-38d9-4f3d-8e61-6f3008ca8728';