import {handle,bodyJSON,json,getSession,fail,rateLimit,randomSecret,passwordHash,secureEqual,cookieHeader,createSession} from '../../../lib/server.js';
import {isPasswordProof,requireNewPassword,sendNotice} from '../../../lib/email.js';
export const onRequestPost=context=>handle(context,async ({env,request})=>{
  const me=await getSession(context);
  await rateLimit(context,'change_password',8,60*60*1000,me.id);
  const data=await bodyJSON(request);
  if(!isPasswordProof(data.currentPassword)) fail(400,'Enter current password.');
  requireNewPassword(data);
  const user=await env.DB.prepare('SELECT username,email,email_verified_at,password_salt,password_hash FROM users WHERE id=?').bind(me.id).first();
  const proof=await passwordHash(data.currentPassword,user.password_salt);
  if(!secureEqual(proof,user.password_hash)) fail(403,'Incorrect current password.');
  if(data.password===data.currentPassword) fail(400,'Choose a different password.');
  const salt=randomSecret(), hash=await passwordHash(data.password,salt);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_salt=?,password_hash=? WHERE id=?').bind(salt,hash,me.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(me.id),
    env.DB.prepare('DELETE FROM recovery_tickets WHERE user_id=?').bind(me.id)
  ]);
  const token=await createSession(env.DB,me.id);
  if(user.email_verified_at) await sendNotice(env,user.email,'ScAry Net — password changed',`Your ScAry Net password for @${user.username} has been changed. If this was not you, start account recovery immediately.`);
  return json({ok:true,message:'Password changed. Other devices have been signed out.'},200,{'Set-Cookie':cookieHeader(token)});
});
