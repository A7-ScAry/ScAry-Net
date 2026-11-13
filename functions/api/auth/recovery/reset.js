import {handle,bodyJSON,json,rateLimit,fail,sha256,randomSecret,passwordHash} from '../../../../lib/server.js';
import {requireNewPassword} from '../../../../lib/email.js';
export const onRequestPost=context=>handle(context,async({env,request})=>{
  await rateLimit(context,'recover_reset_ip',12,60*60*1000);
  const data=await bodyJSON(request);
  if(typeof data.ticket!=='string'||!/^[0-9a-f]{64}$/.test(data.ticket)) fail(400,'Recovery session expired. Request a new code.');
  requireNewPassword(data);
  const hashTicket=await sha256(data.ticket);
  const row=await env.DB.prepare('SELECT user_id FROM recovery_tickets WHERE token_hash=? AND expires_at>?').bind(hashTicket,Date.now()).first();
  if(!row) fail(400,'Recovery session expired. Request a new code.');
  const salt=randomSecret(), password=await passwordHash(data.password,salt);
  // Consume ticket, revoke old logins and change password in one batch.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM recovery_tickets WHERE user_id=?').bind(row.user_id),
    env.DB.prepare('UPDATE users SET password_salt=?,password_hash=? WHERE id=?').bind(salt,password,row.user_id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(row.user_id)
  ]);
  return json({ok:true,message:'Password reset. Sign in with your username and new password.'});
});
