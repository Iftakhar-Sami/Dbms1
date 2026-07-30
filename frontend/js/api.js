/* =========================================================
   Sports Week — API layer
   Every fetch() call to the Express backend lives here.
   Exposes a single global: window.Api

   NOTE ON AUTH: the backend reads the logged-in user from the
   `x-user-id` header (see authMiddleware.js). Once a UID is set
   here, it is attached to every request — harmless on public
   routes, required on gated ones (isAdmin / isMatchManager).
========================================================= */

(function () {
  'use strict';

  const LS_API_BASE = 'sw_api_base';
  const LS_UID       = 'sw_uid';
  const LS_ROLE      = 'sw_role';
  const DEFAULT_API_BASE = 'http://localhost:3000/api';

  /* ---------------------------------------------------------
     API base URL
  --------------------------------------------------------- */
  function getApiBase() {
    return localStorage.getItem(LS_API_BASE) || DEFAULT_API_BASE;
  }
  function setApiBase(url) {
    const clean = String(url || '').trim().replace(/\/+$/, '');
    localStorage.setItem(LS_API_BASE, clean || DEFAULT_API_BASE);
  }

  /* ---------------------------------------------------------
     Session (uid + role, read at login time)
  --------------------------------------------------------- */
  function getSession() {
    const uid = localStorage.getItem(LS_UID);
    const role = localStorage.getItem(LS_ROLE);
    return uid ? { uid, role: role || 'STUDENT' } : null;
  }
  function setSession(uid, role) {
    localStorage.setItem(LS_UID, String(uid));
    localStorage.setItem(LS_ROLE, role);
  }
  function clearSession() {
    localStorage.removeItem(LS_UID);
    localStorage.removeItem(LS_ROLE);
  }

  /* ---------------------------------------------------------
     Core request helper
  --------------------------------------------------------- */
  async function request(path, { method = 'GET', body, uidOverride } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const uid = uidOverride !== undefined ? uidOverride : getSession()?.uid;
    if (uid) headers['x-user-id'] = uid;

    let res;
    try {
      res = await fetch(`${getApiBase()}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (networkErr) {
      const err = new Error(`Could not reach the API at ${getApiBase()}. Is the backend running?`);
      err.cause = networkErr;
      throw err;
    }

    let data = null;
    try { data = await res.json(); } catch (_) { /* empty/non-JSON body */ }

    if (!res.ok) {
      const message = (data && (data.error || data.message)) || `Request failed (${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  /* ---------------------------------------------------------
     Login probe
     There is no dedicated "who am I" endpoint on the backend,
     so role is derived from an admin-gated route's response:
       401 -> uid does not exist in Users
       403 -> uid exists, role = STUDENT
       200 -> uid exists, role = ADMIN (bonus: audit logs preloaded)
  --------------------------------------------------------- */
  async function probeLogin(uid) {
    const headers = { 'Content-Type': 'application/json', 'x-user-id': uid };
    let res;
    try {
      res = await fetch(`${getApiBase()}/admin/audit-logs`, { headers });
    } catch (networkErr) {
      const err = new Error(`Could not reach the API at ${getApiBase()}. Is the backend running?`);
      err.cause = networkErr;
      throw err;
    }
    if (res.status === 401) {
      const err = new Error('No user found with that UID.');
      err.status = 401;
      throw err;
    }
    if (res.status === 403) {
      return { uid: String(uid), role: 'STUDENT', auditLogs: null };
    }
    if (res.ok) {
      const data = await res.json().catch(() => null);
      return { uid: String(uid), role: 'ADMIN', auditLogs: data };
    }
    const err = new Error('Unexpected response from the server while signing in.');
    err.status = res.status;
    throw err;
  }

  /* ---------------------------------------------------------
     Endpoint map — mirrors backend/routes exactly
  --------------------------------------------------------- */
  window.Api = {
    getApiBase, setApiBase,
    getSession, setSession, clearSession,
    probeLogin,

    // Events
    getEvents: () => request('/events'),
    getEventReport: (eventId) => request(`/events/${eventId}/report`),
    registerSolo: (event_id, uid) =>
      request('/events/register-solo', { method: 'POST', body: { event_id, uid } }),

    // Teams
    registerTeam: (event_id, team_name, uids) =>
      request('/teams/register', { method: 'POST', body: { event_id, team_name, uids } }),

    // Managers
    assignManager: (uid, event_id) =>
      request('/managers', { method: 'POST', body: { uid, event_id } }),

    // Matches
    createMatch: ({ event_id, stage, start_time, end_time, venue }) =>
      request('/matches', { method: 'POST', body: { event_id, stage, start_time, end_time, venue } }),
    addParticipant: (match_id, participation_id) =>
      request('/matches/participants', { method: 'POST', body: { match_id, participation_id } }),
    safeAddParticipant: (match_id, participation_id) =>
      request('/matches/participants/safe-add', { method: 'POST', body: { match_id, participation_id } }),
    updateScore: ({ match_id, participation_id, score, is_winner }) =>
      request('/matches/score', { method: 'PUT', body: { match_id, participation_id, score, is_winner } }),
    completeMatch: (matchId) =>
      request(`/matches/${matchId}/complete`, { method: 'POST' }),

    // Users
    getSchedule: (uid) => request(`/users/${uid}/schedule`),

    // Seasons
    getLeaderboard: (seasonId) => request(`/seasons/${seasonId}/leaderboard`),

    // Admin
    updateRegistrationStatus: (participationId, status) =>
      request(`/admin/participation/${participationId}/status`, { method: 'PUT', body: { status } }),
    getAuditLogs: () => request('/admin/audit-logs'),
  };
})();