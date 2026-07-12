const state = {
  data: null,
  selectedProfile: null,
  selectedProfiles: new Set(),
  profileSearch: '',
  profileStatusFilter: 'all',
  tab: 'timeline',
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function fmtTime(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function fmtShortTime(value) {
  if (!value) return '-';
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function fmtBytes(value) {
  if (!Number.isFinite(value) || value < 0) return '-';
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = -1;
  do {
    size /= 1024;
    unit += 1;
  } while (size >= 1024 && unit < units.length - 1);
  return `${size >= 100 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

function text(value) {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function escapeHtml(value) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('is-visible'), 3200);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await res.json();
  if (!res.ok || body.ok === false) {
    const err = body.error || body.result?.stderr || `HTTP ${res.status}`;
    throw new Error(err);
  }
  return body;
}

async function refresh() {
  state.data = await api('/api/state');
  const profiles = orderedProfiles(state.data.profiles || []);
  const profileNames = new Set(profiles.map(profile => profile.name));
  state.selectedProfiles = new Set([...state.selectedProfiles].filter(name => profileNames.has(name)));
  if (!state.selectedProfile || !profiles.some(profile => profile.name === state.selectedProfile)) {
    state.selectedProfile = profiles[0]?.name || null;
  }
  render();
}

function selectedProfile() {
  return (state.data?.profiles || []).find(profile => profile.name === state.selectedProfile) || null;
}

function profileEvents() {
  return (state.data?.activity?.events || []).filter(event => event.profile === state.selectedProfile);
}

function profileTimeline() {
  return (state.data?.activity?.timeline || []).filter(group => group.profile === state.selectedProfile);
}

function statusPill(status) {
  const value = status || 'stopped';
  const className = String(value).replace(/[^a-z0-9_-]/gi, '-');
  return `<span class="pill ${escapeHtml(className)}">${escapeHtml(value)}</span>`;
}

function shortUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    const pathText = `${url.pathname}${url.search}`.replace(/\/$/, '');
    if (!pathText || pathText === '/') return url.hostname;
    const compactPath = pathText.length > 54 ? `${pathText.slice(0, 51)}...` : pathText;
    return `${url.hostname}${compactPath}`;
  } catch {
    return String(value).length > 64 ? `${String(value).slice(0, 61)}...` : String(value);
  }
}

function isProfileActive(profile) {
  return profile?.status === 'running'
    || (profile?.activeTabs ?? 0) > 0
    || profile?.daemon?.status === 'ok'
    || profile?.daemon?.status === 'running';
}

function profileSortRank(profile) {
  if (isProfileActive(profile)) return 0;
  if (profile?.status === 'stale') return 1;
  if (profile?.status === 'error') return 2;
  return 3;
}

function orderedProfiles(profiles) {
  return [...profiles].sort((a, b) => {
    const rankDelta = profileSortRank(a) - profileSortRank(b);
    if (rankDelta !== 0) return rankDelta;
    return a.name.localeCompare(b.name);
  });
}

function visibleProfiles() {
  const query = state.profileSearch.trim().toLowerCase();
  return orderedProfiles(state.data?.profiles || []).filter(profile => {
    const active = isProfileActive(profile);
    if (state.profileStatusFilter === 'active' && !active) return false;
    if (state.profileStatusFilter === 'stopped' && active) return false;
    if (!query) return true;
    return [
      profile.name,
      profile.status,
      profile.daemon?.status,
      profile.userDataDir,
    ].filter(Boolean).some(value => String(value).toLowerCase().includes(query));
  });
}

function renderProfiles() {
  const list = $('#profileList');
  const allProfiles = state.data?.profiles || [];
  const profiles = visibleProfiles();
  const selectedCount = state.selectedProfiles.size;
  const visibleSelectedCount = profiles.filter(profile => state.selectedProfiles.has(profile.name)).length;
  $('#profileCount').textContent = allProfiles.length;
  $('#profileDiskTotal').textContent = fmtBytes(allProfiles.reduce((sum, profile) => sum + (profile.diskUsageBytes || 0), 0));
  $('#eventCount').textContent = state.data?.activity?.totalEvents || 0;
  $('#homePath').textContent = state.data?.chromuxHome || '';
  $('#profileSearch').value = state.profileSearch;
  $$('[data-status-filter]').forEach(button => {
    button.classList.toggle('is-active', button.dataset.statusFilter === state.profileStatusFilter);
  });
  $('#bulkBar').hidden = selectedCount === 0;
  $('#selectedProfileCount').textContent = `${selectedCount} / ${profiles.length}`;
  $('#selectedProfileCount').title = `${selectedCount} selected of ${profiles.length} shown`;
  $('#deleteSelectedProfiles').disabled = selectedCount === 0;
  $('#selectAllProfiles').checked = profiles.length > 0 && visibleSelectedCount === profiles.length;
  $('#selectAllProfiles').indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < profiles.length;

  if (!profiles.length) {
    list.innerHTML = allProfiles.length
      ? '<div class="empty-state">No matching profiles</div>'
      : '<div class="empty-state">No profiles</div>';
    return;
  }

  list.innerHTML = profiles.map(profile => `
    <div class="profile-item ${profile.name === state.selectedProfile ? 'is-active' : ''} ${state.selectedProfiles.has(profile.name) ? 'is-selected' : ''}">
      <label class="profile-check" title="Select profile">
        <input type="checkbox" data-select-profile="${escapeHtml(profile.name)}" ${state.selectedProfiles.has(profile.name) ? 'checked' : ''}>
      </label>
      <button class="profile-main" data-profile="${escapeHtml(profile.name)}">
        <span class="profile-name">${escapeHtml(profile.name)}</span>
        <span class="profile-meta">${escapeHtml(profile.daemon?.status)} daemon / ${escapeHtml(profile.activeTabs)} tabs / ${escapeHtml(fmtBytes(profile.diskUsageBytes))}</span>
      </button>
      ${statusPill(profile.status)}
    </div>
  `).join('');

  $$('.profile-main').forEach(button => {
    button.addEventListener('click', () => {
      state.selectedProfile = button.dataset.profile;
      render();
    });
  });
  $$('[data-select-profile]').forEach(input => {
    input.addEventListener('change', () => {
      if (input.checked) {
        state.selectedProfiles.add(input.dataset.selectProfile);
      } else {
        state.selectedProfiles.delete(input.dataset.selectProfile);
      }
      renderProfiles();
    });
  });
}

function factRows(rows) {
  return rows.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join('');
}

function renderProfileDetail() {
  const profile = selectedProfile();
  $('#selectedName').textContent = profile?.name || 'No profile';
  $('#summaryStatus').textContent = profile?.status || '-';
  $('#summaryDaemon').textContent = profile?.daemon?.status || '-';
  $('#summarySessions').textContent = profile?.daemon?.sessions ?? '-';
  $('#summaryModified').textContent = profile?.modifiedAt ? fmtTime(profile.modifiedAt) : '-';

  const disabled = profile ? '' : 'disabled';
  $('#profileActions').innerHTML = `
    <button data-action="launch-headed" class="primary" ${disabled}>Launch headed</button>
    <button data-action="open-foreground" ${disabled}>Open foreground</button>
    <button data-action="stop-daemon" ${disabled}>Stop daemon</button>
    <button data-action="kill" class="danger" ${disabled}>Kill profile</button>
  `;
  $$('#profileActions button').forEach(button => {
    button.addEventListener('click', () => runProfileAction(button.dataset.action));
  });

  $('#runtimeFacts').innerHTML = factRows([
    ['PID', profile?.pid],
    ['Port', profile?.port],
    ['Launch mode', profile?.launchMode],
    ['Active tabs', profile?.activeTabs],
    ['Paused', profile?.paused ? 'yes' : 'no'],
    ['Disk usage', fmtBytes(profile?.diskUsageBytes)],
    ['User data dir', profile?.userDataDir],
    ['Reason', profile?.reason],
  ]);

  const events = profileEvents();
  const tasks = new Set(events.map(event => event.task).filter(Boolean));
  const hosts = new Set(events.map(event => event.host).filter(Boolean));
  $('#activityFacts').innerHTML = factRows([
    ['Events', events.length],
    ['Tasks', tasks.size],
    ['Hosts', hosts.size],
    ['Retention', state.data?.activity?.config?.retentionDays],
    ['Aggregate commands', Object.keys(state.data?.activity?.aggregates?.byCommand || {}).length],
  ]);
}

async function runProfileAction(action) {
  const profile = selectedProfile();
  if (!profile) return;
  try {
    const body = await api(`/api/profiles/${encodeURIComponent(profile.name)}/action`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    toast(body.result?.stderr || body.result?.stdout || `${action} complete`);
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

async function deleteSelectedProfiles() {
  const profiles = [...state.selectedProfiles];
  if (!profiles.length) return;
  const preview = profiles.slice(0, 6).join(', ');
  const suffix = profiles.length > 6 ? ` and ${profiles.length - 6} more` : '';
  if (!confirm(`Delete ${profiles.length} profile${profiles.length === 1 ? '' : 's'} and local profile files?\n\n${preview}${suffix}`)) return;
  try {
    const body = await api('/api/profiles/delete', {
      method: 'POST',
      body: JSON.stringify({ profiles }),
    });
    toast(`Deleted ${body.deleted} profile${body.deleted === 1 ? '' : 's'}`);
    state.selectedProfiles.clear();
    await refresh();
  } catch (err) {
    toast(err.message);
    await refresh();
  }
}

function renderTabs() {
  $$('.tab-button').forEach(button => {
    button.classList.toggle('is-active', button.dataset.tab === state.tab);
    button.onclick = () => {
      state.tab = button.dataset.tab;
      renderTabs();
    };
  });
  $$('.tab-view').forEach(view => view.classList.remove('is-active'));
  $(`#${state.tab}View`).classList.add('is-active');
}

function renderTimeline() {
  const list = $('#timelineList');
  const groups = profileTimeline();
  if (!groups.length) {
    list.innerHTML = '<div class="empty-state">No timeline entries</div>';
    return;
  }
  list.innerHTML = groups.map(group => `
    <article class="timeline-card">
      <div class="timeline-head">
        <div class="timeline-heading">
          <div class="timeline-title">${escapeHtml(group.label)}</div>
          <div class="timeline-subtitle">${escapeHtml(fmtTime(group.startedAt))}${group.startedAt !== group.endedAt ? ` - ${escapeHtml(fmtTime(group.endedAt))}` : ''}</div>
        </div>
        ${statusPill(group.errorCount ? 'failed' : 'ok')}
      </div>
      <div class="timeline-chips" aria-label="Timeline summary">
        <span>${escapeHtml(group.eventCount)} events</span>
        <span>${escapeHtml(group.commands.join(' -> ') || '-')}</span>
        <span>${escapeHtml(group.hosts.join(', ') || 'no host')}</span>
        ${group.derived ? '<span>derived session</span>' : ''}
      </div>
      <div class="timeline-events">
        ${group.events.map(event => `
          <div class="timeline-event ${event.ok ? '' : 'has-error'}">
            <span class="event-dot" aria-hidden="true"></span>
            <span class="event-time">${escapeHtml(fmtShortTime(event.timestamp))}</span>
            <span class="event-command">${escapeHtml(event.command)}</span>
            <span class="event-target">${event.redacted ? '[redacted]' : escapeHtml(shortUrl(event.url || event.title || ''))}</span>
          </div>
        `).join('')}
      </div>
    </article>
  `).join('');
}

function renderRawLog() {
  const body = $('#rawLogBody');
  const events = profileEvents();
  if (!events.length) {
    body.innerHTML = '<tr><td colspan="7">No raw events</td></tr>';
    return;
  }
  body.innerHTML = events.map(event => `
    <tr>
      <td>${escapeHtml(fmtTime(event.timestamp))}</td>
      <td>${escapeHtml(event.command)}</td>
      <td>${escapeHtml(event.task)}</td>
      <td>${escapeHtml(event.session)}</td>
      <td class="url-cell">${event.redacted ? '[redacted]' : escapeHtml(event.url)}<br>${event.redacted ? '' : escapeHtml(event.title)}</td>
      <td>${event.ok ? 'ok' : escapeHtml(event.error)}</td>
      <td>${(event.siteKnowledgePaths || []).map(escapeHtml).join('<br>') || '-'}</td>
    </tr>
  `).join('');
}

function renderLifecycle() {
  const retention = state.data?.activity?.config?.retentionDays ?? 90;
  $('#retentionSelect').value = String(retention);
  const tasks = state.data?.activity?.tasks || [];
  $('#taskSelect').innerHTML = tasks.length
    ? tasks.map(task => `<option value="${escapeHtml(task)}">${escapeHtml(task)}</option>`).join('')
    : '<option value="">No Task</option>';
}

async function saveRetention() {
  try {
    await api('/api/activity/config', {
      method: 'POST',
      body: JSON.stringify({ retentionDays: $('#retentionSelect').value }),
    });
    toast('Retention saved');
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

function lifecycleScope(kind) {
  if (kind.endsWith('all')) return { type: 'all' };
  if (kind.endsWith('profile')) return { type: 'profile', profile: state.selectedProfile };
  return { type: 'task', task: $('#taskSelect').value };
}

async function runLifecycle(kind) {
  const action = kind.startsWith('delete') ? 'delete' : 'redact';
  const scope = lifecycleScope(kind);
  if (scope.type === 'task' && !scope.task) {
    toast('No Task selected');
    return;
  }
  if (action === 'delete' && !confirm(`Confirm ${kind.replace('-', ' ')}?`)) return;
  try {
    const result = await api(`/api/activity/${action}`, {
      method: 'POST',
      body: JSON.stringify(scope),
    });
    toast(`${action} complete`);
    state.data.activity = result.activity;
    render();
  } catch (err) {
    toast(err.message);
  }
}

function render() {
  renderProfiles();
  renderProfileDetail();
  renderTabs();
  renderTimeline();
  renderRawLog();
  renderLifecycle();
}

$('#refreshButton').addEventListener('click', refresh);
$('#profileSearch').addEventListener('input', (event) => {
  state.profileSearch = event.target.value;
  renderProfiles();
});
$$('[data-status-filter]').forEach(button => {
  button.addEventListener('click', () => {
    state.profileStatusFilter = button.dataset.statusFilter;
    renderProfiles();
  });
});
$('#selectAllProfiles').addEventListener('change', (event) => {
  const profiles = visibleProfiles();
  state.selectedProfiles = event.target.checked
    ? new Set([...state.selectedProfiles, ...profiles.map(profile => profile.name)])
    : new Set([...state.selectedProfiles].filter(name => !profiles.some(profile => profile.name === name)));
  renderProfiles();
});
$('#deleteSelectedProfiles').addEventListener('click', deleteSelectedProfiles);
$('#saveRetention').addEventListener('click', saveRetention);
$$('[data-lifecycle]').forEach(button => {
  button.addEventListener('click', () => runLifecycle(button.dataset.lifecycle));
});

refresh().catch(err => toast(err.message));
