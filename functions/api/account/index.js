import {handle,json,getSession} from '../../../lib/server.js';
export const onRequestGet = context => handle(context, async ({env}) => {
  const auth = await getSession(context);
  const user = await env.DB.prepare('SELECT username,email,email_verified_at FROM users WHERE id=?').bind(auth.id).first();
  return json({user:{username:user.username,email:user.email || '',emailVerified:!!user.email_verified_at}});
});
