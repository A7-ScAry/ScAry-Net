import {handle,bodyJSON,json,rateLimit,fail} from '../../../../lib/server.js';
import {normalizeEmail,consumeCode,createRecoveryTicket} from '../../../../lib/email.js';
export const onRequestPost=context=>handle(context,async({env,request})=>{
  await rateLimit(context,'recover_verify_ip',15,60*60*1000);
  const data=await bodyJSON(request), email=normalizeEmail(data.email);
  const user=await env.DB.prepare('SELECT id,username FROM users WHERE email=? AND email_verified_at IS NOT NULL').bind(email).first();
  if(!user) fail(400,'Invalid or expired code.');
  await consumeCode(env,user.id,'recover',data.code);
  const ticket=await createRecoveryTicket(env,user.id);
  return json({username:user.username,ticket});
});
