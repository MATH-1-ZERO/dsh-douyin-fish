import { createHash, randomUUID } from 'node:crypto';
import { efficiency, freshResources, validateResources, budgetView, resourceCommand } from './context.js';
import { manualSettings, manualCommand } from './manual.js';
import {liveVerificationView} from './live-verification.js';

export const kinds = ['browse', 'mention', 'comment', 'dm'];
const day = 86400000;
const copy = x => JSON.parse(JSON.stringify(x));
const fail = message => { throw new Error(message); };
const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const string = (v, max) => typeof v === 'string' && v.length <= max;
const tagsValid = a => Array.isArray(a) && a.length <= 100 && a.every(x => string(x, 80) && x.trim());
const minute = v => {
  if (!string(v, 5) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail('Invalid HH:MM');
  return Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
};

export function validateSettings(c) {
  if (!c || typeof c.enabled !== 'boolean' || !string(c.timeZone, 100)) fail('Invalid settings');
  if (c.scheduleEnabled!==undefined&&typeof c.scheduleEnabled!=='boolean') fail('Invalid schedule enabled flag');
  new Intl.DateTimeFormat('en', { timeZone: c.timeZone });
  if (minute(c.activeStart) === minute(c.activeEnd)) fail('Active window cannot cover 24 hours');
  for (const k of ['sessionMinutes', 'restMinutes']) if (!integer(c[k], 1, 1440)) fail('Invalid ' + k);
  if (!integer(c.outgoingIntervalSeconds, 10, 86400) || !integer(c.outgoingDailyLimit, 0, 100)) fail('Invalid global limits');
  if (!tagsValid(c.likedTags) || !tagsValid(c.blockedTags)) fail('Invalid preference tags');
  if (!string(c.ownerId, 200) || !Array.isArray(c.dmContacts) || c.dmContacts.length > 100 ||
      c.dmContacts.some(x => !string(x, 200) || !x.trim())) fail('Invalid contacts');
  for (const k of kinds) {
    const r = c.rules?.[k];
    if (!r || typeof r.enabled !== 'boolean' || !integer(r.intervalSeconds, 10, 86400) ||
        !integer(r.dailyLimit, 0, 100)) fail('Invalid rule: ' + k);
  }
  efficiency(c);
  manualSettings(c);
  return c;
}

export function freshState() {
  return { version: 1, paused: true, lastTime: 0, sessionStart: null, restUntil: null,
    nextBrowseAt: 0, history: [], queue: [], resources: freshResources() };
}

export function validateState(s) {
  if (!s || s.version !== 1 || typeof s.paused !== 'boolean' ||
      !integer(s.lastTime, 0, 8640000000000000) || !integer(s.nextBrowseAt, 0, 8640000000000000) ||
      ![s.sessionStart, s.restUntil].every(v => v === null || integer(v, 0, 8640000000000000)) ||
      !Array.isArray(s.history) || s.history.length > 2000 ||
      !Array.isArray(s.queue) || s.queue.length > 100) fail('Invalid state; refusing to reset limits');
  for (const h of s.history) if (!h || !kinds.includes(h.kind) ||
      !integer(h.time, 0, s.lastTime) || !/^[a-f0-9]{64}$/.test(h.key)) fail('Invalid history');
  const ids = new Set();
  for (const q of s.queue) {
    if (!q || !string(q.id, 100) || !q.id || ids.has(q.id) || !kinds.includes(q.kind) ||
        !integer(q.time, 0, s.lastTime) || !string(q.target, 2048) || !string(q.text, 2000) ||
        q.status !== 'awaiting_human_review') fail('Invalid queue');
    ids.add(q.id);
  }
  validateResources(s.resources);
  return s;
}

function rhythm(c, s, time) {
  if((s.resources?.persona?.schedule?.enabled??c.scheduleEnabled??true)===false)return null;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: c.timeZone,
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(time);
  const local = Number(parts.find(x => x.type === 'hour').value) * 60 + Number(parts.find(x => x.type === 'minute').value);
  const start = minute(c.activeStart), end = minute(c.activeEnd);
  const active = start < end ? local >= start && local < end : local >= start || local < end;
  if (!active) { s.sessionStart = null; return { reason: 'sleeping' }; }
  if (s.restUntil !== null && time < s.restUntil) return { reason: 'resting', nextEligibleAt: s.restUntil };
  if (s.restUntil !== null) { s.restUntil = null; s.sessionStart = null; }
  if (s.sessionStart !== null && time >= s.sessionStart + c.sessionMinutes * 60000) {
    // Anchor to the original session end. No catch-up actions after downtime.
    s.restUntil = s.sessionStart + (c.sessionMinutes + c.restMinutes) * 60000;
    s.sessionStart = null;
    if (time < s.restUntil) return { reason: 'resting', nextEligibleAt: s.restUntil };
    s.restUntil = null;
  }
  return null;
}

// Recheck after an in-flight read without consuming a second browse slot.
export function browserRunStatus(settings, previous, time=Date.now()) {
  const c=validateSettings(settings), s=copy(validateState(previous));
  if(s.paused||!c.enabled||!c.rules.browse.enabled)return {allowed:false,reason:'paused_or_disabled'};
  if(!integer(time,0,8640000000000000)||time<s.lastTime)return {allowed:false,reason:'clock_rollback'};
  const blocked=rhythm(c,s,time);
  return blocked?{allowed:false,...blocked}:{allowed:true};
}

// Applies to LOCAL rehearsal only. No action in this module calls the browser.
export function transition(settings, previous, command, input = {}, time = Date.now()) {
  const c = validateSettings(settings), s = copy(validateState(previous));
  s.resources ??= freshResources();
  const result = value => ({ state: s, value });
  const deny = (reason, extra = {}) => result({ allowed: false, reason, ...extra });
  if (command === 'pause') { s.paused = true; return result({ paused: true }); }
  if (!integer(time, 0, 8640000000000000)) fail('Invalid time');
  if (time < s.lastTime) return deny('clock_rollback');
  s.lastTime = time;
  // 7-day duplicate window; histories are shared across sessions and restarts.
  s.history = s.history.filter(h => time - h.time < 7 * day);
  if (command === 'status') return result({ mode: c.browser?.enabled ? 'read_only_test_page' : c.manualDrafts?.enabled ? 'manual_drafts' : 'local_rehearsal_only', paused: s.paused,
    pluginVersion:'0.8.0-dev.18',enabled: c.enabled, browserConnected: false, sendingSupported: true,
    sendingScope:'explicit_exact_public_actions_and_verified_owner_dm',automaticSendingEnabled:false,ownerAutomaticReplyConfigured:s.resources.ownerReplies?.enabled===true,ownerDmReadSupported:true,
    ownerAutomaticReplyImplemented:true,ownerAutomaticReplyLiveVerified:liveVerificationView(s).ownerReplyLiveVerified,ownerAutomaticReplyEnabled:s.resources.ownerReplies?.enabled===true,
    developmentMode:s.resources.development?.enabled===true,developmentReads:s.resources.development?.readsTotal??0,
    autonomyEnabled:s.resources.autonomy?.enabled===true,personaImported:!!s.resources.persona,
    autonomousMode:s.resources.autonomy?.deliveryMode==='watch_only'?'watch_only':(s.resources.autonomy?.deliveryMode??'review')==='review'?'browse_and_draft_review':'browse_and_delivery',autonomousDeliveryMode:s.resources.autonomy?.deliveryMode??'review',inboxConnected:false,
    browserReadSupported:true,browserConnectionConfigured:c.browser?.enabled===true,
    manualBrowserReadEnabled:c.manualBrowser?.enabled===true,
    manualBrowserReadReservationsUsed:(s.resources.manualBrowserReads??[]).filter(t=>time-t<day).length,
    browserLiveConnectionChecked:false,
    manualDraftsEnabled:manualSettings(c).enabled,manualDraftCount:s.resources.manualDrafts?.length??0,
    pending: s.queue.length, nextBrowseAt: s.nextBrowseAt, restUntil: s.restUntil,scheduleEnabled:s.resources?.persona?.schedule?.enabled??c.scheduleEnabled??true,
    economy:budgetView(c,s,time) });
  if (command === 'queue') {
    if (input.id !== undefined) {
      if (!string(input.id,100) || !input.id) fail('Invalid draft id');
      return result({ draft:copy(s.queue.find(q => q.id === input.id) ?? null) });
    }
    const offset = input.offset ?? 0, limit = input.limit ?? 3;
    if (!integer(offset,0,100) || !integer(limit,1,5)) fail('Invalid queue page');
    const selected = s.queue.slice(offset,offset+limit);
    return result({ drafts:selected.map(q => ({id:q.id,kind:q.kind,status:q.status,
      targetPreview:[...q.target].slice(0,80).join(''),
      textPreview:[...q.text].slice(0,efficiency(c).snippetCharacters).join('')})),
      total:s.queue.length,nextOffset:offset+selected.length < s.queue.length ? offset+selected.length : null });
  }
  if (['context','observe','record_result'].includes(command))
    return result(resourceCommand(c,s,command,input,time));
  // Explicit local requests are separate from paused autonomous platform tasks.
  // They can draft outside activity hours without resuming browsing or sending.
  if(['manual_help','manual_prepare','manual_finish','manual_queue','manual_discard'].includes(command))
    return result(manualCommand(c,s,command,input,time));
  if (command === 'dismiss') {
    if (!string(input.id, 100) || !input.id) fail('Invalid draft id');
    const before = s.queue.length;
    s.queue = s.queue.filter(q => q.id !== input.id);
    return result({ removed: s.queue.length !== before, limitsReset: false });
  }
  if (command !== 'propose' && command !== 'tick' && command !== 'prepare') fail('Unsupported command');
  if (s.paused || !c.enabled) return deny('paused_or_disabled');
  const blocked = rhythm(c, s, time);
  if (blocked) return deny(blocked.reason, blocked.nextEligibleAt ? { nextEligibleAt: blocked.nextEligibleAt } : {});
  // tick only records a due local rehearsal slot, never actually opens a video.
  const kind = command === 'tick' ? 'browse' : command === 'prepare' ? input.task : input.kind;
  if (!kinds.includes(kind)) fail('Invalid action');
  const rule = c.rules[kind];
  if (!rule.enabled) return deny('action_disabled');
  if (kind === 'browse' && time < s.nextBrowseAt) return deny('cooldown', { nextEligibleAt: s.nextBrowseAt });
  if (command === 'propose') {
    if (!string(input.target, 2048) || !input.target.trim() || !string(input.text, 2000) ||
        !tagsValid(input.tags ?? [])) fail('Invalid candidate');
    if (kind !== 'browse' && !input.text.trim()) fail('Empty outgoing draft');
    if (kind === 'mention' && (!c.ownerId || input.target !== c.ownerId)) return deny('owner_not_confirmed');
    if (kind === 'dm' && (!c.dmContacts.includes(input.target) || input.inReplyTo !== true))
      return deny('contact_or_incoming_message_not_confirmed');
    const tags = (input.tags ?? []).map(x => x.trim().toLowerCase());
    if (c.blockedTags.some(t => tags.includes(t.trim().toLowerCase()))) return deny('blocked_preference');
  }
  const recent = s.history.filter(h => h.kind === kind);
  if (recent.filter(h => time - h.time < day).length >= rule.dailyLimit) return deny('daily_limit');
  if (recent.some(h => time - h.time < rule.intervalSeconds * 1000)) return deny('cooldown');
  if (kind !== 'browse') {
    const outgoing = s.history.filter(h => h.kind !== 'browse');
    if (outgoing.filter(h => time - h.time < day).length >= c.outgoingDailyLimit) return deny('combined_daily_limit');
    if (outgoing.some(h => time - h.time < c.outgoingIntervalSeconds * 1000)) return deny('combined_cooldown');
  }
  if (command === 'prepare') {
    const value = resourceCommand(c,s,command,input,time);
    if (value.allowed && value.cacheHit !== true && s.sessionStart === null) s.sessionStart = time;
    return result(value);
  }
  const text = command === 'tick' ? '' : input.text.trim();
  const target = command === 'tick' ? 'local-schedule-slot:' + time : input.target.trim();
  const key = createHash('sha256').update(JSON.stringify([kind, target, text.normalize('NFKC').replace(/\s+/g, ' ')])).digest('hex');
  if (s.history.some(h => h.key === key)) return deny('duplicate');
  if (command === 'propose' && s.queue.length >= 100) return deny('queue_full');
  if (s.history.length >= 2000) return deny('history_full');
  if (s.sessionStart === null) s.sessionStart = time;
  s.history.push({ kind, time, key });
  if (kind === 'browse') s.nextBrowseAt = time + rule.intervalSeconds * 1000;
  if (command === 'tick') return result({ allowed: true, mode: 'local_rehearsal_only',
    browserActionExecuted: false, nextEligibleAt: s.nextBrowseAt });
  const draft = { id: randomUUID(), kind, target, text, time, status: 'awaiting_human_review' };
  s.queue.push(draft);
  return result({ allowed: true, draft: copy(draft),
    preferenceMatch: c.likedTags.filter(t => (input.tags ?? []).some(x => x.trim().toLowerCase() === t.trim().toLowerCase())) });
}
