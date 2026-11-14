/* ScAry Net: browser-only client. No tracking or external scripts. */
'use strict';
const $ = id => document.getElementById(id);
const state = {
  user: null, mode: 'login', selected: null, selectedGroup: null, chats: [], groups: [], messages: [],
  hasOlder: false, fetching: false, sending: false, loadingOlder: false, version: 0,
};
let messageTimer, chatTimer, toastTimer;

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: options.method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
    body: options.method === 'POST' ? JSON.stringify(options.body || {}) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3200);
}
function normalName(value) { return (value || '').trim().toLowerCase(); }
// Browser-side password stretching lets the Cloudflare *free* Worker keep its
// server-side PBKDF2 CPU usage low. The derived value is password-equivalent:
// it must still be protected by TLS and must never be logged or stored in JS.
async function stretchPassword(rawPassword, name) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(rawPassword), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', iterations: 600000,
    salt: encoder.encode('ScAry Net client password v1:' + name),
  }, key, 256);
  return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
}
function avatarLetter(name) { return (name || '?').charAt(0).toUpperCase(); }
function niceTime(ms) { return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
function previewTime(ms) {
  if (!ms) return '';
  const d = new Date(ms), today = new Date();
  return d.toDateString() === today.toDateString()
    ? niceTime(ms)
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function cursorOf(msg) { return `${msg.createdAt}:${msg.id}`; }
function isMobile() { return window.matchMedia('(max-width: 760px)').matches; }

function setAuthMode(mode) {
  state.mode = mode;
  const isRegister = mode === 'register';
  $('loginTab').classList.toggle('active', !isRegister);
  $('registerTab').classList.toggle('active', isRegister);
  $('loginTab').setAttribute('aria-pressed', String(!isRegister));
  $('registerTab').setAttribute('aria-pressed', String(isRegister));
  $('authTitle').innerHTML = isRegister ? 'Make it yours<span class="green-dot">.</span>' : 'Welcome back<span class="green-dot">.</span>';
  $('authSubtitle').textContent = isRegister ? 'One unique username. A world of conversations.' : 'Pick up where the conversation left off.';
  $('authSubmit').firstChild.textContent = isRegister ? 'Create account ' : 'Log in ';
  $('passwordInput').autocomplete = isRegister ? 'new-password' : 'current-password';
  $('passwordInput').minLength = 8;
  // Keep the login limit at 72 so users with older, longer passwords can still sign in.
  $('passwordInput').maxLength = isRegister ? 25 : 72;
  $('usernameHint').classList.toggle('hidden', !isRegister);
  $('passwordHint').classList.toggle('hidden', !isRegister);
  $('registerEmailField').classList.toggle('hidden', !isRegister);
  $('emailInput').required = isRegister;
  $('forgotButton').classList.toggle('hidden', isRegister);
  $('authError').classList.add('hidden');
}
function showAuth() {
  clearInterval(messageTimer);
  clearInterval(chatTimer);
  state.user = null;
  state.selected = null;
  state.selectedGroup = null;
  state.messages = [];
  state.chats = [];
  state.groups = [];
  $('newGroupScreen').classList.add('hidden');
  $('groupDetailsScreen').classList.add('hidden');
  $('appShell').classList.add('hidden');
  $('appShell').classList.remove('chat-open');
  $('authScreen').classList.remove('hidden');
  $('passwordInput').value = '';
  $('settingsScreen').classList.add('hidden');
  $('recoveryScreen').classList.add('hidden');
}
async function enterApp(user) {
  state.user = user;
  $('myUsername').textContent = '@' + user.username;
  $('myAvatar').textContent = avatarLetter(user.username);
  $('authScreen').classList.add('hidden');
  $('appShell').classList.remove('hidden');
  await loadChats();
  clearInterval(messageTimer);
  clearInterval(chatTimer);
  messageTimer = setInterval(() => {
    if (!document.hidden && (state.selected || state.selectedGroup) && (!isMobile() || $('appShell').classList.contains('chat-open'))) {
      pollMessages().catch(onBackgroundError);
    }
  }, 8000);
  chatTimer = setInterval(() => {
    if (!document.hidden) loadChats().catch(onBackgroundError);
  }, 20000);
}
function onBackgroundError(error) {
  if (error.status === 401) showAuth();
  else console.warn('ScAry Net: connection issue.', error.message);
}

function renderChats() {
  const list = $('chatList');
  list.replaceChildren();
  const all = [
    ...state.chats.map(chat => ({ ...chat, kind: 'direct' })),
    ...state.groups.map(group => ({ ...group, kind: 'group' }))
  ].sort((a,b) => b.updatedAt - a.updatedAt);
  if (!all.length) {
    const empty = document.createElement('div');
    empty.className = 'chat-list-empty';
    empty.textContent = 'No chats yet. Start a conversation or create a group.';
    list.append(empty);
    return;
  }
  for (const chat of all) {
    const isGroup = chat.kind === 'group';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chat-item' + (isGroup ? ' group-chat' : '');
    if (isGroup ? state.selectedGroup?.id === chat.id : state.selected === chat.username) button.classList.add('selected');
    button.setAttribute('aria-label', isGroup ? `Open group ${chat.name}` : `Open chat with ${chat.username}`);
    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    avatar.textContent = isGroup ? '👥' : avatarLetter(chat.username);
    const body = document.createElement('div');
    body.className = 'chat-text';
    const heading = document.createElement('div');
    heading.className = 'chat-mainline';
    const title = document.createElement('strong');
    title.textContent = isGroup ? chat.name : '@' + chat.username;
    const date = document.createElement('time');
    date.textContent = previewTime(chat.updatedAt);
    heading.append(title, date);
    const preview = document.createElement('p');
    preview.className = 'chat-preview';
    preview.textContent = isGroup
      ? (chat.lastBody ? `${chat.sentByMe ? 'You' : '@' + (chat.lastSender || 'member')}: ${chat.lastBody}` : `Group · ${chat.memberCount} members`)
      : (chat.sentByMe ? 'You: ' : '') + chat.lastBody;
    body.append(heading, preview);
    button.append(avatar, body);
    button.addEventListener('click', () => isGroup ? openGroup(chat) : openChat(chat.username));
    list.append(button);
  }
}
async function loadChats() {
  if (!state.user) return;
  const data = await api('/api/chats');
  if (!state.user) return;
  state.chats = data.chats || [];
  state.groups = data.groups || [];
  if (state.selectedGroup) {
    const current = state.groups.find(g => g.id === state.selectedGroup.id);
    if (!current) { closeActiveConversation(); toast('You are no longer in this group.'); }
    else {state.selectedGroup = { ...state.selectedGroup, ...current }; $('conversationSubtitle').textContent = `Group · ${current.memberCount} members`;}
  }
  renderChats();
}
function closeActiveConversation() {
  state.selected = null;
  state.selectedGroup = null;
  state.version++;
  state.messages = [];
  $('conversationPane').classList.add('hidden');
  $('emptyPane').classList.remove('hidden');
  $('appShell').classList.remove('chat-open');
  $('groupInfoButton').classList.add('hidden');
  $('groupDetailsScreen').classList.add('hidden');
}
function messageEndpoint() {
  return state.selectedGroup ? `/api/groups/${encodeURIComponent(state.selectedGroup.id)}/messages`
    : '/api/messages?username=' + encodeURIComponent(state.selected);
}
function showNewChat() {
  $('newChatForm').classList.remove('hidden');
  $('newChatUsername').focus();
}
function openChat(username) {
  state.selectedGroup = null;
  state.selected = username;
  state.messages = [];
  state.hasOlder = false;
  state.version++;
  const v = state.version;
  $('peerUsername').textContent = '@' + username;
  $('peerAvatar').textContent = avatarLetter(username);
  $('peerAvatar').classList.remove('group-peer-avatar');
  $('conversationSubtitle').textContent = 'Direct message';
  $('groupInfoButton').classList.add('hidden');
  $('emptyPane').classList.add('hidden');
  $('conversationPane').classList.remove('hidden');
  $('appShell').classList.add('chat-open');
  $('newChatForm').classList.add('hidden');
  $('messageInput').value = '';
  updateComposer();
  renderChats();
  renderMessages();
  loadInitialMessages(v).catch(err => { if (v === state.version) toast(err.message); });
  $('messageInput').focus();
}
function openGroup(group) {
  state.selectedGroup = { ...group };
  state.selected = null;
  state.messages = [];
  state.hasOlder = false;
  state.version++;
  const v = state.version;
  $('peerUsername').textContent = group.name;
  $('peerAvatar').textContent = '👥';
  $('peerAvatar').classList.add('group-peer-avatar');
  $('conversationSubtitle').textContent = `Group · ${group.memberCount} members`;
  $('groupInfoButton').classList.remove('hidden');
  $('emptyPane').classList.add('hidden');
  $('conversationPane').classList.remove('hidden');
  $('appShell').classList.add('chat-open');
  $('newChatForm').classList.add('hidden');
  $('messageInput').value = '';
  updateComposer();
  renderChats();
  renderMessages();
  loadInitialMessages(v).catch(err => { if (v === state.version) toast(err.message); });
  $('messageInput').focus();
}
async function loadInitialMessages(version) {
  const data = await api(messageEndpoint());
  if (version !== state.version) return;
  state.messages = data.messages || [];
  state.hasOlder = !!data.hasMore;
  renderMessages();
  scrollBottom();
}
function dateLabel(ts) {
  const date = new Date(ts);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}
function renderMessages() {
  const list = $('messagesList');
  list.replaceChildren();
  $('loadOlder').classList.toggle('hidden', !state.hasOlder);
  if (!state.messages.length) {
    const empty = document.createElement('div');
    empty.className = 'no-messages';
    const icon = document.createElement('span'); icon.className = 'hello'; icon.textContent = '✳';
    const title = document.createElement('strong'); title.textContent = state.selectedGroup
      ? `Say hello to ${state.selectedGroup.name}` : `Say hello to @${state.selected || 'someone'}`;
    const text = document.createElement('p'); text.textContent = 'Your conversation starts with a single message.';
    empty.append(icon, title, text);
    list.append(empty);
    return;
  }
  let lastDay = '';
  for (const msg of state.messages) {
    const day = new Date(msg.createdAt).toDateString();
    if (day !== lastDay) {
      const divider = document.createElement('div');
      divider.className = 'date-divider';
      divider.textContent = dateLabel(msg.createdAt);
      list.append(divider);
      lastDay = day;
    }
    const row = document.createElement('div');
    row.className = 'message' + (msg.mine ? ' mine' : '');
    const bubble = document.createElement('div'); bubble.className = 'message-bubble';
    if (state.selectedGroup && !msg.mine) {
      const sender = document.createElement('span');
      sender.className = 'group-message-sender';
      sender.textContent = '@' + msg.sender;
      bubble.append(sender);
    }
    bubble.append(document.createTextNode(msg.body));
    const time = document.createElement('time');
    time.className = 'message-time';
    time.dateTime = new Date(msg.createdAt).toISOString();
    time.textContent = niceTime(msg.createdAt);
    row.append(bubble, time);
    list.append(row);
  }
}
function scrollBottom() {
  const vp = $('messagesViewport');
  requestAnimationFrame(() => { vp.scrollTop = vp.scrollHeight; });
}
async function pollMessages() {
  if ((!state.selected && !state.selectedGroup) || state.fetching) return;
  state.fetching = true;
  const version = state.version;
  const last = state.messages.at(-1);
  try {
    const endpoint = messageEndpoint();
    const join = endpoint.includes('?') ? '&' : '?';
    const data = await api(last ? endpoint + join + 'after=' + encodeURIComponent(cursorOf(last)) : endpoint);
    if (version !== state.version) return;
    const known = new Set(state.messages.map(m => m.id));
    const incoming = (data.messages || []).filter(m => !known.has(m.id));
    if (incoming.length) {
      const vp = $('messagesViewport');
      const nearBottom = vp.scrollHeight - vp.scrollTop - vp.clientHeight < 160;
      state.messages.push(...incoming);
      state.messages.sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      renderMessages();
      if (nearBottom) scrollBottom();
      else toast(`${incoming.length} new message${incoming.length > 1 ? 's' : ''}`);
    }
  } finally { state.fetching = false; }
}
async function loadOlder() {
  if (!state.hasOlder || state.loadingOlder || !state.messages.length) return;
  state.loadingOlder = true;
  const version = state.version;
  const viewport = $('messagesViewport');
  const previousHeight = viewport.scrollHeight;
  const previousTop = viewport.scrollTop;
  try {
    const endpoint = messageEndpoint();
    const join = endpoint.includes('?') ? '&' : '?';
    const data = await api(endpoint + join + 'before=' + encodeURIComponent(cursorOf(state.messages[0])));
    if (version !== state.version) return;
    const old = data.messages || [];
    const known = new Set(state.messages.map(m => m.id));
    state.messages.unshift(...old.filter(m => !known.has(m.id)));
    state.hasOlder = !!data.hasMore;
    renderMessages();
    requestAnimationFrame(() => { viewport.scrollTop = previousTop + viewport.scrollHeight - previousHeight; });
  } catch (e) { toast(e.message); }
  finally { state.loadingOlder = false; }
}
function updateComposer() {
  const field = $('messageInput');
  field.style.height = 'auto';
  field.style.height = Math.min(field.scrollHeight, 160) + 'px';
  const count = Array.from(field.value).length;
  $('messageLength').textContent = `${count}/1000`;
  $('sendButton').disabled = !field.value.trim() || count > 1000 || state.sending;
}
async function sendMessage(event) {
  event.preventDefault();
  if ((!state.selected && !state.selectedGroup) || state.sending) return;
  const text = $('messageInput').value.trim();
  if (!text) return;
  if (Array.from(text).length > 1000) { toast('Please keep messages under 1000 characters.'); return; }
  const name = state.selected, group = state.selectedGroup, version = state.version;
  state.sending = true;
  updateComposer();
  try {
    const data = group
      ? await api(`/api/groups/${encodeURIComponent(group.id)}/messages`, { method: 'POST', body: { text } })
      : await api('/api/send', { method: 'POST', body: { to: name, text } });
    if (version === state.version) {
      const known = state.messages.some(msg => msg.id === data.message.id);
      if (!known) state.messages.push(data.message);
      state.messages.sort((a,b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      renderMessages();
      scrollBottom();
      if ($('messageInput').value.trim() === text) $('messageInput').value = '';
    }
    loadChats().catch(onBackgroundError);
  } catch (e) { toast(e.message); if (e.status === 401) showAuth(); }
  finally { state.sending = false; updateComposer(); }
}


// Group creation and members. The original direct-message flow remains intact.
function groupFeedback(id, text, error = false) { feedback(id, text, error); }
function openNewGroup() {
  $('newGroupScreen').classList.remove('hidden');
  groupFeedback('createGroupFeedback', '');
  $('groupNameInput').focus();
}
function closeNewGroup() { $('newGroupScreen').classList.add('hidden'); }
function closeGroupDetails() { $('groupDetailsScreen').classList.add('hidden'); }
async function refreshGroupDetails() {
  if (!state.selectedGroup) return;
  const groupId = state.selectedGroup.id;
  const data = await api(`/api/groups/${encodeURIComponent(groupId)}/info`);
  if (!state.selectedGroup || state.selectedGroup.id !== groupId) return;
  const group = data.group;
  $('groupDetailsTitle').textContent = group.name;
  $('groupDetailsCaption').textContent = `${group.members.length} members · ${group.isAdmin ? 'You are the admin' : 'Only admins can add or remove members'}`;
  $('addGroupMemberForm').classList.toggle('hidden', !group.isAdmin || group.members.length >= 30);
  const memberList = $('groupMemberList');
  memberList.replaceChildren();
  for (const member of group.members) {
    const row = document.createElement('div'); row.className = 'group-member';
    const name = document.createElement('span'); name.className = 'member-label'; name.textContent = '@' + member.username;
    const role = document.createElement('span'); role.className = 'member-role'; role.textContent = member.role === 'admin' ? 'Admin' : '';
    row.append(name, role);
    if (group.isAdmin && member.username !== state.user.username) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-member'; remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        if (!confirm(`Remove @${member.username} from this group?`)) return;
        remove.disabled = true;
        groupFeedback('groupDetailsFeedback', '');
        try {
          await api(`/api/groups/${encodeURIComponent(groupId)}/members`, { method:'POST', body:{ action:'remove', username:member.username } });
          await Promise.all([refreshGroupDetails(), loadChats()]);
          toast(`Removed @${member.username}`);
        } catch(err) { groupFeedback('groupDetailsFeedback', err.message, true); remove.disabled = false; }
      });
      row.append(remove);
    }
    memberList.append(row);
  }
}
$('createGroupButton').addEventListener('click', openNewGroup);
$('closeNewGroup').addEventListener('click', closeNewGroup);
$('closeGroupDetails').addEventListener('click', closeGroupDetails);
$('newGroupScreen').addEventListener('click', e => { if (e.target === $('newGroupScreen')) closeNewGroup(); });
$('groupDetailsScreen').addEventListener('click', e => { if (e.target === $('groupDetailsScreen')) closeGroupDetails(); });
$('createGroupForm').addEventListener('submit', event => {
  event.preventDefault();
  withForm('createGroupForm', 'createGroupFeedback', async () => {
    const name = $('groupNameInput').value.trim();
    const members = $('groupMembersInput').value.split(',').map(v => normalName(v)).filter(Boolean);
    const data = await api('/api/groups', {method:'POST', body:{name,members}});
    $('groupNameInput').value = '';
    $('groupMembersInput').value = '';
    closeNewGroup();
    await loadChats();
    openGroup(data.group);
    toast('Group created!');
  });
});
$('groupInfoButton').addEventListener('click', async () => {
  $('groupDetailsScreen').classList.remove('hidden');
  groupFeedback('groupDetailsFeedback', '');
  try { await refreshGroupDetails(); } catch(err) {groupFeedback('groupDetailsFeedback', err.message, true);}
});
$('addGroupMemberForm').addEventListener('submit', event => {
  event.preventDefault();
  withForm('addGroupMemberForm', 'groupDetailsFeedback', async () => {
    if (!state.selectedGroup) throw new Error('Select a group first.');
    const name = normalName($('addGroupMemberName').value);
    await api(`/api/groups/${encodeURIComponent(state.selectedGroup.id)}/members`, {method:'POST',body:{action:'add',username:name}});
    $('addGroupMemberName').value = '';
    await Promise.all([refreshGroupDetails(), loadChats()]);
    toast(`Added @${name}`);
  });
});
$('leaveGroupButton').addEventListener('click', async () => {
  if (!state.selectedGroup || !confirm('Leave this group? You will no longer see its messages.')) return;
  $('leaveGroupButton').disabled = true;
  groupFeedback('groupDetailsFeedback', '');
  try {
    await api(`/api/groups/${encodeURIComponent(state.selectedGroup.id)}/members`, {method:'POST',body:{action:'leave'});
    closeActiveConversation();
    await loadChats();
    toast('You left the group.');
  } catch(err) { groupFeedback('groupDetailsFeedback', err.message, true); }
  finally { $('leaveGroupButton').disabled = false; }
});

// Email recovery and self-service account changes. Password proofs are derived on-device.
let recoveryTicket = null;
let recoveryName = null;
let pendingEmailPurpose = 'verify_email';
function feedback(element, message, error=false) {
  $(element).textContent = message;
  $(element).classList.toggle('is-error', error);
}
function openRecovery() {
  $('recoveryScreen').classList.remove('hidden');
  $('recoveryRequestForm').classList.remove('hidden');
  $('recoveryVerifyForm').classList.add('hidden');
  $('recoveryResetForm').classList.add('hidden');
  recoveryTicket=null;
  recoveryName=null;
  feedback('recoveryFeedback','');
  $('recoverEmail').value = $('emailInput').value || '';
  $('recoverEmail').focus();
}
function closeRecovery() { $('recoveryScreen').classList.add('hidden'); }
async function loadAccount() {
  const result=await api('/api/account');
  state.user=result.user;
  const user=result.user;
  $('emailStatus').textContent = user.email
    ? `Email: ${user.email} — ${user.emailVerified?'Verified ✓':'Not verified yet. Check your email for the code.'}`
    : 'No email yet. Add and verify one below to enable account recovery.';
  $('resendVerify').classList.toggle('hidden', !user.email || user.emailVerified);
  if (!user.email) $('newEmailInput').placeholder = 'Add an email';
  $('myUsername').textContent='@'+user.username;
  $('myAvatar').textContent=avatarLetter(user.username);
  return user;
}
async function openSettings(){
  $('settingsScreen').classList.remove('hidden');
  feedback('settingsFeedback','');
  try { await loadAccount(); }
  catch(error) { feedback('settingsFeedback',error.message,true); }
}
function closeSettings() { $('settingsScreen').classList.add('hidden'); }
async function withForm(formId, feedbackId, run) {
  const form=$(formId);
  const button=form.querySelector('button[type="submit"]');
  if (button) button.disabled=true;
  feedback(feedbackId,'');
  try { await run(); }
  catch(error){feedback(feedbackId,error.message,true);}
  finally { if(button) button.disabled=false; }
}
$('forgotButton').addEventListener('click',openRecovery);
$('closeRecovery').addEventListener('click',closeRecovery);
$('settingsButton').addEventListener('click',()=>openSettings());
$('closeSettings').addEventListener('click',closeSettings);
$('recoveryScreen').addEventListener('click', event=>{if(event.target===$('recoveryScreen')) closeRecovery();});
$('settingsScreen').addEventListener('click', event=>{if(event.target===$('settingsScreen')) closeSettings();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeRecovery();closeSettings();closeNewGroup();closeGroupDetails();}});
$('updatedUsername').addEventListener('input',event=>{event.target.value=event.target.value.toLowerCase();});
$('recoveryRequestForm').addEventListener('submit',event=>{
  event.preventDefault();
  withForm('recoveryRequestForm','recoveryFeedback', async()=>{
    const data=await api('/api/auth/recovery/request',{method:'POST',body:{email:$('recoverEmail').value}});
    $('recoveryRequestForm').classList.add('hidden');
    $('recoveryVerifyForm').classList.remove('hidden');
    feedback('recoveryFeedback',data.message);
    $('recoverCode').focus();
  });
});
$('retryRecovery').addEventListener('click',openRecovery);
$('recoveryVerifyForm').addEventListener('submit',event=>{
  event.preventDefault();
  withForm('recoveryVerifyForm','recoveryFeedback', async()=>{
    const data=await api('/api/auth/recovery/verify',{method:'POST',body:{email:$('recoverEmail').value,code:$('recoverCode').value.trim()}});
    recoveryName=data.username;
    recoveryTicket=data.ticket;
    $('recoveredUsername').textContent='@'+data.username;
    $('recoveryVerifyForm').classList.add('hidden');
    $('recoveryResetForm').classList.remove('hidden');
    feedback('recoveryFeedback','Verified. Choose a new password below.');
    $('recoverNewPassword').focus();
  });
});
$('recoveryResetForm').addEventListener('submit',event=>{
  event.preventDefault();
  withForm('recoveryResetForm','recoveryFeedback', async()=>{
    const pw=$('recoverNewPassword').value;
    if(pw.length<8||pw.length>25) throw new Error('Use 8–25 characters.');
    const proof=await stretchPassword(pw,recoveryName);
    await api('/api/auth/recovery/reset',{method:'POST',body:{ticket:recoveryTicket,password:proof,passwordLength:pw.length}});
    recoveryTicket=null;
    $('usernameInput').value=recoveryName;
    $('passwordInput').value='';
    setAuthMode('login');
    closeRecovery();
    toast('Password reset! Sign in using your new password.');
  });
});
$('resendVerify').addEventListener('click', async()=>{
  feedback('settingsFeedback','Sending code…');
  try {
    await api('/api/account/email/send',{method:'POST'});
    pendingEmailPurpose='verify_email';
    feedback('settingsFeedback','8-digit code sent to your email.');
  }catch(error){feedback('settingsFeedback',error.message,true);}
});
$('changeEmailForm').addEventListener('submit',event=>{
  event.preventDefault();
  withForm('changeEmailForm','settingsFeedback',async()=>{
    const current=await stretchPassword($('emailCurrentPassword').value,state.user.username);
    await api('/api/account/email/change',{method:'POST',body:{email:$('newEmailInput').value,currentPassword:current}});
    pendingEmailPurpose='change_email';
    $('emailCurrentPassword').value='';
    feedback('settingsFeedback','Check your NEW email. Enter the code below to confirm the change.');
    $('verifyEmailCode').focus();
  });
});
$('verifyEmailForm').addEventListener('submit',event=>{
  event.preventDefault();
  withForm('verifyEmailForm','settingsFeedback',async()=>{
    await api('/api/account/email/confirm',{method:'POST',body:{code:$('verifyEmailCode').value.trim(),purpose:pendingEmailPurpose}});
    $('verifyEmailCode').value='';
    pendingEmailPurpose='verify_email';
    await loadAccount();
    feedback('settingsFeedback','Your email is now verified.');
  });
});
$('changeUsernameForm').addEventListener('submit',event=>{
  event.preventDefault();
  withForm('changeUsernameForm','settingsFeedback',async()=>{
    const oldName=state.user.username, newName=normalName($('updatedUsername').value);
    const pw=$('usernameCurrentPassword').value;
    const oldProof=await stretchPassword(pw,oldName);
    const newProof=await stretchPassword(pw,newName);
    const data=await api('/api/account/username',{method:'POST',body:{username:newName,currentPassword:oldProof,newUsernamePassword:newProof}});
    $('usernameCurrentPassword').value='';
    state.user.username=data.user.username;
    await loadAccount();
    feedback('settingsFeedback',data.message);
  });
});
$('changePasswordForm').addEventListener('submit',event=>{
  event.preventDefault();
  withForm('changePasswordForm','settingsFeedback',async()=>{
    const name=state.user.username;
    const oldPw=$('passwordCurrentPassword').value, newPw=$('updatedPassword').value;
    if(newPw.length<8||newPw.length>25) throw new Error('Use 8–25 characters.');
    const current=await stretchPassword(oldPw,name);
    const replacement=await stretchPassword(newPw,name);
    const data=await api('/api/account/password',{method:'POST',body:{currentPassword:current,password:replacement,passwordLength:newPw.length}});
    $('passwordCurrentPassword').value='';
    $('updatedPassword').value='';
    feedback('settingsFeedback',data.message);
  });
});

$('loginTab').addEventListener('click', () => setAuthMode('login'));
$('registerTab').addEventListener('click', () => setAuthMode('register'));
// Make typed usernames lowercase immediately, including when finding someone to chat with.
for (const id of ['usernameInput', 'newChatUsername']) {
  $(id).addEventListener('input', event => {
    const input = event.currentTarget;
    if (input.value !== input.value.toLowerCase()) input.value = input.value.toLowerCase();
  });
}
$('passwordToggle').addEventListener('click', () => {
  const pw = $('passwordInput');
  const show = pw.type === 'password';
  pw.type = show ? 'text' : 'password';
  $('passwordToggle').textContent = show ? 'Hide' : 'Show';
  $('passwordToggle').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});
$('authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('authSubmit');
  $('authError').classList.add('hidden');
  button.disabled = true;
  try {
    const name = normalName($('usernameInput').value);
    const rawPassword = $('passwordInput').value;
    const maxPasswordLength = state.mode === 'register' ? 25 : 72;
    if (rawPassword.length < 8 || rawPassword.length > maxPasswordLength) {
      throw new Error(state.mode === 'register'
        ? 'Use a password between 8 and 25 characters.'
        : 'Invalid username or password.');
    }
    const derivedPassword = await stretchPassword(rawPassword, name);
    const authBody = { username: name, password: derivedPassword };
    if (state.mode === 'register') {
      authBody.passwordLength = rawPassword.length;
      authBody.email = $('emailInput').value.trim().toLowerCase();
    }
    const data = await api('/api/auth/' + state.mode, {
      method: 'POST', body: authBody
    });
    await enterApp(data.user);
    if (state.mode === 'register') {
      toast(data.verificationSent ? 'Verification code sent. Verify your email in Settings.' : 'Account created. Open Settings to send a verification code.');
      openSettings().catch(error => toast(error.message));
    }
  } catch (e) {
    $('authError').textContent = e.message;
    $('authError').classList.remove('hidden');
  } finally { button.disabled = false; }
});
$('logoutButton').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST' });
    showAuth();
  } catch (e) { toast('Could not log out. Please check your connection and retry.'); }
});
$('newChatButton').addEventListener('click', () => {
  $('newChatForm').classList.toggle('hidden');
  $('newChatError').classList.add('hidden');
  if (!$('newChatForm').classList.contains('hidden')) $('newChatUsername').focus();
});
$('emptyNewChat').addEventListener('click', showNewChat);
$('newChatForm').addEventListener('submit', async event => {
  event.preventDefault();
  const name = normalName($('newChatUsername').value);
  $('newChatError').classList.add('hidden');
  try {
    const data = await api('/api/users/lookup?username=' + encodeURIComponent(name));
    $('newChatUsername').value = '';
    openChat(data.username);
  } catch (e) {
    $('newChatError').textContent = e.message;
    $('newChatError').classList.remove('hidden');
  }
});
$('backButton').addEventListener('click', () => $('appShell').classList.remove('chat-open'));
$('sendForm').addEventListener('submit', sendMessage);
$('messageInput').addEventListener('input', updateComposer);
$('messageInput').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $('sendForm').requestSubmit();
  }
});
$('loadOlder').addEventListener('click', loadOlder);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.user) {
    loadChats().catch(onBackgroundError);
    if (state.selected || state.selectedGroup) pollMessages().catch(onBackgroundError);
  }
});
(async () => {
  try {
    const data = await api('/api/auth/me');
    await enterApp(data.user);
  } catch (e) {
    showAuth();
    // If the database isn't configured yet, the login form displays the API error on submit.
  }
})();
