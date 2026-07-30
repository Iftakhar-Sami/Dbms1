/* =========================================================
   Sports Week — Control Center
   Vanilla JS UI wiring for index.html + style.css.
   Talks to the backend exclusively through window.Api (api.js).
   ========================================================= */

(function () {
  'use strict';

  /* ---------------------------------------------------------
     DOM HELPERS
  --------------------------------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
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
    }, 4200);
  }

  function reportError(prefix, err) {
    console.error(prefix, err);
    showToast(`${prefix}: ${err.message}`, 'err');
  }

  /* ---------------------------------------------------------
     STATUS PILLS
  --------------------------------------------------------- */
  function pill(text, kind) {
    const cls = { ok: 'ok', warn: 'warn', bad: 'bad' }[kind] || '';
    return `<span class="pill ${cls}"><span class="pill-dot"></span>${escapeHtml(text || '—')}</span>`;
  }

  function registrationStatusPill(status) {
    switch (String(status || '').toUpperCase()) {
      case 'ACCEPTED': return pill('ACCEPTED', 'ok');
      case 'REJECTED': return pill('REJECTED', 'bad');
      case 'PENDING':  return pill('PENDING', 'warn');
      default:         return pill(status || '—', '');
    }
  }

  function matchStatusPill(status) {
    switch (String(status || '').toUpperCase()) {
      case 'COMPLETED': return pill('COMPLETED', 'ok');
      case 'ONGOING':   return pill('ONGOING', 'warn');
      case 'CANCELLED': return pill('CANCELLED', 'bad');
      case 'SCHEDULED': return pill('SCHEDULED', 'warn');
      default:          return pill(status || '—', '');
    }
  }

  /* ---------------------------------------------------------
     STATE
  --------------------------------------------------------- */
  const LS_RECENT_MATCHES = 'sw_recent_matches';

  let eventsCache = [];
  let currentView = 'overview';
  let lastSeasonId = null;

  let recentMatches = [];
  try { recentMatches = JSON.parse(localStorage.getItem(LS_RECENT_MATCHES) || '[]'); }
  catch (_) { recentMatches = []; }

  /* ---------------------------------------------------------
     VIEW ROUTING (sidebar nav + quick cards)
  --------------------------------------------------------- */
  const VIEW_META = {
    overview:    { title: 'Overview',           subtitle: 'A live snapshot of the season.' },
    events:      { title: 'Events & Registration', subtitle: 'Browse every event and register solo or as a team.' },
    schedule:    { title: 'My Schedule',         subtitle: 'Every match tied to a UID, sorted by time.' },
    leaderboard: { title: 'Leaderboard',         subtitle: 'Season standings ranked by points.' },
    manager:     { title: 'Manager Console',     subtitle: 'Schedule matches, seed participants, score results, advance winners.' },
    admin:       { title: 'Admin Console',       subtitle: 'Approve or reject registrations and audit every score change.' },
  };

  const viewTitle    = $('#view-title');
  const viewSubtitle = $('#view-subtitle');
  const sidebar      = $('.sidebar');

  function setView(name) {
    if (!VIEW_META[name]) return;
    currentView = name;

    $$('.nav-item[data-view]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.view === name);
    });
    $$('.view').forEach((section) => {
      section.classList.toggle('is-active', section.id === `view-${name}`);
    });

    viewTitle.textContent = VIEW_META[name].title;
    viewSubtitle.textContent = VIEW_META[name].subtitle;

    sidebar.classList.remove('is-open');

    // Lazy-load data the first time a view needs it.
    if (name === 'schedule') {
      const uidInput = $('#schedule-uid');
      const identityUid = Api.getIdentityUid();
      if (identityUid && !uidInput.value) uidInput.value = identityUid;
    }
    if (name === 'admin') {
      loadAuditLogs();
    }
  }

  $$('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  $('#mobile-nav-toggle').addEventListener('click', () => {
    sidebar.classList.toggle('is-open');
  });

  /* ---------------------------------------------------------
     MODALS
  --------------------------------------------------------- */
  function openModal(el) { el.classList.add('is-open'); }
  function closeModal(el) { el.classList.remove('is-open'); }

  $$('.modal-backdrop').forEach((backdrop) => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal(backdrop);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $$('.modal-backdrop.is-open').forEach(closeModal);
  });

  /* --- Identity modal --- */
  const identityModal   = $('#identity-modal');
  const identityDot     = $('#identity-dot');
  const identityLabel   = $('#identity-label');
  const identityInput   = $('#identity-uid-input');

  function refreshIdentityUI() {
    const uid = Api.getIdentityUid();
    if (uid) {
      identityDot.classList.add('is-set');
      identityLabel.textContent = `UID ${uid}`;
    } else {
      identityDot.classList.remove('is-set');
      identityLabel.textContent = 'No identity set';
    }
  }

  $('#identity-open').addEventListener('click', () => {
    identityInput.value = Api.getIdentityUid() || '';
    openModal(identityModal);
    identityInput.focus();
  });
  $('#identity-modal-close').addEventListener('click', () => closeModal(identityModal));

  $('#form-identity').addEventListener('submit', (e) => {
    e.preventDefault();
    const uid = identityInput.value.trim();
    Api.setIdentityUid(uid);
    refreshIdentityUI();
    closeModal(identityModal);
    showToast(uid ? `Identity set to UID ${uid}.` : 'Identity cleared.');
    updateOverviewStats();
  });

  $('#identity-clear').addEventListener('click', () => {
    Api.setIdentityUid('');
    identityInput.value = '';
    refreshIdentityUI();
    showToast('Identity cleared.');
    updateOverviewStats();
  });

  /* --- Settings modal (API base URL) --- */
  const settingsModal = $('#settings-modal');
  const apiBaseInput  = $('#api-base-input');

  $('#settings-open').addEventListener('click', () => {
    apiBaseInput.value = Api.getApiBase();
    openModal(settingsModal);
    apiBaseInput.focus();
  });
  $('#settings-modal-close').addEventListener('click', () => closeModal(settingsModal));

  $('#form-settings').addEventListener('submit', (e) => {
    e.preventDefault();
    Api.setApiBase(apiBaseInput.value);
    closeModal(settingsModal);
    showToast('API base URL updated.');
  });

  /* --- Event report modal --- */
  const reportModal    = $('#report-modal');
  const reportTitle    = $('#report-modal-title');
  const reportSub      = $('#report-modal-sub');
  const reportTbody    = $('#report-modal-tbody');

  $('#report-modal-close').addEventListener('click', () => closeModal(reportModal));

  async function openReportModal(eventId) {
    reportTitle.textContent = 'Event report';
    reportSub.textContent = 'Loading…';
    reportTbody.innerHTML = `<tr><td colspan="5"><div class="empty-row">Loading…</div></td></tr>`;
    openModal(reportModal);

    try {
      const report = await Api.getEventReport(eventId);
      reportTitle.textContent = report.event.event_name;
      reportSub.textContent = `${report.event.sport_name} · ${report.event.participation_type} · ${report.total_participants} participant(s)`;

      if (!report.participants.length) {
        reportTbody.innerHTML = `<tr><td colspan="5"><div class="empty-row">No participants registered yet.</div></td></tr>`;
        return;
      }
      reportTbody.innerHTML = report.participants.map((p) => `
        <tr>
          <td class="mono">${p.participation_id}</td>
          <td>${escapeHtml(p.participant_name)}</td>
          <td class="mono">${escapeHtml(p.identifier)}</td>
          <td>${registrationStatusPill(p.registration_status)}</td>
          <td>${escapeHtml(p.competition_status || '—')}</td>
        </tr>
      `).join('');
    } catch (err) {
      reportSub.textContent = '';
      reportTbody.innerHTML = `<tr><td colspan="5"><div class="empty-row">Couldn't load report — ${escapeHtml(err.message)}</div></td></tr>`;
    }
  }

  /* ---------------------------------------------------------
     EVENTS — table, selects, registration forms
  --------------------------------------------------------- */
  const eventsTbody = $('#events-tbody');

  function renderEventsTable(events) {
    if (!events.length) {
      eventsTbody.innerHTML = `<tr><td colspan="5"><div class="empty-row">No events found.</div></td></tr>`;
      return;
    }
    eventsTbody.innerHTML = events.map((ev) => `
      <tr>
        <td class="mono">${ev.event_id}</td>
        <td>${escapeHtml(ev.event_name)}</td>
        <td>${escapeHtml(ev.sport_name)}</td>
        <td>${escapeHtml(ev.participation_type)}</td>
        <td><button type="button" class="btn btn-ghost btn-sm" data-report-id="${ev.event_id}">Report</button></td>
      </tr>
    `).join('');
  }

  eventsTbody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-report-id]');
    if (btn) openReportModal(btn.dataset.reportId);
  });

  function fillEventSelect(select, events, { placeholder = 'Select an event' } = {}) {
    const current = select.value;
    select.innerHTML =
      `<option value="">${placeholder}</option>` +
      events.map((ev) =>
        `<option value="${ev.event_id}">${escapeHtml(ev.event_name)} — ${escapeHtml(ev.sport_name)} (${escapeHtml(ev.participation_type)})</option>`
      ).join('');
    if (current && events.some((ev) => String(ev.event_id) === current)) {
      select.value = current;
    }
  }

  function populateEventSelects(events) {
    const soloEvents = events.filter((ev) => String(ev.participation_type).toUpperCase() !== 'TEAM');
    const teamEvents = events.filter((ev) => String(ev.participation_type).toUpperCase() === 'TEAM');

    fillEventSelect($('#solo-event'), soloEvents, { placeholder: 'Select a solo event' });
    fillEventSelect($('#team-event'), teamEvents, { placeholder: 'Select a team event' });
    fillEventSelect($('#assign-event'), events);
    fillEventSelect($('#match-event'), events);
    fillEventSelect($('#mgr-report-event'), events);
    fillEventSelect($('#admin-report-event'), events);
  }

  async function loadEvents() {
    eventsTbody.innerHTML = `<tr><td colspan="5"><div class="empty-row">Loading events…</div></td></tr>`;
    try {
      eventsCache = await Api.getEvents();
      renderEventsTable(eventsCache);
      populateEventSelects(eventsCache);
      updateOverviewStats();
    } catch (err) {
      eventsTbody.innerHTML = `<tr><td colspan="5"><div class="empty-row">Couldn't load events — ${escapeHtml(err.message)}</div></td></tr>`;
      reportError('Failed to load events', err);
    }
  }

  $('#events-refresh').addEventListener('click', loadEvents);

  /* --- Register solo --- */
  $('#form-register-solo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const eventId = Number($('#solo-event').value);
    const uid = Number($('#solo-uid').value);
    if (!eventId || !uid) {
      showToast('Pick an event and enter a UID.', 'err');
      return;
    }
    try {
      await Api.registerSolo(eventId, uid);
      showToast('Registered successfully!');
      e.target.reset();
    } catch (err) {
      reportError('Registration failed', err);
    }
  });

  /* --- Register team --- */
  const teamMembersEl = $('#team-members');

  function addMemberRow(prefill = '') {
    const row = document.createElement('div');
    row.className = 'member-row';
    row.innerHTML = `
      <input type="number" min="1" placeholder="UID" value="${escapeHtml(prefill)}" />
      <button type="button" aria-label="Remove member">✕</button>
    `;
    row.querySelector('button').addEventListener('click', () => {
      row.remove();
      if (teamMembersEl.children.length === 0) addMemberRow();
    });
    teamMembersEl.appendChild(row);
  }

  $('#team-add-member').addEventListener('click', () => addMemberRow());
  addMemberRow(); // seed with one row

  function teamMemberUids() {
    return $$('#team-members input')
      .map((input) => parseInt(input.value, 10))
      .filter((n) => Number.isInteger(n) && n > 0)
      .filter((n, idx, arr) => arr.indexOf(n) === idx);
  }

  $('#form-register-team').addEventListener('submit', async (e) => {
    e.preventDefault();
    const eventId = Number($('#team-event').value);
    const teamName = $('#team-name').value.trim();
    const uids = teamMemberUids();

    if (!eventId || !teamName || uids.length === 0) {
      showToast('Pick an event, name the team, and add at least one UID.', 'err');
      return;
    }
    try {
      await Api.registerTeam(eventId, teamName, uids);
      showToast(`"${teamName}" registered successfully!`);
      $('#team-name').value = '';
      teamMembersEl.innerHTML = '';
      addMemberRow();
    } catch (err) {
      reportError('Team registration failed', err);
    }
  });

  /* ---------------------------------------------------------
     SCHEDULE
  --------------------------------------------------------- */
  const scheduleTbody = $('#schedule-tbody');

  $('#form-schedule').addEventListener('submit', async (e) => {
    e.preventDefault();
    const uid = $('#schedule-uid').value.trim();
    if (!uid) return;

    scheduleTbody.innerHTML = `<tr><td colspan="6"><div class="empty-row">Loading schedule…</div></td></tr>`;
    try {
      const matches = await Api.getSchedule(uid);
      if (!matches.length) {
        scheduleTbody.innerHTML = `<tr><td colspan="6"><div class="empty-row">No matches scheduled yet.</div></td></tr>`;
      } else {
        scheduleTbody.innerHTML = matches.map((m) => `
          <tr>
            <td>${escapeHtml(m.event_name)}</td>
            <td>${escapeHtml(m.sport_name)}</td>
            <td>${escapeHtml(m.stage)}</td>
            <td>${formatDateTime(m.start_time)}</td>
            <td>${escapeHtml(m.venue)}</td>
            <td>${matchStatusPill(m.match_status)}</td>
          </tr>
        `).join('');
      }
      if (String(uid) === String(Api.getIdentityUid())) updateOverviewStats(matches);
    } catch (err) {
      scheduleTbody.innerHTML = `<tr><td colspan="6"><div class="empty-row">Couldn't load schedule — ${escapeHtml(err.message)}</div></td></tr>`;
      reportError('Failed to load schedule', err);
    }
  });

  /* ---------------------------------------------------------
     LEADERBOARD
  --------------------------------------------------------- */
  const leaderboardTbody = $('#leaderboard-tbody');

  $('#form-leaderboard').addEventListener('submit', async (e) => {
    e.preventDefault();
    const seasonId = Number($('#season-id').value);
    if (!seasonId) return;

    leaderboardTbody.innerHTML = `<tr><td colspan="5"><div class="empty-row">Loading standings…</div></td></tr>`;
    try {
      const data = await Api.getLeaderboard(seasonId);
      const standings = data.standings || [];
      lastSeasonId = seasonId;
      updateOverviewStats();

      if (!standings.length) {
        leaderboardTbody.innerHTML = `<tr><td colspan="5"><div class="empty-row">No standings yet for this season.</div></td></tr>`;
        return;
      }
      leaderboardTbody.innerHTML = standings.map((row, idx) => `
        <tr>
          <td class="mono">${idx + 1}</td>
          <td>${escapeHtml(row.competitor_name)}</td>
          <td class="mono">${escapeHtml(row.identifier)}</td>
          <td>${row.events_played}</td>
          <td>${row.total_points}</td>
        </tr>
      `).join('');
    } catch (err) {
      leaderboardTbody.innerHTML = `<tr><td colspan="5"><div class="empty-row">Couldn't load standings — ${escapeHtml(err.message)}</div></td></tr>`;
      reportError('Failed to load leaderboard', err);
    }
  });

  /* ---------------------------------------------------------
     MANAGER CONSOLE
  --------------------------------------------------------- */

  /* --- Assign manager --- */
  $('#form-assign-manager').addEventListener('submit', async (e) => {
    e.preventDefault();
    const eventId = Number($('#assign-event').value);
    const uid = Number($('#assign-uid').value);
    if (!eventId || !uid) {
      showToast('Pick an event and enter a manager UID.', 'err');
      return;
    }
    try {
      await Api.assignManager(uid, eventId);
      showToast('Manager assigned successfully!');
      e.target.reset();
    } catch (err) {
      reportError('Could not assign manager', err);
    }
  });

  /* --- Create match --- */
  const recentMatchesTbody = $('#recent-matches-tbody');

  function renderRecentMatches() {
    if (!recentMatches.length) {
      recentMatchesTbody.innerHTML = `<tr><td colspan="4"><div class="empty-row">Matches you create in this browser will be listed here for quick reuse.</div></td></tr>`;
      return;
    }
    recentMatchesTbody.innerHTML = recentMatches.map((m) => `
      <tr>
        <td class="mono">${m.match_id}</td>
        <td>${escapeHtml(m.event_name)}</td>
        <td>${escapeHtml(m.stage)}</td>
        <td>${escapeHtml(m.venue)}</td>
      </tr>
    `).join('');
  }

  $('#form-create-match').addEventListener('submit', async (e) => {
    e.preventDefault();
    const eventSelect = $('#match-event');
    const eventId = Number(eventSelect.value);
    const stage = $('#match-stage').value;
    const startTime = toMySqlDateTime($('#match-start').value);
    const endTime = toMySqlDateTime($('#match-end').value);
    const venue = $('#match-venue').value.trim();

    if (!eventId || !stage || !startTime || !endTime || !venue) {
      showToast('Fill in every field to schedule a match.', 'err');
      return;
    }

    try {
      const result = await Api.createMatch({
        event_id: eventId, stage, start_time: startTime, end_time: endTime, venue,
      });
      showToast(`Match #${result.match_id} scheduled!`);

      const eventName = eventSelect.selectedOptions[0]?.textContent || `Event ${eventId}`;
      recentMatches.unshift({ match_id: result.match_id, event_name: eventName, stage, venue });
      recentMatches = recentMatches.slice(0, 20);
      localStorage.setItem(LS_RECENT_MATCHES, JSON.stringify(recentMatches));
      renderRecentMatches();

      e.target.reset();
    } catch (err) {
      reportError('Could not schedule match', err);
    }
  });

  /* --- Manager: find a participation ID (event report) --- */
  const mgrReportTbody = $('#mgr-report-tbody');

  $('#form-mgr-report').addEventListener('submit', async (e) => {
    e.preventDefault();
    const eventId = $('#mgr-report-event').value;
    if (!eventId) return;

    mgrReportTbody.innerHTML = `<tr><td colspan="6"><div class="empty-row">Loading…</div></td></tr>`;
    try {
      const report = await Api.getEventReport(eventId);
      if (!report.participants.length) {
        mgrReportTbody.innerHTML = `<tr><td colspan="6"><div class="empty-row">No participants registered yet.</div></td></tr>`;
        return;
      }
      mgrReportTbody.innerHTML = report.participants.map((p) => `
        <tr>
          <td class="mono">${p.participation_id}</td>
          <td>${escapeHtml(p.participant_name)}</td>
          <td class="mono">${escapeHtml(p.identifier)}</td>
          <td>${registrationStatusPill(p.registration_status)}</td>
          <td>${escapeHtml(p.competition_status || '—')}</td>
          <td><button type="button" class="btn btn-ghost btn-sm" data-use-participation="${p.participation_id}">Use</button></td>
        </tr>
      `).join('');
    } catch (err) {
      mgrReportTbody.innerHTML = `<tr><td colspan="6"><div class="empty-row">Couldn't load report — ${escapeHtml(err.message)}</div></td></tr>`;
      reportError('Failed to load event report', err);
    }
  });

  mgrReportTbody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-use-participation]');
    if (!btn) return;
    const id = btn.dataset.useParticipation;
    ['#add-participation-id', '#safe-participation-id', '#score-participation-id'].forEach((sel) => {
      $(sel).value = id;
    });
    showToast(`Participation ID ${id} filled into the forms below.`);
  });

  /* --- Add participant --- */
  $('#form-add-participant').addEventListener('submit', async (e) => {
    e.preventDefault();
    const matchId = Number($('#add-match-id').value);
    const participationId = Number($('#add-participation-id').value);
    try {
      await Api.addParticipant(matchId, participationId);
      showToast('Participant added to match.');
      e.target.reset();
    } catch (err) {
      reportError('Could not add participant', err);
    }
  });

  /* --- Safe add (conflict-checked) --- */
  $('#form-safe-add').addEventListener('submit', async (e) => {
    e.preventDefault();
    const matchId = Number($('#safe-match-id').value);
    const participationId = Number($('#safe-participation-id').value);

    if (!Api.getIdentityUid()) {
      showToast('Set your identity (UID) first — this action requires the match manager role.', 'err');
      return;
    }

    try {
      await Api.safeAddParticipant(matchId, participationId);
      showToast('Participant safely added — no schedule conflicts.');
      e.target.reset();
    } catch (err) {
      if (err.status === 409 && err.data) {
        showToast(err.data.message || 'Schedule conflict detected.', 'err');
      } else {
        reportError('Could not safely add participant', err);
      }
    }
  });

  /* --- Complete match --- */
  $('#form-complete-match').addEventListener('submit', async (e) => {
    e.preventDefault();
    const matchId = Number($('#complete-match-id').value);

    if (!Api.getIdentityUid()) {
      showToast('Set your identity (UID) first — this action requires the match manager role.', 'err');
      return;
    }

    try {
      await Api.completeMatch(matchId);
      showToast('Match completed — bracket updated!');
      e.target.reset();
    } catch (err) {
      reportError('Could not complete match', err);
    }
  });

  /* --- Update score --- */
  $('#form-update-score').addEventListener('submit', async (e) => {
    e.preventDefault();
    const match_id = Number($('#score-match-id').value);
    const participation_id = Number($('#score-participation-id').value);
    const score = Number($('#score-value').value);
    const is_winner = $('#score-winner').checked;

    if (!Api.getIdentityUid()) {
      showToast('Set your identity (UID) first — this action requires the match manager role.', 'err');
      return;
    }

    try {
      await Api.updateScore({ match_id, participation_id, score, is_winner });
      showToast('Score saved and logged to the audit trail.');
      e.target.reset();
      if (currentView === 'admin') loadAuditLogs();
    } catch (err) {
      reportError('Could not save score', err);
    }
  });

  /* ---------------------------------------------------------
     ADMIN CONSOLE
  --------------------------------------------------------- */
  const adminReportTbody = $('#admin-report-tbody');

  $('#form-admin-report').addEventListener('submit', async (e) => {
    e.preventDefault();
    await loadAdminReport();
  });

  async function loadAdminReport() {
    const eventId = $('#admin-report-event').value;
    if (!eventId) return;

    adminReportTbody.innerHTML = `<tr><td colspan="5"><div class="empty-row">Loading…</div></td></tr>`;
    try {
      const report = await Api.getEventReport(eventId);
      if (!report.participants.length) {
        adminReportTbody.innerHTML = `<tr><td colspan="5"><div class="empty-row">No registrations for this event yet.</div></td></tr>`;
        return;
      }
      adminReportTbody.innerHTML = report.participants.map((p) => `
        <tr>
          <td class="mono">${p.participation_id}</td>
          <td>${escapeHtml(p.participant_name)}</td>
          <td class="mono">${escapeHtml(p.identifier)}</td>
          <td>${registrationStatusPill(p.registration_status)}</td>
          <td>
            <button type="button" class="btn btn-ghost btn-sm" data-decision="ACCEPTED" data-id="${p.participation_id}">Accept</button>
            <button type="button" class="btn btn-ghost btn-sm" data-decision="REJECTED" data-id="${p.participation_id}">Reject</button>
          </td>
        </tr>
      `).join('');
    } catch (err) {
      adminReportTbody.innerHTML = `<tr><td colspan="5"><div class="empty-row">Couldn't load registrations — ${escapeHtml(err.message)}</div></td></tr>`;
      reportError('Failed to load registrations', err);
    }
  }

  adminReportTbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-decision]');
    if (!btn) return;

    if (!Api.getIdentityUid()) {
      showToast('Set your identity (UID) first — this action requires the ADMIN role.', 'err');
      return;
    }

    const { id, decision } = btn.dataset;
    btn.disabled = true;
    try {
      await Api.updateRegistrationStatus(id, decision);
      showToast(`Registration ${decision.toLowerCase()}.`);
      await loadAdminReport();
    } catch (err) {
      reportError('Could not update registration', err);
      btn.disabled = false;
    }
  });

  /* --- Audit log --- */
  const auditTbody = $('#audit-tbody');
  let auditLoaded = false;

  async function loadAuditLogs() {
    if (!Api.getIdentityUid()) {
      auditTbody.innerHTML = `<tr><td colspan="6"><div class="empty-row">Set your identity (UID) — audit logs require the ADMIN role.</div></td></tr>`;
      return;
    }
    auditTbody.innerHTML = `<tr><td colspan="6"><div class="empty-row">Loading…</div></td></tr>`;
    try {
      const logs = await Api.getAuditLogs();
      auditLoaded = true;
      if (!logs.length) {
        auditTbody.innerHTML = `<tr><td colspan="6"><div class="empty-row">No score changes logged yet.</div></td></tr>`;
        return;
      }
      auditTbody.innerHTML = logs.map((log) => `
        <tr>
          <td>${escapeHtml(log.event_name)}</td>
          <td>${escapeHtml(log.stage)}</td>
          <td>${escapeHtml(log.participant_name)}</td>
          <td>${escapeHtml(log.changed_by_manager)}</td>
          <td class="mono">${log.old_score ?? '—'} → ${log.new_score ?? '—'}</td>
          <td>${formatDateTime(log.changed_at)}</td>
        </tr>
      `).join('');
    } catch (err) {
      auditTbody.innerHTML = `<tr><td colspan="6"><div class="empty-row">Couldn't load audit log — ${escapeHtml(err.message)}</div></td></tr>`;
      reportError('Failed to load audit log', err);
    }
  }

  $('#audit-refresh').addEventListener('click', loadAuditLogs);

  /* ---------------------------------------------------------
     OVERVIEW STATS
  --------------------------------------------------------- */
  const statEvents    = $('#stat-events');
  const statUpcoming  = $('#stat-upcoming');
  const statSeason    = $('#stat-season');

  async function updateOverviewStats(schedule) {
    statEvents.textContent = eventsCache.length ? String(eventsCache.length) : '—';
    statSeason.textContent = lastSeasonId ? `#${lastSeasonId}` : '—';

    const uid = Api.getIdentityUid();
    if (!uid) {
      statUpcoming.textContent = '—';
      return;
    }

    if (!schedule) {
      try {
        schedule = await Api.getSchedule(uid);
      } catch (_) {
        statUpcoming.textContent = '—';
        return;
      }
    }

    const now = Date.now();
    const upcoming = schedule.filter((m) => {
      const status = String(m.match_status || '').toUpperCase();
      const startsInFuture = m.start_time && new Date(m.start_time).getTime() > now;
      return status !== 'COMPLETED' && status !== 'CANCELLED' && startsInFuture;
    });
    statUpcoming.textContent = String(upcoming.length);
  }

  /* ---------------------------------------------------------
     INIT
  --------------------------------------------------------- */
  function init() {
    refreshIdentityUI();
    renderRecentMatches();
    setView('overview');
    loadEvents();
  }

  init();
  document.addEventListener('DOMContentLoaded', init);
  
})();