import { handle, json, getSession } from '../../../lib/server.js';

export const onRequestGet = context => handle(context, async () => {
  const user = await getSession(context);
  return json({ user: { username: user.username } });
});
