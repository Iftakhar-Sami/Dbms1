/* =========================================================
   Sports Week — Control Board
   Vanilla JS wiring for index.html + style.css
   Talks to the Express backend (server.js) over fetch().
   ========================================================= */

(() => {
  'use strict';

  /* ---------------------------------------------------------
     STORAGE / STATE
  --------------------------------------------------------- */
  const LS_API_BASE   = 'sw_api_base';
  const LS_USERS      = 'sw_users';
  const LS_SELECTED   = 'sw_selected_uid';

  const DEFAULT_API_BASE = 'http://localhost:3000/api';

  let API_BASE = localStorage.getItem(LS_API_BASE) || DEFAULT_API_BASE;

  /** [{ uid: Number, label: String }] — athletes the operator has added on this device */
  let users = [];
  try { users = JSON.parse(localStorage.getItem(LS_USERS) || '[]'); } catch { users = []; }

  let selectedUid = localStorage.getItem(LS_SELECTED) || '';

  let eventsCache = [];      // last successful GET /events response
  let currentTab  = 'events';

  /* ---------------------------------------------------------
     DOM REFS
  --------------------------------------------------------- */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const tabBtns        = $$('.tab-btn');
  const tabIndicator   = $('.tab-indicator');
  const tabPanels       = {
    events:      $('#tab-events'),
    schedule:    $('#tab-schedule'),
    leaderboard: $('#tab-leaderboard'),
  };

  const userSelect      = $('#user-select');
  const settingsBtn     = $('#settings-btn');
  const settingsPanel   = $('#settings-panel');
  const apiBaseInput    = $('#api-base-input');
  const apiBaseSave     = $('#api-base-save');
  const apiBaseCancel   = $('#api-base-cancel');

  const addUserPanel    = $('#add-user-panel');
  const addUserUid      = $('#add-user-uid');
  const addUserName     = $('#add-user-name');
  const addUserSave     = $('#add-user-save');
  const addUserCancel   = $('#add-user-cancel');

  const eventsTbody     = $('#events-tbody');
  const eventsCount     = $('#events-count');

  const regForm         = $('#register-form');
  const regEventSelect  = $('#reg-event');
  const regTypeBadge    = $('#reg-type-badge');
  const noUserNotice    = $('#no-user-notice');
  const soloFields      = $('#solo-fields');
  const soloReadout     = $('#solo-user-readout');
  const teamFields      = $('#team-fields');
  const teamNameInput   = $('#team-name');
  const memberRows      = $('#member-rows');
  const addMemberBtn    = $('#add-member-btn');
  const registerSubmit  = $('#register-submit');

  const scheduleTbody   = $('#schedule-tbody');
  const scheduleContext = $('#schedule-context');

  const seasonInput     = $('#season-input');
  const leaderboardTbody = $('#leaderboard-tbody');

  const rosterModal     = $('#roster-modal');
  const rosterTitle     = $('#roster-title');
  const rosterTbody     = $('#roster-tbody');
  const rosterClose     = $('#roster-close');

  const toastContainer  = $('#toast-container');

  /* ---------------------------------------------------------
     HELPERS
  --------------------------------------------------------- */
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function showToast(message, type = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${type === 'err' ? 'err' : 'ok'}`;
    el.textContent = message;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 220);
    }, 3600);
  }

  async function api(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  }

  function pill(status, kind) {
    const map = { ok: 'ok', warn: 'warn', bad: 'bad', live: 'warn live' };
    const cls = map[kind] || '';
    return `<span class="pill ${cls}"><span class="pill-dot"></span>${escapeHtml(status || '—')}</span>`;
  }

  function matchStatusPill(status) {
    switch ((status || '').toUpperCase()) {
      case 'ONGOING':   return pill('LIVE', 'live');
      case 'COMPLETED': return pill('COMPLETED', 'ok');
      case 'CANCELLED': return pill('CANCELLED', 'bad');
      case 'SCHEDULED': return pill('SCHEDULED', 'warn');
      default:          return pill(status || 'UNKNOWN', '');
    }
  }

  function registrationStatusPill(status) {
    switch ((status || '').toUpperCase()) {
      case 'ACCEPTED': return pill('ACCEPTED', 'ok');
      case 'REJECTED': return pill('REJECTED', 'bad');
      case 'PENDING':  return pill('PENDING', 'warn');
      default:         return pill(status || '—', '');
    }
  }

  function selectedUser() {
    if (!selectedUid) return null;
    return users.find((u) => String(u.uid) === String(selectedUid)) || null;
  }

  function persistUsers() { localStorage.setItem(LS_USERS, JSON.stringify(users)); }
  function persistSelected() { localStorage.setItem(LS_SELECTED, selectedUid || ''); }

  /* ---------------------------------------------------------
     TABS
  --------------------------------------------------------- */
  function positionIndicator(btn) {
    if (!btn || !tabIndicator) return;
    tabIndicator.style.width = `${btn.offsetWidth}px`;
    tabIndicator.style.transform = `translateX(${btn.offsetLeft - 4}px)`;
  }

  function switchTab(name) {
    currentTab = name;
    tabBtns.forEach((btn) => {
      const active = btn.dataset.tab === name;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
      if (active) positionIndicator(btn);
    });
    Object.entries(tabPanels).forEach(([key, panel]) => {
      panel.classList.toggle('active', key === name);
    });

    if (name === 'schedule') loadSchedule();
    if (name === 'leaderboard') loadLeaderboard();
  }

  tabBtns.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  window.addEventListener('resize', () => {
    const active = tabBtns.find((b) => b.classList.contains('active'));
    positionIndicator(active);
  });

  /* ---------------------------------------------------------
     SETTINGS POPOVER (API base URL)
  --------------------------------------------------------- */
  function closePopovers(except) {
    [settingsPanel, addUserPanel].forEach((p) => { if (p !== except) p.classList.add('hidden'); });
  }

  settingsBtn.addEventListener('click', () => {
    const opening = settingsPanel.classList.contains('hidden');
    closePopovers(opening ? settingsPanel : null);
    if (opening) {
      apiBaseInput.value = API_BASE;
      settingsPanel.classList.remove('hidden');
      apiBaseInput.focus();
    } else {
      settingsPanel.classList.add('hidden');
    }
  });

  apiBaseSave.addEventListener('click', () => {
    const val = apiBaseInput.value.trim().replace(/\/+$/, '');
    API_BASE = val || DEFAULT_API_BASE;
    localStorage.setItem(LS_API_BASE, API_BASE);
    settingsPanel.classList.add('hidden');
    showToast('API base URL updated.');
    loadEvents();
  });

  apiBaseCancel.addEventListener('click', () => settingsPanel.classList.add('hidden'));

  /* ---------------------------------------------------------
     USER SELECT / ADD ATHLETE
  --------------------------------------------------------- */
  function renderUserSelect() {
    const prev = userSelect.value;
    userSelect.innerHTML = `
      <option value="">Select athlete…</option>
      ${users.map((u) => `<option value="${u.uid}">${escapeHtml(u.label)} (UID ${u.uid})</option>`).join('')}
      <option value="__add">＋ Add athlete…</option>
    `;
    userSelect.value = users.some((u) => String(u.uid) === String(prev)) ? prev : (selectedUid || '');
  }

  function onUserChanged() {
    const user = selectedUser();
    soloReadout.textContent = user ? `${user.label} — UID ${user.uid}` : '—';
    noUserNotice.classList.toggle('hidden', !!user);
    scheduleContext.textContent = user ? `${user.label} (UID ${user.uid})` : 'no athlete selected';
    // Keep the first team-member row in sync with whoever is selected, if it's empty.
    const firstMemberInput = memberRows.querySelector('.member-row input');
    if (firstMemberInput && !firstMemberInput.value && user) firstMemberInput.value = user.uid;
    updateSubmitState();
    if (currentTab === 'schedule') loadSchedule();
  }

  userSelect.addEventListener('change', () => {
    if (userSelect.value === '__add') {
      userSelect.value = selectedUid || '';
      closePopovers(addUserPanel);
      addUserUid.value = '';
      addUserName.value = '';
      addUserPanel.classList.remove('hidden');
      addUserUid.focus();
      return;
    }
    selectedUid = userSelect.value;
    persistSelected();
    onUserChanged();
  });

  addUserSave.addEventListener('click', () => {
    const uid = parseInt(addUserUid.value, 10);
    if (!uid || uid <= 0) {
      showToast('Enter a valid numeric UID.', 'err');
      return;
    }
    const label = addUserName.value.trim() || `User #${uid}`;
    const existing = users.find((u) => u.uid === uid);
    if (existing) existing.label = label; else users.push({ uid, label });
    persistUsers();
    selectedUid = String(uid);
    persistSelected();
    renderUserSelect();
    onUserChanged();
    addUserPanel.classList.add('hidden');
    showToast(`${label} added.`);
  });

  addUserCancel.addEventListener('click', () => {
    userSelect.value = selectedUid || '';
    addUserPanel.classList.add('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!settingsPanel.classList.contains('hidden') && !settingsPanel.contains(e.target) && e.target !== settingsBtn && !settingsBtn.contains(e.target)) {
      settingsPanel.classList.add('hidden');
    }
    if (!addUserPanel.classList.contains('hidden') && !addUserPanel.contains(e.target) && e.target !== userSelect) {
      addUserPanel.classList.add('hidden');
      userSelect.value = selectedUid || '';
    }
  });

  /* ---------------------------------------------------------
     EVENTS TAB
  --------------------------------------------------------- */
  async function loadEvents() {
    eventsTbody.innerHTML = `<tr class="empty-row"><td colspan="5">Loading events…</td></tr>`;
    try {
      const events = await api('/events');
      eventsCache = events;
      eventsCount.textContent = events.length;

      if (!events.length) {
        eventsTbody.innerHTML = `<tr class="empty-row"><td colspan="5">No events published yet.</td></tr>`;
      } else {
        eventsTbody.innerHTML = events.map((ev) => `
          <tr>
            <td class="mono">${ev.event_id}</td>
            <td>${escapeHtml(ev.event_name)}</td>
            <td>${escapeHtml(ev.sport_name)}</td>
            <td><span class="type-badge">${escapeHtml(ev.participation_type)}</span></td>
            <td><button class="row-action" data-event-id="${ev.event_id}">View</button></td>
          </tr>
        `).join('');
      }

      const prevValue = regEventSelect.value;
      regEventSelect.innerHTML = `<option value="">Choose an event…</option>` +
        events.map((ev) => `<option value="${ev.event_id}">${escapeHtml(ev.event_name)} — ${escapeHtml(ev.sport_name)}</option>`).join('');
      if (events.some((ev) => String(ev.event_id) === prevValue)) regEventSelect.value = prevValue;

      onRegEventChanged();
    } catch (err) {
      eventsTbody.innerHTML = `<tr class="empty-row"><td colspan="5">Couldn't load events — ${escapeHtml(err.message)}</td></tr>`;
      showToast(`Failed to load events: ${err.message}`, 'err');
    }
  }

  eventsTbody.addEventListener('click', (e) => {
    const btn = e.target.closest('.row-action');
    if (btn) openRoster(btn.dataset.eventId);
  });

  function currentEvent() {
    return eventsCache.find((ev) => String(ev.event_id) === regEventSelect.value) || null;
  }

  function onRegEventChanged() {
    const ev = currentEvent();
    const isTeam = ev && String(ev.participation_type).toUpperCase() === 'TEAM';
    const isSolo = ev && !isTeam;

    regTypeBadge.classList.toggle('hidden', !ev);
    if (ev) regTypeBadge.textContent = ev.participation_type;

    soloFields.classList.toggle('hidden', !isSolo);
    teamFields.classList.toggle('hidden', !isTeam);

    if (isTeam && memberRows.children.length === 0) addMemberRow();

    onUserChanged();
  }
  regEventSelect.addEventListener('change', onRegEventChanged);

  function addMemberRow(prefillUid = '') {
    const row = document.createElement('div');
    row.className = 'member-row';
    row.innerHTML = `
      <input type="number" min="1" placeholder="UID" value="${prefillUid ? escapeHtml(prefillUid) : ''}" />
      <button type="button" class="member-remove" aria-label="Remove member">✕</button>
    `;
    row.querySelector('.member-remove').addEventListener('click', () => {
      row.remove();
      if (memberRows.children.length === 0) addMemberRow();
      updateSubmitState();
    });
    row.querySelector('input').addEventListener('input', updateSubmitState);
    memberRows.appendChild(row);
  }
  addMemberBtn.addEventListener('click', () => addMemberRow());

  function updateSubmitState() {
    const ev = currentEvent();
    const user = selectedUser();
    let valid = !!ev && !!user;

    if (valid && String(ev.participation_type).toUpperCase() === 'TEAM') {
      const uids = teamMemberUids();
      valid = teamNameInput.value.trim().length > 0 && uids.length > 0;
    }
    registerSubmit.disabled = !valid;
  }
  teamNameInput.addEventListener('input', updateSubmitState);

  function teamMemberUids() {
    return $$('#member-rows .member-row input')
      .map((i) => parseInt(i.value, 10))
      .filter((n) => Number.isInteger(n) && n > 0)
      .filter((n, idx, arr) => arr.indexOf(n) === idx);
  }

  regForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ev = currentEvent();
    const user = selectedUser();
    if (!ev || !user) return;

    const isTeam = String(ev.participation_type).toUpperCase() === 'TEAM';
    registerSubmit.disabled = true;

    try {
      if (isTeam) {
        const uids = teamMemberUids();
        const name = teamNameInput.value.trim();
        await api('/teams/register', {
          method: 'POST',
          body: JSON.stringify({ event_id: Number(ev.event_id), team_name: name, uids }),
        });
        showToast(`"${name}" registered for ${ev.event_name}.`);
        teamNameInput.value = '';
        memberRows.innerHTML = '';
        addMemberRow(user.uid);
      } else {
        await api('/events/register-solo', {
          method: 'POST',
          body: JSON.stringify({ event_id: Number(ev.event_id), uid: Number(user.uid) }),
        });
        showToast(`${user.label} registered for ${ev.event_name}.`);
      }
      loadLeaderboardIfVisible();
    } catch (err) {
      showToast(err.message, 'err');
    } finally {
      updateSubmitState();
    }
  });

  /* ---------------------------------------------------------
     ROSTER MODAL
  --------------------------------------------------------- */
  async function openRoster(eventId) {
    rosterTitle.textContent = 'Event roster';
    rosterTbody.innerHTML = `<tr class="empty-row"><td colspan="4">Loading…</td></tr>`;
    rosterModal.classList.remove('hidden');
    try {
      const report = await api(`/events/${eventId}/report`);
      rosterTitle.textContent = `${report.event.event_name} — ${report.event.sport_name} (${report.event.participation_type})`;
      if (!report.participants.length) {
        rosterTbody.innerHTML = `<tr class="empty-row"><td colspan="4">No participants registered yet.</td></tr>`;
      } else {
        rosterTbody.innerHTML = report.participants.map((p) => `
          <tr>
            <td>${escapeHtml(p.participant_name)}</td>
            <td class="mono">${escapeHtml(p.identifier)}</td>
            <td>${registrationStatusPill(p.registration_status)}</td>
            <td>${p.competition_status ? escapeHtml(p.competition_status) : '—'}</td>
          </tr>
        `).join('');
      }
    } catch (err) {
      rosterTbody.innerHTML = `<tr class="empty-row"><td colspan="4">Couldn't load roster — ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  rosterClose.addEventListener('click', () => rosterModal.classList.add('hidden'));
  rosterModal.addEventListener('click', (e) => { if (e.target === rosterModal) rosterModal.classList.add('hidden'); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      rosterModal.classList.add('hidden');
      settingsPanel.classList.add('hidden');
      addUserPanel.classList.add('hidden');
    }
  });

  /* ---------------------------------------------------------
     SCHEDULE TAB
  --------------------------------------------------------- */
  async function loadSchedule() {
    const user = selectedUser();
    scheduleContext.textContent = user ? `${user.label} (UID ${user.uid})` : 'no athlete selected';

    if (!user) {
      scheduleTbody.innerHTML = `<tr class="empty-row"><td colspan="7">Select an athlete to view their schedule.</td></tr>`;
      return;
    }

    scheduleTbody.innerHTML = `<tr class="empty-row"><td colspan="7">Loading schedule…</td></tr>`;
    try {
      const matches = await api(`/users/${user.uid}/schedule`);
      if (!matches.length) {
        scheduleTbody.innerHTML = `<tr class="empty-row"><td colspan="7">No matches scheduled yet.</td></tr>`;
        return;
      }
      scheduleTbody.innerHTML = matches.map((m) => `
        <tr>
          <td class="mono">#${m.match_id}</td>
          <td>${escapeHtml(m.event_name)}</td>
          <td>${escapeHtml(m.sport_name)}</td>
          <td>${escapeHtml(m.stage)}</td>
          <td>${formatDateTime(m.start_time)}</td>
          <td>${escapeHtml(m.venue)}</td>
          <td>${matchStatusPill(m.match_status)}</td>
        </tr>
      `).join('');
    } catch (err) {
      scheduleTbody.innerHTML = `<tr class="empty-row"><td colspan="7">Couldn't load schedule — ${escapeHtml(err.message)}</td></tr>`;
      showToast(`Failed to load schedule: ${err.message}`, 'err');
    }
  }

  /* ---------------------------------------------------------
     LEADERBOARD TAB
  --------------------------------------------------------- */
  function loadLeaderboardIfVisible() {
    if (currentTab === 'leaderboard') loadLeaderboard();
  }

  async function loadLeaderboard() {
    const seasonId = parseInt(seasonInput.value, 10) || 1;
    leaderboardTbody.innerHTML = `<tr class="empty-row"><td colspan="5">Loading standings…</td></tr>`;
    try {
      const data = await api(`/seasons/${seasonId}/leaderboard`);
      const standings = data.standings || [];
      if (!standings.length) {
        leaderboardTbody.innerHTML = `<tr class="empty-row"><td colspan="5">No standings yet for this season.</td></tr>`;
        return;
      }
      leaderboardTbody.innerHTML = standings.map((row, idx) => {
        const rank = idx + 1;
        const rankClass = rank <= 3 ? `rank-${rank}` : '';
        return `
          <tr>
            <td><span class="rank-chip ${rankClass}">${rank}</span></td>
            <td>${escapeHtml(row.competitor_name)}</td>
            <td class="mono">${escapeHtml(row.identifier)}</td>
            <td>${row.events_played}</td>
            <td class="points-cell">${row.total_points}</td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      leaderboardTbody.innerHTML = `<tr class="empty-row"><td colspan="5">Couldn't load standings — ${escapeHtml(err.message)}</td></tr>`;
      showToast(`Failed to load leaderboard: ${err.message}`, 'err');
    }
  }

  let seasonDebounce;
  seasonInput.addEventListener('input', () => {
    clearTimeout(seasonDebounce);
    seasonDebounce = setTimeout(() => { if (currentTab === 'leaderboard') loadLeaderboard(); }, 400);
  });

  /* ---------------------------------------------------------
     INIT
  --------------------------------------------------------- */
  function init() {
    renderUserSelect();
    onUserChanged();
    switchTab('events');
    loadEvents();
  }

  document.addEventListener('DOMContentLoaded', init);
  
})();