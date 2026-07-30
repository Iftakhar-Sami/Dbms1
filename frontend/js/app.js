/* =========================================================
   Sports Week — app.js
   Vanilla JS UI wiring. Talks to the backend only through
   window.Api (api.js).
========================================================= */
(function () {
  'use strict';

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtDateTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  // datetime-local input -> "YYYY-MM-DD HH:MM:SS" for MySQL
  function toMySqlDateTime(localValue) {
    if (!localValue) return null;
    const withSeconds = localValue.length === 16 ? `${localValue}:00` : localValue;
    return withSeconds.replace('T', ' ');
  }

  /* ---------------------------------------------------------
     TOASTS
  --------------------------------------------------------- */
  const toastStack = $('#toast-stack');
  function showToast(message, type = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${type === 'err' ? 'err' : 'ok'}`;
    el.textContent = message;
    toastStack.appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 220);
    }, 3600);
  }
  function handleError(err, fallback) {
    console.error(err);
    showToast(err?.message || fallback || 'Something went wrong.', 'err');
  }

  /* ---------------------------------------------------------
     LOCAL TRACKERS
     The backend has no endpoints to list "events I manage" or
     "matches in an event", so the manager workspace keeps a
     lightweight local index — every write still goes through
     the real API and the server still enforces who's allowed
     to do what (isMatchManager / isAdmin).
  --------------------------------------------------------- */
  function matchesKey(eventId) { return `sw_matches_${eventId}`; }
  const REGISTRY_KEY = 'sw_manager_registry';

  // Managed events are set ONLY by an Admin assigning a manager
  // (POST /api/managers, wired from the Admin Dashboard). Students
  // never add themselves here — this just reads what's been assigned.
  function getManagedEvents(uid) {
    const registry = JSON.parse(localStorage.getItem(REGISTRY_KEY) || '{}');
    return Array.from(new Set((registry[uid] || []).map(Number)));
  }
  function registerManagerAssignment(uid, eventId) {
    const registry = JSON.parse(localStorage.getItem(REGISTRY_KEY) || '{}');
    const list = new Set((registry[uid] || []).map(Number));
    list.add(Number(eventId));
    registry[uid] = [...list];
    localStorage.setItem(REGISTRY_KEY, JSON.stringify(registry));
  }
  function getTrackedMatches(eventId) {
    return JSON.parse(localStorage.getItem(matchesKey(eventId)) || '[]');
  }
  function saveTrackedMatches(eventId, arr) {
    localStorage.setItem(matchesKey(eventId), JSON.stringify(arr));
  }
  function addTrackedMatch(eventId, match) {
    const list = getTrackedMatches(eventId);
    list.unshift(match);
    saveTrackedMatches(eventId, list);
  }
  function patchTrackedMatch(eventId, matchId, patch) {
    const list = getTrackedMatches(eventId).map(m => m.match_id === matchId ? { ...m, ...patch } : m);
    saveTrackedMatches(eventId, list);
    return list.find(m => m.match_id === matchId);
  }

  /* ---------------------------------------------------------
     STATE
  --------------------------------------------------------- */
  let session = null;          // { uid, role }
  let eventsCache = null;      // array from GET /events
  let currentEventModalId = null;
  let currentManageEventId = null;
  let eventReportCache = {};   // event_id -> report

  async function ensureEvents() {
    if (!eventsCache) eventsCache = await Api.getEvents();
    return eventsCache;
  }
  function eventById(id) {
    return (eventsCache || []).find(e => Number(e.event_id) === Number(id));
  }

  /* ---------------------------------------------------------
     MODAL HELPERS
  --------------------------------------------------------- */
  function openModal(id) { $(`#${id}`).classList.add('is-open'); }
  function closeModal(id) { $(`#${id}`).classList.remove('is-open'); }
  $$('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', (e) => { if (e.target === bd) bd.classList.remove('is-open'); });
  });

  /* ===========================================================
     LOGIN
  =========================================================== */
  const loginScreen  = $('#login-screen');
  const appShell      = $('#app-shell');
  const loginForm     = $('#form-login');
  const loginUidInput = $('#login-uid');
  const loginError    = $('#login-error');
  const loginSubmit   = $('#login-submit');

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const uid = loginUidInput.value.trim();
    if (!uid) return;
    loginError.textContent = '';
    loginSubmit.classList.add('is-loading');
    loginSubmit.disabled = true;
    try {
      const result = await Api.probeLogin(uid);
      Api.setSession(result.uid, result.role);
      session = { uid: result.uid, role: result.role };
      enterApp();
    } catch (err) {
      loginError.textContent = err.message || 'Could not sign in.';
    } finally {
      loginSubmit.classList.remove('is-loading');
      loginSubmit.disabled = false;
    }
  });

  $('#logout-btn').addEventListener('click', () => {
    Api.clearSession();
    session = null;
    eventsCache = null;
    eventReportCache = {};
    appShell.hidden = true;
    loginScreen.hidden = false;
    loginUidInput.value = '';
    loginForm.reset();
  });

  function enterApp() {
    loginScreen.hidden = true;
    appShell.hidden = false;
    $('#identity-uid').textContent = `UID ${session.uid}`;
    $('#identity-role').textContent = session.role;
    setupTabsForRole();
    switchTab(session.role === 'ADMIN' ? 'admin' : 'directory');
  }

  /* ===========================================================
     TABS
  =========================================================== */
  const tabButtons = $$('.tab-btn[data-tab]');
  function setupTabsForRole() {
    const studentTabs = ['directory', 'schedule', 'leaderboard', 'manage'];
    const adminTabs = ['admin'];
    const visible = session.role === 'ADMIN' ? adminTabs : studentTabs;
    tabButtons.forEach(btn => {
      const tab = btn.dataset.tab;
      btn.style.display = visible.includes(tab) ? '' : 'none';
    });
  }

  function switchTab(tab) {
    tabButtons.forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));
    $$('.view[data-view]').forEach(v => v.classList.toggle('is-active', v.id === `view-${tab}`));
    if (tab === 'directory') loadDirectory();
    if (tab === 'schedule') loadSchedule();
    if (tab === 'leaderboard') loadLeaderboardDefault();
    if (tab === 'manage') loadManage();
    if (tab === 'admin') loadAdmin();
  }
  tabButtons.forEach(btn => {
    if (btn.id === 'logout-btn') return;
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  /* ===========================================================
     SHARED: participants table renderer
  =========================================================== */
  function statusBadge(status, kind) {
    const map = {
      PENDING: 'badge-pending', ACCEPTED: 'badge-accepted', REJECTED: 'badge-rejected',
      ACTIVE: 'badge-active', WINNER: 'badge-winner', RUNNER_UP: 'badge-accepted', ELIMINATED: 'badge-eliminated',
      SCHEDULED: 'badge-scheduled', ONGOING: 'badge-ongoing', COMPLETED: 'badge-completed', CANCELLED: 'badge-rejected',
    };
    return `<span class="badge ${map[status] || 'badge-active'}">${escapeHtml(status || '—')}</span>`;
  }

  function renderParticipantsTable(tbody, participants, { allowDecision = false, onDecided } = {}) {
    if (!participants || participants.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4"><div class="empty-row">No participants yet.</div></td></tr>`;
      return;
    }
    tbody.innerHTML = participants.map(p => `
      <tr>
        <td>${escapeHtml(p.participant_name)}</td>
        <td class="mono">${escapeHtml(p.identifier)}</td>
        <td>${statusBadge(p.registration_status)}</td>
        <td>
          ${allowDecision && p.registration_status === 'PENDING'
            ? `<div style="display:flex;gap:6px;">
                 <button class="btn btn-ok btn-sm" data-decide="ACCEPTED" data-pid="${p.participation_id}">Approve</button>
                 <button class="btn btn-danger btn-sm" data-decide="REJECTED" data-pid="${p.participation_id}">Reject</button>
               </div>`
            : ''}
        </td>
      </tr>
    `).join('');

    if (allowDecision) {
      tbody.querySelectorAll('[data-decide]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const pid = btn.dataset.pid;
          const decision = btn.dataset.decide;
          btn.disabled = true;
          try {
            await Api.updateRegistrationStatus(pid, decision);
            showToast(`Registration ${decision.toLowerCase()}.`);
            if (onDecided) await onDecided();
          } catch (err) {
            if (err.status === 403) {
              showToast('The server currently restricts approvals to ADMIN accounts. Ask an admin, or use the Admin Dashboard.', 'err');
            } else {
              handleError(err, 'Could not update registration.');
            }
          } finally {
            btn.disabled = false;
          }
        });
      });
    }
  }

  /* ===========================================================
     DIRECTORY TAB
  =========================================================== */
  const directoryGrid = $('#directory-grid');

  async function loadDirectory() {
    directoryGrid.innerHTML = `<div class="empty-state"><div class="spinner"></div><p>Loading events…</p></div>`;
    try {
      eventsCache = await Api.getEvents();
      renderDirectory(eventsCache);
    } catch (err) {
      directoryGrid.innerHTML = `<div class="empty-state"><p>Could not load events. ${escapeHtml(err.message)}</p></div>`;
    }
  }
  $('#directory-refresh').addEventListener('click', loadDirectory);

  function typeBadgeClass(type) {
    return type === 'TEAM' ? 'badge-team' : type === 'MULTIPLAYER' ? 'badge-multi' : 'badge-solo';
  }

  function renderDirectory(events) {
    if (!events || events.length === 0) {
      directoryGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3l2.2 5.6 6 .5-4.6 4 1.4 5.9-5-3.4-5 3.4 1.4-5.9-4.6-4 6-.5L12 3z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></div>
          <h3>No events yet</h3><p>Check back once this season's events are published.</p>
        </div>`;
      return;
    }
    directoryGrid.innerHTML = events.map(ev => `
      <div class="event-card" data-event-id="${ev.event_id}">
        <div class="event-card-top">
          <div>
            <h3>${escapeHtml(ev.event_name)}</h3>
            <p class="sport-name">${escapeHtml(ev.sport_name)}</p>
          </div>
          <span class="badge ${typeBadgeClass(ev.participation_type)}">${escapeHtml(ev.participation_type)}</span>
        </div>
        <div class="event-card-foot">
          <button class="btn btn-secondary btn-sm">${ev.participation_type === 'TEAM' ? 'View & register team' : 'View & join'}</button>
        </div>
      </div>
    `).join('');
    $$('.event-card', directoryGrid).forEach(card => {
      card.addEventListener('click', () => {
        const ev = eventById(card.dataset.eventId);
        if (ev) openEventModal(ev);
      });
    });
  }

  /* ---------- Event modal (join / view report) ---------- */
  const eventModal = $('#event-modal');
  const joinSoloSection = $('#event-modal-join-solo');
  const joinTeamSection = $('#event-modal-join-team');
  const teamMembersRows = $('#team-members-rows');

  function addMemberRow(value = '') {
    const row = document.createElement('div');
    row.className = 'member-row';
    row.innerHTML = `
      <input type="number" placeholder="Member UID" value="${escapeHtml(value)}" required />
      <button type="button" class="member-row-remove" aria-label="Remove">
        <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
      </button>`;
    row.querySelector('.member-row-remove').addEventListener('click', () => row.remove());
    teamMembersRows.appendChild(row);
  }
  $('#team-add-member-btn').addEventListener('click', () => addMemberRow());

  async function openEventModal(event, { hideJoin = false } = {}) {
    currentEventModalId = event.event_id;
    $('#event-modal-title').textContent = event.event_name;
    $('#event-modal-sub').textContent = `${event.sport_name} · ${event.participation_type}`;

    const isTeam = event.participation_type === 'TEAM';
    joinSoloSection.style.display = (!hideJoin && !isTeam) ? '' : 'none';
    joinTeamSection.style.display = (!hideJoin && isTeam) ? '' : 'none';
    if (!hideJoin && isTeam) {
      teamMembersRows.innerHTML = '';
      addMemberRow(session.uid);
      $('#team-name-input').value = '';
    }

    $('#event-modal-tbody').innerHTML = `<tr><td colspan="4"><div class="empty-row">Loading…</div></td></tr>`;
    openModal('event-modal');
    await refreshEventReport(event.event_id);
  }

  async function refreshEventReport(eventId) {
    try {
      const report = await Api.getEventReport(eventId);
      eventReportCache[eventId] = report;
      renderParticipantsTable($('#event-modal-tbody'), report.participants, {
        allowDecision: session.role === 'ADMIN',
        onDecided: () => refreshEventReport(eventId),
      });
    } catch (err) {
      $('#event-modal-tbody').innerHTML = `<tr><td colspan="4"><div class="empty-row">${escapeHtml(err.message)}</div></td></tr>`;
    }
  }

  $('#event-modal-close').addEventListener('click', () => closeModal('event-modal'));

  $('#event-join-solo-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await Api.registerSolo(currentEventModalId, Number(session.uid));
      showToast('You are registered! Sit tight for approval.');
      await refreshEventReport(currentEventModalId);
    } catch (err) {
      handleError(err, 'Could not register.');
    } finally {
      btn.disabled = false;
    }
  });

  $('#event-modal-join-team').addEventListener('submit', async (e) => {
    e.preventDefault();
    const teamName = $('#team-name-input').value.trim();
    const uids = $$('input', teamMembersRows).map(i => Number(i.value)).filter(Boolean);
    if (!teamName || uids.length === 0) return;
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await Api.registerTeam(currentEventModalId, teamName, uids);
      showToast('Team registered! Sit tight for approval.');
      await refreshEventReport(currentEventModalId);
    } catch (err) {
      handleError(err, 'Could not register team.');
    } finally {
      btn.disabled = false;
    }
  });

  /* ===========================================================
     SCHEDULE TAB
  =========================================================== */
  async function loadSchedule() {
    const upcomingEl = $('#schedule-upcoming');
    const pastEl = $('#schedule-past');
    upcomingEl.innerHTML = `<div class="empty-state small"><div class="spinner"></div></div>`;
    pastEl.innerHTML = `<div class="empty-state small"><div class="spinner"></div></div>`;
    try {
      const schedule = await Api.getSchedule(session.uid);
      const now = Date.now();
      const upcoming = schedule.filter(m => m.match_status !== 'COMPLETED' && (!m.start_time || new Date(m.start_time).getTime() >= now));
      const past = schedule.filter(m => !upcoming.includes(m));
      renderScheduleList(upcomingEl, upcoming, 'No upcoming matches.');
      renderScheduleList(pastEl, past, 'No past results yet.');
    } catch (err) {
      upcomingEl.innerHTML = `<div class="empty-state small"><p>${escapeHtml(err.message)}</p></div>`;
      pastEl.innerHTML = '';
    }
  }
  $('#schedule-refresh').addEventListener('click', loadSchedule);

  function renderScheduleList(container, rows, emptyMsg) {
    if (!rows || rows.length === 0) {
      container.innerHTML = `<div class="empty-state small"><p>${emptyMsg}</p></div>`;
      return;
    }
    container.innerHTML = rows.map(m => `
      <div class="list-row">
        <div class="list-row-main">
          <span class="list-row-title">${escapeHtml(m.event_name)} · ${escapeHtml(m.stage || '')}</span>
          <span class="list-row-meta">
            <span>${escapeHtml(m.sport_name)}</span>
            <span>${fmtDateTime(m.start_time)}</span>
            <span>${escapeHtml(m.venue || 'Venue TBA')}</span>
          </span>
        </div>
        <div class="list-row-right">${statusBadge(m.match_status)}</div>
      </div>
    `).join('');
  }

  /* ===========================================================
     LEADERBOARD TAB
  =========================================================== */
  function loadLeaderboardDefault() {
    const last = localStorage.getItem('sw_last_season');
    if (last) $('#leaderboard-season-id').value = last;
  }
  $('#form-leaderboard').addEventListener('submit', async (e) => {
    e.preventDefault();
    const seasonId = $('#leaderboard-season-id').value;
    localStorage.setItem('sw_last_season', seasonId);
    const tbody = $('#leaderboard-tbody');
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-row">Loading…</div></td></tr>`;
    try {
      const data = await Api.getLeaderboard(seasonId);
      const standings = data.standings || [];
      if (standings.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="empty-row">No standings for this season yet.</div></td></tr>`;
        return;
      }
      tbody.innerHTML = standings.map((row, i) => `
        <tr>
          <td>#${i + 1}</td>
          <td>${escapeHtml(row.competitor_name)}</td>
          <td class="mono">${escapeHtml(row.identifier)}</td>
          <td>${row.events_played}</td>
          <td>${row.total_points}</td>
        </tr>
      `).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-row">${escapeHtml(err.message)}</div></td></tr>`;
    }
  });

  /* ===========================================================
     MANAGE TAB
  =========================================================== */
  const manageGrid = $('#manage-grid');

  async function loadManage() {
    await ensureEvents().catch(() => {});
    const ids = getManagedEvents(session.uid);
    if (ids.length === 0) {
      manageGrid.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.2" stroke="currentColor" stroke-width="1.5"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></div>
          <h3>You don't manage any events yet</h3>
          <p>An admin hasn't assigned you as a manager for anything yet. Once they do, it'll show up here.</p>
        </div>`;
      return;
    }
    manageGrid.innerHTML = ids.map(id => {
      const ev = eventById(id);
      const name = ev ? ev.event_name : `Event #${id}`;
      const sport = ev ? ev.sport_name : '';
      const type = ev ? ev.participation_type : '';
      return `
        <div class="event-card" data-manage-event-id="${id}">
          <div class="event-card-top">
            <div><h3>${escapeHtml(name)}</h3><p class="sport-name">${escapeHtml(sport)}</p></div>
            ${type ? `<span class="badge ${typeBadgeClass(type)}">${escapeHtml(type)}</span>` : ''}
          </div>
          <div class="event-card-foot"><button class="btn btn-secondary btn-sm">Open controls</button></div>
        </div>`;
    }).join('');
    $$('.event-card', manageGrid).forEach(card => {
      card.addEventListener('click', () => openManageModal(Number(card.dataset.manageEventId)));
    });
  }
  $('#manage-refresh').addEventListener('click', loadManage);

  /* ---------- Manage modal ---------- */
  const manageModal = $('#manage-modal');
  $('#manage-modal-close').addEventListener('click', () => closeModal('manage-modal'));

  $$('.modal-tab-btn', manageModal).forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.modal-tab-btn', manageModal).forEach(b => b.classList.toggle('is-active', b === btn));
      $$('.modal-tab-panel', manageModal).forEach(p => p.classList.toggle('is-active', p.dataset.mpanel === btn.dataset.mtab));
    });
  });

  async function openManageModal(eventId) {
    currentManageEventId = eventId;
    const ev = eventById(eventId);
    $('#manage-modal-title').textContent = ev ? ev.event_name : `Event #${eventId}`;
    $('#manage-modal-sub').textContent = ev ? `${ev.sport_name} · ${ev.participation_type}` : '';
    $$('.modal-tab-btn', manageModal)[0].click();
    $('#form-create-match').reset();
    openModal('manage-modal');
    await refreshManagePending();
    renderManageMatches();
  }

  async function refreshManagePending() {
    const tbody = $('#manage-pending-tbody');
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-row">Loading…</div></td></tr>`;
    try {
      const report = await Api.getEventReport(currentManageEventId);
      eventReportCache[currentManageEventId] = report;
      const pending = report.participants.filter(p => p.registration_status === 'PENDING');
      renderParticipantsTable(tbody, pending.length ? pending : report.participants, {
        allowDecision: true,
        onDecided: refreshManagePending,
      });
      if (pending.length === 0 && report.participants.length > 0) {
        tbody.insertAdjacentHTML('afterbegin', `<tr><td colspan="4"><div class="empty-row">No pending requests — showing everyone.</div></td></tr>`);
      }
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="4"><div class="empty-row">${escapeHtml(err.message)}</div></td></tr>`;
    }
  }

  function acceptedParticipants(eventId) {
    const report = eventReportCache[eventId];
    return report ? report.participants.filter(p => p.registration_status === 'ACCEPTED') : [];
  }

  function renderManageMatches() {
    const list = $('#manage-matches-list');
    const matches = getTrackedMatches(currentManageEventId);
    if (matches.length === 0) {
      list.innerHTML = `<div class="empty-state small"><p>No matches tracked yet. Create one in the "Schedule match" tab.</p></div>`;
      return;
    }
    const accepted = acceptedParticipants(currentManageEventId);
    list.innerHTML = matches.map(m => {
      const trackedIds = new Set(m.participants.map(p => p.participation_id));
      const available = accepted.filter(p => !trackedIds.has(p.participation_id));
      return `
        <div class="match-card" data-match-id="${m.match_id}">
          <div class="match-card-head">
            <div>
              <div class="match-card-title">Match #${m.match_id} · ${escapeHtml(m.stage || 'Stage TBD')}</div>
              <div class="match-card-meta">${fmtDateTime(m.start_time)} · ${escapeHtml(m.venue || 'Venue TBA')}</div>
            </div>
            ${statusBadge(m.status)}
          </div>

          ${m.participants.map(p => `
            <div class="match-participant-row" data-pid="${p.participation_id}">
              <span class="match-participant-name">${escapeHtml(p.name)}</span>
              <input type="number" step="0.01" class="score-input" value="${p.score ?? ''}" placeholder="Score" />
              <label class="field-checkbox"><input type="checkbox" class="winner-check" ${p.is_winner ? 'checked' : ''} /><span>Winner</span></label>
              <button class="btn btn-secondary btn-sm save-score-btn">Save</button>
            </div>
          `).join('')}

          ${available.length ? `
            <div class="add-participant-row">
              <select class="add-participant-select">
                ${available.map(p => `<option value="${p.participation_id}">${escapeHtml(p.participant_name)}</option>`).join('')}
              </select>
              <button class="btn btn-secondary btn-sm add-participant-btn">Add to match</button>
            </div>` : ''}

          <div class="match-actions-row">
            <button class="btn btn-ok btn-sm complete-match-btn" ${m.status === 'COMPLETED' ? 'disabled' : ''}>Mark complete</button>
          </div>
        </div>
      `;
    }).join('');

    $$('.match-card', list).forEach(card => {
      const matchId = Number(card.dataset.matchId);

      card.querySelectorAll('.match-participant-row').forEach(row => {
        row.querySelector('.save-score-btn').addEventListener('click', async () => {
          const pid = Number(row.dataset.pid);
          const score = row.querySelector('.score-input').value;
          const isWinner = row.querySelector('.winner-check').checked;
          try {
            await Api.updateScore({ match_id: matchId, participation_id: pid, score: score === '' ? null : Number(score), is_winner: isWinner });
            const match = getTrackedMatches(currentManageEventId).find(mm => mm.match_id === matchId);
            const updatedParticipants = match.participants.map(p => p.participation_id === pid ? { ...p, score, is_winner: isWinner } : p);
            patchTrackedMatch(currentManageEventId, matchId, { participants: updatedParticipants });
            showToast('Score saved.');
          } catch (err) {
            handleError(err, 'Could not save score.');
          }
        });
      });

      const addBtn = card.querySelector('.add-participant-btn');
      if (addBtn) {
        addBtn.addEventListener('click', async () => {
          const select = card.querySelector('.add-participant-select');
          const pid = Number(select.value);
          const participant = acceptedParticipants(currentManageEventId).find(p => p.participation_id === pid);
          addBtn.disabled = true;
          try {
            await Api.addParticipant(matchId, pid);
            const match = getTrackedMatches(currentManageEventId).find(mm => mm.match_id === matchId);
            const participants = [...match.participants, { participation_id: pid, name: participant.participant_name, score: null, is_winner: false }];
            patchTrackedMatch(currentManageEventId, matchId, { participants });
            renderManageMatches();
            showToast('Participant added to match.');
          } catch (err) {
            handleError(err, 'Could not add participant.');
          } finally {
            addBtn.disabled = false;
          }
        });
      }

      card.querySelector('.complete-match-btn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          await Api.completeMatch(matchId);
          patchTrackedMatch(currentManageEventId, matchId, { status: 'COMPLETED' });
          showToast('Match completed — bracket advanced.');
          renderManageMatches();
        } catch (err) {
          handleError(err, 'Could not complete match. Make sure a winner is marked and saved first.');
          btn.disabled = false;
        }
      });
    });
  }

  $('#form-create-match').addEventListener('submit', async (e) => {
    e.preventDefault();
    const stage = $('#match-stage').value;
    const start_time = toMySqlDateTime($('#match-start').value);
    const end_time = toMySqlDateTime($('#match-end').value);
    const venue = $('#match-venue').value.trim();
    try {
      const result = await Api.createMatch({ event_id: currentManageEventId, stage, start_time, end_time, venue });
      addTrackedMatch(currentManageEventId, { match_id: result.match_id, stage, start_time, end_time, venue, status: 'SCHEDULED', participants: [] });
      showToast('Match scheduled.');
      e.target.reset();
      $$('.modal-tab-btn', manageModal).find(b => b.dataset.mtab === 'matches').click();
      renderManageMatches();
    } catch (err) {
      handleError(err, 'Could not create match.');
    }
  });

  $('#form-track-match').addEventListener('submit', (e) => {
    e.preventDefault();
    const matchId = Number($('#track-match-id').value);
    const stage = $('#track-match-stage').value.trim() || 'Tracked match';
    if (getTrackedMatches(currentManageEventId).some(m => m.match_id === matchId)) {
      showToast('That match is already tracked.', 'err');
      return;
    }
    addTrackedMatch(currentManageEventId, { match_id: matchId, stage, start_time: null, end_time: null, venue: null, status: 'SCHEDULED', participants: [] });
    e.target.reset();
    $$('.modal-tab-btn', manageModal).find(b => b.dataset.mtab === 'matches').click();
    renderManageMatches();
    showToast('Match is now tracked here.');
  });

  /* ===========================================================
     ADMIN TAB
  =========================================================== */
  async function loadAdmin() {
    await populateAssignEventSelect();
    loadAuditLogs();
    loadGlobalReport();
  }

  async function populateAssignEventSelect() {
    await ensureEvents().catch(() => {});
    $('#assign-event').innerHTML = (eventsCache || []).map(ev => `<option value="${ev.event_id}">${escapeHtml(ev.event_name)} — ${escapeHtml(ev.sport_name)}</option>`).join('');
  }

  $('#form-assign-manager').addEventListener('submit', async (e) => {
    e.preventDefault();
    const uid = $('#assign-uid').value;
    const eventId = $('#assign-event').value;
    try {
      await Api.assignManager(Number(uid), Number(eventId));
      registerManagerAssignment(uid, eventId);
      showToast('Manager assigned.');
      e.target.reset();
    } catch (err) {
      handleError(err, 'Could not assign manager.');
    }
  });

  async function loadAuditLogs() {
    const tbody = $('#audit-tbody');
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-row">Loading…</div></td></tr>`;
    try {
      const logs = await Api.getAuditLogs();
      if (!logs || logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="empty-row">No score changes recorded yet.</div></td></tr>`;
        return;
      }
      tbody.innerHTML = logs.map(l => `
        <tr>
          <td>${escapeHtml(l.event_name)}</td>
          <td>${escapeHtml(l.stage || '—')}</td>
          <td>${escapeHtml(l.participant_name)}</td>
          <td>${escapeHtml(l.changed_by_manager)}</td>
          <td class="mono">${l.old_score ?? '—'} → ${l.new_score ?? '—'}</td>
          <td>${fmtDateTime(l.changed_at)}</td>
        </tr>
      `).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-row">${escapeHtml(err.message)}</div></td></tr>`;
    }
  }
  $('#audit-refresh').addEventListener('click', loadAuditLogs);

  async function loadGlobalReport() {
    const tbody = $('#global-tbody');
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-row">Loading…</div></td></tr>`;
    try {
      const events = await ensureEvents();
      const reports = await Promise.all(events.map(ev => Api.getEventReport(ev.event_id).catch(() => null)));
      if (events.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty-row">No events yet.</div></td></tr>`;
        return;
      }
      tbody.innerHTML = events.map((ev, i) => {
        const report = reports[i];
        const participants = report ? report.participants : [];
        const pending = participants.filter(p => p.registration_status === 'PENDING').length;
        const accepted = participants.filter(p => p.registration_status === 'ACCEPTED').length;
        return `
          <tr>
            <td>${escapeHtml(ev.event_name)}</td>
            <td>${escapeHtml(ev.sport_name)}</td>
            <td>${escapeHtml(ev.participation_type)}</td>
            <td>${participants.length}</td>
            <td>${pending}</td>
            <td>${accepted}</td>
            <td><button class="btn btn-ghost btn-sm" data-view-event="${ev.event_id}">View</button></td>
          </tr>`;
      }).join('');
      $$('[data-view-event]', tbody).forEach(btn => {
        btn.addEventListener('click', () => {
          const ev = eventById(btn.dataset.viewEvent);
          if (ev) openEventModal(ev, { hideJoin: true });
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-row">${escapeHtml(err.message)}</div></td></tr>`;
    }
  }
  $('#global-refresh').addEventListener('click', loadGlobalReport);

  /* ===========================================================
     SETTINGS MODAL
  =========================================================== */
  function openSettings() {
    $('#api-base-input').value = Api.getApiBase();
    openModal('settings-modal');
  }
  $('#settings-open').addEventListener('click', openSettings);
  $('#login-settings-open').addEventListener('click', openSettings);
  $('#settings-modal-close').addEventListener('click', () => closeModal('settings-modal'));
  $('#form-settings').addEventListener('submit', (e) => {
    e.preventDefault();
    Api.setApiBase($('#api-base-input').value);
    closeModal('settings-modal');
    showToast('API base URL saved.');
  });

  /* ===========================================================
     INIT
  =========================================================== */
  (function init() {
    const existing = Api.getSession();
    if (existing) {
      session = existing;
      enterApp();
    }
  })();
})();