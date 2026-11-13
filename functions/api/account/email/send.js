import {handle,json,getSession,rateLimit,fail} from '../../../../lib/server.js';
import {issueCode} from '../../../../lib/email.js';
export const onRequestPost = context => handle(context, async ({env}) => {
  const me=await getSession(context);
  await rateLimit(context,'send_verification',6,60*60*1000);
  const user=await env.DB.prepare('SELECT id,username,email,email_verified_at FROM users WHERE id=?').bind(me.id).first();
  if (!user.email) fail(400,'Add your email first.');
  if (user.email_verified_at) fail(400,'Your email is already verified.');
  await issueCode(context,user,'verify_email',user.email);
  return json({ok:true,message:'Verification code sent to your email.'});
});
