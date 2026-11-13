import {handle,bodyJSON,json,rateLimit} from '../../../../lib/server.js';
import {normalizeEmail,issueCode,requireEmailConfig} from '../../../../lib/email.js';
export const onRequestPost=context=>handle(context,async({env,request})=>{
  requireEmailConfig(env);
  const data=await bodyJSON(request), email=normalizeEmail(data.email);
  await rateLimit(context,'recover_ip',7,60*60*1000);
  await rateLimit(context,'recover_email',4,60*60*1000,email);
  const user=await env.DB.prepare('SELECT id,username,email FROM users WHERE email=? AND email_verified_at IS NOT NULL').bind(email).first();
  if(user) {try {await issueCode(context,user,'recover',email);} catch(e){console.warn('Recovery email not delivered.');}}
  return json({ok:true,message:'If this email is verified on ScAry Net, a recovery message with your username and code is on its way.'});
});
