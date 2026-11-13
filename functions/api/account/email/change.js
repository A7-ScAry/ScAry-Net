import {handle,bodyJSON,json,getSession,rateLimit,fail,passwordHash,secureEqual} from '../../../../lib/server.js';
import {normalizeEmail,issueCode,isPasswordProof} from '../../../../lib/email.js';
export const onRequestPost = context => handle(context, async ({env,request}) => {
  const me=await getSession(context);
  await rateLimit(context,'request_email_change',5,60*60*1000,me.id);
  const data=await bodyJSON(request), email=normalizeEmail(data.email);
  if (!isPasswordProof(data.currentPassword)) fail(400,'Enter your current password.');
  const user=await env.DB.prepare('SELECT id,username,email,password_salt,password_hash FROM users WHERE id=?').bind(me.id).first();
  if (email===user.email) fail(400,'That is already your email.');
  const check=await passwordHash(data.currentPassword,user.password_salt);
  if (!secureEqual(check,user.password_hash)) fail(403,'Incorrect password.');
  const taken=await env.DB.prepare('SELECT id FROM users WHERE email=? AND id!=?').bind(email,me.id).first();
  if (taken) fail(409,'That email is already in use.');
  await issueCode(context,user,'change_email',email);
  return json({ok:true,message:'Confirmation code sent to the new email.'});
});
