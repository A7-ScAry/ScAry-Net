import {handle,bodyJSON,json,getSession,fail} from '../../../../lib/server.js';
import {consumeCode,sendNotice} from '../../../../lib/email.js';
export const onRequestPost = context => handle(context, async ({env,request}) => {
  const me=await getSession(context), data=await bodyJSON(request);
  const purpose=data.purpose==='change_email'?'change_email':'verify_email';
  const row=await consumeCode(env,me.id,purpose,data.code);
  const old=await env.DB.prepare('SELECT email,email_verified_at FROM users WHERE id=?').bind(me.id).first();
  if(purpose==='verify_email') {
    if (old.email!==row.target_email) fail(400,'Email changed; request a new code.');
    await env.DB.prepare('UPDATE users SET email_verified_at=? WHERE id=? AND email=?').bind(Date.now(),me.id,row.target_email).run();
  } else {
    try {
      await env.DB.prepare('UPDATE users SET email=?,email_verified_at=? WHERE id=?')
        .bind(row.target_email,Date.now(),me.id).run();
    } catch(error) {if(String(error).includes('UNIQUE')) fail(409,'That email is already in use.');throw error;}
    if(old.email_verified_at) await sendNotice(env,old.email,'ScAry Net — email address changed',`The recovery email for your account was changed to ${row.target_email}. If this was not you, contact the website owner promptly.`);
  }
  return json({ok:true,message:'Email verified successfully.'});
});
