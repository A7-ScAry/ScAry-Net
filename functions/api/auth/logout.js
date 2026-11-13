import { handle, json, revokeSession, cookieHeader } from '../../../lib/server.js';

export const onRequestPost = context => handle(context, async () => {
  await revokeSession(context);
  return json({ ok: true }, 200, { 'Set-Cookie': cookieHeader('', true) });
});
