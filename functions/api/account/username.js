import {handle,bodyJSON,json,getSession,username,fail,rateLimit,randomSecret,passwordHash,secureEqual,cookieHeader,createSession} from '../../../lib/server.js';
import {isPasswordProof,sendNotice} from '../../../lib/email.js';
export const onRequestPost=context=>handle(context,async({env,request})=>{
  const me=await getSession(context);
  await rateLimit(context,'change_username',5,60*60*1000,me.id);
  const data=await bodyJSON(request), newName=username(data.username);
  if(!isPasswordProof(data.currentPassword)||!isPasswordProof(data.newUsernamePassword)) fail(400,'Enter your current password.');
  const user=await env.DB.prepare('SELECT username,email,email_verified_at,password_salt,password_hash FROM users WHERE id=?').bind(me.id).first();
  if(newName===user.username) fail(400,'Choose a different username.');
  const check=await passwordHash(data.currentPassword,user.password_salt);
  if(!secureEqual(check,user.password_hash)) fail(403,'Incorrect current password.');
  const taken=await env.DB.prepare('SELECT id FROM users WHERE username=?').bind(newName).first();
  if(taken) fail(409,'That username is taken.');
  // Password proof is bound to username in the original client. Rehash it for the NEW username.
  const salt=randomSecret(), hash=await passwordHash(data.newUsernamePassword,salt);
  try {
    await env.DB.batch([
      env.DB.prepare('UPDATE users SET username=?,password_salt=?,password_hash=? WHERE id=?').bind(newName,salt,hash,me.id),
      env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(me.id)
    ]);
  } catch(e){if(String(e).includes('UNIQUE')) fail(409,'That username is taken.');throw e;}
  const token=await createSession(env.DB,me.id);
  if(user.email_verified_at) await sendNotice(env,user.email,'ScAry Net — username changed',`Your username was changed from @${user.username} to @${newName}. Your conversations remain attached to the same account.`);
  return json({ok:true,user:{username:newName},message:'Username changed. Use the new username to log in.'},200,{'Set-Cookie':cookieHeader(token)});
});
