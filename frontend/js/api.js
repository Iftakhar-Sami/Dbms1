/* =========================================================
   Sports Week — API layer
   Every fetch() call to the Express backend lives here.
   Exposes a single global: window.Api
   ========================================================= */

(function () {
  'use strict';

  const LS_API_BASE = 'sw_api_base';
  const LS_IDENTITY  = 'sw_identity_uid';
  const DEFAULT_API_BASE = 'http://localhost:3000/api';

  /* ---------------------------------------------------------
     API base URL (settings modal)
  --------------------------------------------------------- */
  function getApiBase() {
    return localStorage.getItem(LS_API_BASE) || DEFAULT_API_BASE;
  }

  function setApiBase(url) {
    const clean = String(url || '').trim().replace(/\/+$/, '');
    localStorage.setItem(LS_API_BASE, clean || DEFAULT_API_BASE);
  }

  /* ---------------------------------------------------------
     Identity (Role Switcher simulation)
     The whole app has one "logged in" UID at a time — set via
     the identity modal — and it rides along as x-user-id on
     every request that the backend guards with `authenticate`.
  --------------------------------------------------------- */
  function getIdentityUid() {
    return localStorage.getItem(LS_IDENTITY) || '';
  }

  function setIdentityUid(uid) {
    if (uid === null || uid === undefined || uid === '') {
      localStorage.removeItem(LS_IDENTITY);
    } else {
      localStorage.setItem(LS_IDENTITY, String(uid));
    }
  }

  /* ---------------------------------------------------------
     Core request helper
  --------------------------------------------------------- */
  async function request(path, { method = 'GET', body, auth = false } = {}) {
    const headers = { 'Content-Type': 'application/json' };

    if (auth) {
      const uid = getIdentityUid();
      if (uid) headers['x-user-id'] = uid;
    }

    let res;
    try {
      res = await fetch(`${getApiBase()}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (networkErr) {
      const err = new Error(
        `Could not reach the API at ${getApiBase()}. Is the backend running?`
      );
      err.cause = networkErr;
      throw err;
    }

    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      /* empty or non-JSON body — fine for some 200/204 responses */
    }

    if (!res.ok) {
      const message =
        (data && (data.error || data.message)) || `Request failed (${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  /* ---------------------------------------------------------
     Endpoint map — mirrors backend/routes exactly
  --------------------------------------------------------- */
  window.Api = {
    getApiBase,
    setApiBase,
    getIdentityUid,
    setIdentityUid,

    // Events
    getEvents: () => request('/events'),
    getEventReport: (eventId) => request(`/events/${eventId}/report`),
    registerSolo: (event_id, uid) =>
      request('/events/register-solo', {
        method: 'POST',
        body: { event_id, uid },
      }),

    // Teams
    registerTeam: (event_id, team_name, uids) =>
      request('/teams/register', {
        method: 'POST',
        body: { event_id, team_name, uids },
      }),

    // Managers
    assignManager: (uid, event_id) =>
      request('/managers', {
        method: 'POST',
        body: { uid, event_id },
      }),

    // Matches
    createMatch: ({ event_id, stage, start_time, end_time, venue }) =>
      request('/matches', {
        method: 'POST',
        body: { event_id, stage, start_time, end_time, venue },
      }),
    addParticipant: (match_id, participation_id) =>
      request('/matches/participants', {
        method: 'POST',
        body: { match_id, participation_id },
      }),
    safeAddParticipant: (match_id, participation_id) =>
      request('/matches/participants/safe-add', {
        method: 'POST',
        body: { match_id, participation_id },
        auth: true,
      }),
    updateScore: ({ match_id, participation_id, score, is_winner }) =>
      request('/matches/score', {
        method: 'PUT',
        body: { match_id, participation_id, score, is_winner },
        auth: true,
      }),
    completeMatch: (matchId) =>
      request(`/matches/${matchId}/complete`, {
        method: 'POST',
        auth: true,
      }),

    // Users
    getSchedule: (uid) => request(`/users/${uid}/schedule`),

    // Seasons
    getLeaderboard: (seasonId) => request(`/seasons/${seasonId}/leaderboard`),

    // Admin
    updateRegistrationStatus: (participationId, status) =>
      request(`/admin/participation/${participationId}/status`, {
        method: 'PUT',
        body: { status },
        auth: true,
      }),
    getAuditLogs: () => request('/admin/audit-logs', { auth: true }),
  };
})();