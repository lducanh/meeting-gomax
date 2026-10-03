const HOUR_START = 8;
const HOUR_END = 20;
const DAY_NAMES = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
// Người/nhóm luôn có sẵn ở tab Họp riêng; các tên khác tự xuất hiện sau lần đặt lịch đầu tiên.
const DEFAULT_PEOPLE = ['BOD'];
// Giữ id khớp với ROOMS trong api.php. Lịch cũ chưa có phòng được tính là phòng đầu tiên.
const API = 'api.php';
const ROOMS = [{ id: 'tret', name: 'Phòng Trệt', short: 'Trệt' }, { id: 'tang2', name: 'Phòng Tầng 2', short: 'Tầng 2' }];
const MONTH_NAMES = ['tháng 1', 'tháng 2', 'tháng 3', 'tháng 4', 'tháng 5', 'tháng 6', 'tháng 7', 'tháng 8', 'tháng 9', 'tháng 10', 'tháng 11', 'tháng 12'];

const state = {
  selectedDate: startOfDay(new Date()),
  view: window.matchMedia('(max-width: 760px)').matches ? 'day' : 'week',
  meetings: [],
  loading: true,
  miniMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  editingId: null,
  module: 'room',
  person: '',
  room: '',
};

const ui = {
  periodLabel: document.querySelector('#periodLabel'),
  calendarView: document.querySelector('#calendarView'),
  miniMonthLabel: document.querySelector('#miniMonthLabel'),
  miniDays: document.querySelector('#miniDays'),
  modal: document.querySelector('#meetingModal'),
  form: document.querySelector('#meetingForm'),
  error: document.querySelector('#formError'),
  save: document.querySelector('#saveMeeting'),
  toast: document.querySelector('#toast'),
  details: document.querySelector('#meetingDetails'),
  people: document.querySelector('#people'),
  peopleOptions: document.querySelector('#peopleOptions'),
  withField: document.querySelector('#withField'),
  withInput: document.querySelector('#meetingWith'),
  roomField: document.querySelector('#roomField'),
  roomInput: document.querySelector('#meetingRoom'),
};

function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function dateKey(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function parseDate(key) { const [year, month, day] = key.split('-').map(Number); return new Date(year, month - 1, day); }
function addDays(date, amount) { const next = new Date(date); next.setDate(next.getDate() + amount); return next; }
function mondayOf(date) { const day = (date.getDay() + 6) % 7; return addDays(startOfDay(date), -day); }
function hourHeight() { return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--calendar-hour-height')) || 58; }
function formatDate(date, options = {}) { return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', ...options }).format(date); }
function isToday(date) { return dateKey(date) === dateKey(new Date()); }
function meetingHasEnded(meeting) { return new Date(`${meeting.date}T${meeting.endTime}:00+07:00`).getTime() <= Date.now(); }
function supportsMeetingDrag() { return window.matchMedia('(hover: hover) and (pointer: fine)').matches; }
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function typeOf(meeting) { return meeting.type === 'private' ? 'private' : 'room'; }
function roomOf(meeting) { return ROOMS.find((room) => room.id === meeting.room) || ROOMS[0]; }
function meetingClass(meeting) { return typeOf(meeting) === 'room' ? `room-${roomOf(meeting).id}` : ''; }
function sameName(first = '', second = '') { return first.trim().toLowerCase() === second.trim().toLowerCase(); }
function minutesAt(column, clientY) { return HOUR_START * 60 + Math.max(0, Math.floor((clientY - column.getBoundingClientRect().top) / hourHeight() * 2) * 30); }

function visibleMeetings() {
  return state.meetings.filter((meeting) => typeOf(meeting) === state.module && (state.module === 'room'
    ? !state.room || roomOf(meeting).id === state.room
    : !state.person || sameName(meeting.withWhom, state.person)));
}

function peopleList() {
  const names = [...DEFAULT_PEOPLE];
  state.meetings.forEach((meeting) => {
    if (typeOf(meeting) === 'private' && meeting.withWhom && !names.some((name) => sameName(name, meeting.withWhom))) names.push(meeting.withWhom);
  });
  return names;
}

// Xếp các cuộc họp trùng giờ (khác phòng hoặc khác người, khi xem "Tất cả") thành các cột cạnh nhau.
function assignLanes(meetings) {
  const placed = [];
  let group = [];
  let laneEnds = [];
  const closeGroup = () => { group.forEach((item) => { item.lanes = laneEnds.length; }); group = []; laneEnds = []; };
  [...meetings].sort((a, b) => a.startTime.localeCompare(b.startTime)).forEach((meeting) => {
    if (laneEnds.every((end) => end <= meeting.startTime)) closeGroup();
    let lane = laneEnds.findIndex((end) => end <= meeting.startTime);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = meeting.endTime;
    group.push({ meeting, lane });
    placed.push(group.at(-1));
  });
  closeGroup();
  return placed;
}

// Chỉ dùng GET và POST vì nhiều hosting chặn PUT/DELETE.
function postAction(action, data) {
  return fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, action }) });
}

async function loadMeetings() {
  try {
    const response = await fetch(API);
    if (!response.ok) throw new Error('Không tải được lịch.');
    state.meetings = await response.json();
    state.loading = false;
    render();
  } catch {
    state.loading = false;
    showToast('Không kết nối được lịch dùng chung. Hãy tải lại trang sau ít phút.');
    render();
  }
}

async function refreshMeetings() {
  try {
    const response = await fetch(API);
    if (!response.ok) return;
    const latest = await response.json();
    if (JSON.stringify(latest) === JSON.stringify(state.meetings)) return;
    state.meetings = latest;
    render();
  } catch {
    // Keep the last loaded calendar visible during a temporary connection issue.
  }
}

function render() {
  renderTabs();
  renderPeriodLabel();
  renderMiniCalendar();
  renderCalendar();
  updateEndedMeetingStyles();
  document.querySelectorAll('.view-button').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
}

function renderTabs() {
  const upcoming = state.meetings.filter((meeting) => !meetingHasEnded(meeting));
  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.module === state.module;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active);
    tab.querySelector('.badge').textContent = upcoming.filter((meeting) => typeOf(meeting) === tab.dataset.module).length;
  });
  const people = peopleList();
  if (!people.some((name) => sameName(name, state.person))) state.person = '';
  ui.people.innerHTML = state.module === 'private'
    ? `<span class="people-label">Họp với</span>${['', ...people].map((name) => `<button class="chip ${sameName(name, state.person) ? 'active' : ''}" type="button" data-person="${escapeHtml(name)}">${name ? escapeHtml(name) : 'Tất cả'}</button>`).join('')}`
    : `<span class="people-label">Phòng</span>${[{ id: '', name: 'Tất cả' }, ...ROOMS].map((room) => `<button class="chip ${room.id === state.room ? 'active' : ''}" type="button" data-room="${room.id}">${room.id ? `<i class="chip-dot room-${room.id}"></i>` : ''}${room.name}</button>`).join('')}`;
  ui.peopleOptions.innerHTML = people.map((name) => `<option value="${escapeHtml(name)}"></option>`).join('');
}

function updateEndedMeetingStyles() {
  ui.calendarView.querySelectorAll('[data-meeting-id]').forEach((card) => {
    const meeting = state.meetings.find((item) => item.id === card.dataset.meetingId);
    card.classList.toggle('ended', Boolean(meeting && meetingHasEnded(meeting)));
  });
}

function renderPeriodLabel() {
  if (state.view === 'day') {
    ui.periodLabel.textContent = formatDate(state.selectedDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } else if (state.view === 'month') {
    ui.periodLabel.textContent = formatDate(state.selectedDate, { month: 'long', year: 'numeric' });
  } else {
    const start = mondayOf(state.selectedDate);
    const end = addDays(start, 6);
    if (start.getMonth() === end.getMonth()) {
      ui.periodLabel.textContent = `${start.getDate()} – ${end.getDate()} ${MONTH_NAMES[end.getMonth()]}, ${end.getFullYear()}`;
    } else {
      ui.periodLabel.textContent = `${start.getDate()} ${MONTH_NAMES[start.getMonth()]} – ${end.getDate()} ${MONTH_NAMES[end.getMonth()]}, ${end.getFullYear()}`;
    }
  }
}

function renderMiniCalendar() {
  const year = state.miniMonth.getFullYear();
  const month = state.miniMonth.getMonth();
  ui.miniMonthLabel.textContent = `${MONTH_NAMES[month]} ${year}`;
  const first = new Date(year, month, 1);
  const gridStart = mondayOf(first);
  const todayKey = dateKey(new Date());
  const selectedKey = dateKey(state.selectedDate);
  const meetingDates = new Set(visibleMeetings().map((meeting) => meeting.date));
  ui.miniDays.innerHTML = Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index);
    const key = dateKey(date);
    const classes = ['mini-day', date.getMonth() !== month ? 'outside' : '', key === todayKey ? 'today' : '', key === selectedKey ? 'selected' : '', meetingDates.has(key) ? 'has-meeting' : ''].filter(Boolean).join(' ');
    return `<button class="${classes}" type="button" data-date="${key}">${date.getDate()}</button>`;
  }).join('');
}

function renderCalendar() {
  if (state.loading) {
    ui.calendarView.innerHTML = '<div class="empty-state"><span>Đang tải lịch…</span></div>';
    return;
  }
  if (state.view === 'month') return renderMonth();
  return renderTimeGrid(state.view === 'day' ? [startOfDay(state.selectedDate)] : Array.from({ length: 7 }, (_, index) => addDays(mondayOf(state.selectedDate), index)));
}

function renderTimeGrid(days) {
  const isDayView = days.length === 1;
  const hourPixels = hourHeight();
  const visible = visibleMeetings();
  const heading = days.map((date, index) => `<div class="day-heading ${isToday(date) ? 'today' : ''} ${dateKey(date) === dateKey(state.selectedDate) && !isToday(date) ? 'selected-day' : ''}"><span class="weekday">${isDayView ? formatDate(date, { weekday: 'long' }) : DAY_NAMES[index]}</span><span class="day-number">${date.getDate()}</span></div>`).join('');
  const labels = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, index) => `<div class="time-label" style="top:${index * hourPixels}px"><span>${String(HOUR_START + index).padStart(2, '0')}:00</span></div>`).join('');
  const columns = days.map((date) => {
    const key = dateKey(date);
    const cards = assignLanes(visible.filter((meeting) => meeting.date === key)).map(({ meeting, lane, lanes }) => {
      const start = toMinutes(meeting.startTime);
      const end = toMinutes(meeting.endTime);
      const top = Math.max(0, (start - HOUR_START * 60) / 60 * hourPixels);
      const height = Math.max(33, (end - start) / 60 * hourPixels - 3);
      return `<button class="meeting-card ${meetingClass(meeting)}" style="top:${top}px;height:${height}px;left:calc(${lane / lanes * 100}% + 3px);width:calc(${100 / lanes}% - 6px)" type="button" draggable="${supportsMeetingDrag()}" data-meeting-id="${escapeHtml(meeting.id)}"><strong>${escapeHtml(meeting.title)}</strong><span class="meeting-time">${escapeHtml(meeting.startTime)} – ${escapeHtml(meeting.endTime)}</span><span class="meeting-owner">${escapeHtml(typeOf(meeting) === 'private' ? `Với ${meeting.withWhom}` : `${roomOf(meeting).short} · ${meeting.organizer}`)}</span></button>`;
    }).join('');
    const now = new Date();
    const currentLine = isToday(date) && now.getHours() >= HOUR_START && now.getHours() < HOUR_END ? `<div class="time-now-line" style="top:${((now.getHours() + now.getMinutes() / 60) - HOUR_START) * hourPixels}px"></div>` : '';
    return `<div class="day-column ${isToday(date) ? 'today-column' : ''} ${dateKey(date) === dateKey(state.selectedDate) ? 'selected-day' : ''}" data-date="${key}">${cards}${currentLine}</div>`;
  }).join('');
  ui.calendarView.innerHTML = `<div class="${isDayView ? 'day-calendar' : 'week-calendar'}"><div class="week-header"><div class="week-corner"></div>${heading}</div><div class="time-grid"><div class="time-axis">${labels}</div>${columns}</div></div>`;
}

function renderMonth() {
  const year = state.selectedDate.getFullYear();
  const month = state.selectedDate.getMonth();
  const gridStart = mondayOf(new Date(year, month, 1));
  const todayKey = dateKey(new Date());
  const visible = visibleMeetings();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index);
    const key = dateKey(date);
    const meetings = visible.filter((meeting) => meeting.date === key).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const events = meetings.slice(0, 3).map((meeting) => `<button class="month-event ${meetingClass(meeting)}" type="button" draggable="${supportsMeetingDrag()}" data-meeting-id="${escapeHtml(meeting.id)}"><span class="month-event-time">${escapeHtml(meeting.startTime)}–${escapeHtml(meeting.endTime)}</span><span class="month-event-title"> · ${escapeHtml(meeting.title)}</span></button>`).join('');
    const more = meetings.length > 3 ? `<span class="month-more">+${meetings.length - 3} cuộc họp</span>` : '';
    return `<div class="month-cell ${date.getMonth() !== month ? 'outside' : ''} ${key === todayKey ? 'today' : ''}" role="gridcell" tabindex="0" data-date="${key}"><span class="month-date">${date.getDate()}</span>${events}${more}</div>`;
  }).join('');
  ui.calendarView.innerHTML = `<div class="month-calendar"><div class="month-weekdays">${DAY_NAMES.map((day) => `<span>${day}</span>`).join('')}</div><div class="month-grid" role="grid" aria-label="Lịch tháng">${cells}</div></div>`;
}

function toMinutes(time) { const [hour, minute] = time.split(':').map(Number); return hour * 60 + minute; }
function minutesToTime(minutes) { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`; }

function openModal(options = {}) {
  ui.details.hidden = true;
  ui.form.reset();
  ui.error.hidden = true;
  const meeting = options.meeting;
  const isPrivate = (meeting ? typeOf(meeting) : state.module) === 'private';
  state.editingId = meeting?.id || null;
  ui.form.elements.type.value = isPrivate ? 'private' : 'room';
  ui.withField.hidden = !isPrivate;
  ui.withInput.required = isPrivate;
  ui.roomField.hidden = isPrivate;
  ui.roomInput.value = meeting ? roomOf(meeting).id : state.room || ROOMS[0].id;
  ui.withInput.value = meeting?.withWhom || state.person;
  document.querySelector('#modalTitle').textContent = meeting ? 'Chỉnh sửa cuộc họp' : isPrivate ? 'Đặt lịch họp riêng' : 'Đặt phòng họp';
  document.querySelector('#modalSubtitle').textContent = isPrivate ? 'Họp riêng · không dùng phòng họp chung' : 'Phòng họp · GoMax Digital';
  ui.save.querySelector('span').textContent = meeting ? 'Lưu thay đổi' : 'Lưu cuộc họp';
  document.querySelector('#meetingTitle').value = meeting?.title || '';
  document.querySelector('#meetingDate').value = meeting?.date || options.date || dateKey(state.selectedDate);
  document.querySelector('#meetingStart').value = meeting?.startTime || options.startTime || '09:00';
  document.querySelector('#meetingEnd').value = meeting?.endTime || options.endTime || '10:00';
  document.querySelector('#meetingOrganizer').value = meeting?.organizer || '';
  document.querySelector('#meetingAttendees').value = meeting?.attendees?.join(', ') || '';
  document.querySelector('#meetingNotes').value = meeting?.notes || '';
  ui.modal.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.querySelector('#meetingTitle').focus(), 30);
}

function closeModal() {
  ui.modal.hidden = true;
  document.body.style.overflow = '';
}

async function saveMeeting(event) {
  event.preventDefault();
  ui.error.hidden = true;
  const formData = new FormData(ui.form);
  const payload = {
    type: formData.get('type'), room: formData.get('room'), withWhom: formData.get('withWhom'), title: formData.get('title'), date: formData.get('date'), startTime: formData.get('startTime'), endTime: formData.get('endTime'), organizer: formData.get('organizer'),
    attendees: String(formData.get('attendees') || '').split(',').map((name) => name.trim()).filter(Boolean), notes: formData.get('notes'),
  };
  if (payload.startTime >= payload.endTime) {
    return showFormError('Giờ kết thúc cần sau giờ bắt đầu.');
  }
  ui.save.disabled = true;
  ui.save.querySelector('span').textContent = 'Đang lưu…';
  try {
    const response = await postAction('save', { ...payload, id: state.editingId });
    const result = await response.json();
    if (!response.ok) return showFormError(result.error || 'Không thể lưu cuộc họp.');
    if (state.editingId) state.meetings = state.meetings.map((meeting) => meeting.id === result.id ? result : meeting);
    else state.meetings.push(result);
    state.meetings.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    state.module = typeOf(result);
    if (state.person && !sameName(state.person, result.withWhom)) state.person = '';
    if (state.room && state.room !== result.room) state.room = '';
    state.selectedDate = parseDate(result.date);
    state.miniMonth = new Date(state.selectedDate.getFullYear(), state.selectedDate.getMonth(), 1);
    closeModal();
    render();
    showToast(state.editingId ? 'Đã cập nhật cuộc họp.' : 'Đã thêm cuộc họp vào lịch.');
    state.editingId = null;
  } catch {
    showFormError('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.');
  } finally {
    ui.save.disabled = false;
    ui.save.querySelector('span').textContent = state.editingId ? 'Lưu thay đổi' : 'Lưu cuộc họp';
  }
}

function showFormError(message) { ui.error.textContent = message; ui.error.hidden = false; }

function openMeetingDetails(id, anchor) {
  const meeting = state.meetings.find((item) => item.id === id);
  if (!meeting) return;
  const date = parseDate(meeting.date);
  const meetingId = escapeHtml(meeting.id);
  const dateLabel = formatDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  ui.details.innerHTML = `
    <button class="icon-button detail-close" type="button" aria-label="Đóng"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg></button>
    <div class="detail-kicker">${typeOf(meeting) === 'private' ? `Họp riêng với ${escapeHtml(meeting.withWhom)}` : roomOf(meeting).name}</div>
    <div class="detail-title">${escapeHtml(meeting.title)}</div>
    <div class="detail-line">
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/></svg>
      <span>${dateLabel}<br>${escapeHtml(meeting.startTime)} – ${escapeHtml(meeting.endTime)}</span>
    </div>
    <div class="detail-line">
      <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="6.5" r="3"/><path d="M4 17c.4-3 2.4-4.5 6-4.5s5.6 1.5 6 4.5"/></svg>
      <span>Đăng ký bởi ${escapeHtml(meeting.organizer)}</span>
    </div>
    ${meeting.attendees?.length ? `<div class="detail-line"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="7" cy="7" r="2.5"/><path d="M2.5 16c.3-2.3 1.8-3.5 4.5-3.5s4.2 1.2 4.5 3.5m2-10.5a2.5 2.5 0 0 1 0 5m1 2c1.8.5 2.8 1.7 3 3"/></svg><span>${meeting.attendees.map(escapeHtml).join(', ')}</span></div>` : ''}
    ${meeting.notes ? `<div class="detail-line detail-notes"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5h12M4 10h12M4 15h8"/></svg><span>${escapeHtml(meeting.notes)}</span></div>` : ''}
    <div class="detail-actions">
      <button class="btn" type="button" data-edit-id="${meetingId}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m13.8 3.8 2.4 2.4M3.5 16.5l3.8-.8L16 7a1.7 1.7 0 0 0-2.4-2.4L4.9 13.3l-1.4 3.2Z"/></svg><span>Chỉnh sửa</span></button>
      <button class="btn btn-danger" type="button" data-delete-id="${meetingId}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 5.5h13m-11.5 0 .8 11h7.4l.8-11M7 5.5V3.8h6v1.7m-4 3v5m2-5v5"/></svg><span>Xóa</span></button>
    </div>`;
  ui.details.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const popoverRect = ui.details.getBoundingClientRect();
  ui.details.style.left = `${Math.min(Math.max(12, rect.left), window.innerWidth - popoverRect.width - 12)}px`;
  ui.details.style.top = `${Math.min(Math.max(12, rect.bottom + 7), window.innerHeight - popoverRect.height - 12)}px`;
}

async function deleteMeeting(id) {
  if (!window.confirm('Bạn có chắc muốn xóa cuộc họp này khỏi lịch?')) return;
  try {
    const response = await postAction('delete', { id });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không thể xóa cuộc họp.');
    state.meetings = state.meetings.filter((meeting) => meeting.id !== id);
    ui.details.hidden = true;
    render();
    showToast('Đã xóa cuộc họp.');
  } catch (error) {
    showToast(error.message || 'Không kết nối được máy chủ.');
  }
}

async function moveMeeting(id, updates) {
  const previous = state.meetings.find((meeting) => meeting.id === id);
  if (!previous) return;
  const payload = { ...previous, ...updates };
  try {
    const response = await postAction('save', payload);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không thể chuyển cuộc họp.');
    state.meetings = state.meetings.map((meeting) => meeting.id === id ? result : meeting);
    state.meetings.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
    render();
    showToast('Đã cập nhật thời gian cuộc họp.');
  } catch (error) {
    showToast(error.message || 'Không kết nối được máy chủ.');
  }
}

let toastTimer;
function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('visible'), 3000);
}

function shiftPeriod(amount) {
  if (state.view === 'month') state.selectedDate = new Date(state.selectedDate.getFullYear(), state.selectedDate.getMonth() + amount, 1);
  else state.selectedDate = addDays(state.selectedDate, amount * (state.view === 'week' ? 7 : 1));
  state.miniMonth = new Date(state.selectedDate.getFullYear(), state.selectedDate.getMonth(), 1);
  render();
}

document.querySelector('#createMeeting').addEventListener('click', () => openModal());
document.querySelector('.tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('[data-module]');
  if (!tab) return;
  state.module = tab.dataset.module;
  ui.details.hidden = true;
  render();
});
ui.people.addEventListener('click', (event) => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  if (state.module === 'private') state.person = chip.dataset.person;
  else state.room = chip.dataset.room;
  render();
});
document.querySelector('#closeModal').addEventListener('click', closeModal);
document.querySelector('#cancelModal').addEventListener('click', closeModal);
ui.modal.addEventListener('click', (event) => { if (event.target === ui.modal) closeModal(); });
ui.form.addEventListener('submit', saveMeeting);
document.querySelector('#todayButton').addEventListener('click', () => { state.selectedDate = startOfDay(new Date()); state.miniMonth = new Date(state.selectedDate.getFullYear(), state.selectedDate.getMonth(), 1); render(); });
document.querySelector('#prevPeriod').addEventListener('click', () => shiftPeriod(-1));
document.querySelector('#nextPeriod').addEventListener('click', () => shiftPeriod(1));
document.querySelector('#miniPrev').addEventListener('click', () => { state.miniMonth = new Date(state.miniMonth.getFullYear(), state.miniMonth.getMonth() - 1, 1); renderMiniCalendar(); });
document.querySelector('#miniNext').addEventListener('click', () => { state.miniMonth = new Date(state.miniMonth.getFullYear(), state.miniMonth.getMonth() + 1, 1); renderMiniCalendar(); });
document.querySelectorAll('.view-button').forEach((button) => button.addEventListener('click', () => { state.view = button.dataset.view; render(); }));
ui.miniDays.addEventListener('click', (event) => {
  const button = event.target.closest('[data-date]');
  if (!button) return;
  state.selectedDate = parseDate(button.dataset.date);
  state.miniMonth = new Date(state.selectedDate.getFullYear(), state.selectedDate.getMonth(), 1);
  render();
});
ui.calendarView.addEventListener('click', (event) => {
  const card = event.target.closest('[data-meeting-id]');
  if (card) {
    event.stopPropagation();
    openMeetingDetails(card.dataset.meetingId, card);
    return;
  }
  const cell = event.target.closest('.month-cell');
  if (cell) {
    state.selectedDate = parseDate(cell.dataset.date);
    return openModal({ date: cell.dataset.date, startTime: '09:00', endTime: '10:00' });
  }
  const column = event.target.closest('.day-column');
  if (column) {
    const start = Math.min(minutesAt(column, event.clientY), HOUR_END * 60 - 60);
    openModal({ date: column.dataset.date, startTime: minutesToTime(start), endTime: minutesToTime(start + 60) });
  }
});
ui.calendarView.addEventListener('dragstart', (event) => {
  const card = event.target.closest('[data-meeting-id]');
  if (!card || !event.dataTransfer) return;
  event.dataTransfer.setData('text/plain', card.dataset.meetingId);
  event.dataTransfer.effectAllowed = 'move';
  card.classList.add('dragging');
});
ui.calendarView.addEventListener('dragend', (event) => {
  event.target.closest('[data-meeting-id]')?.classList.remove('dragging');
  ui.calendarView.querySelectorAll('.drop-target').forEach((target) => target.classList.remove('drop-target'));
});
ui.calendarView.addEventListener('dragover', (event) => {
  const target = event.target.closest('.day-column, .month-cell');
  if (!target) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  target.classList.add('drop-target');
});
ui.calendarView.addEventListener('dragleave', (event) => {
  const target = event.target.closest('.day-column, .month-cell');
  if (target && !target.contains(event.relatedTarget)) target.classList.remove('drop-target');
});
ui.calendarView.addEventListener('drop', (event) => {
  const column = event.target.closest('.day-column');
  const cell = event.target.closest('.month-cell');
  const target = column || cell;
  const id = event.dataTransfer?.getData('text/plain');
  if (!target || !id) return;
  event.preventDefault();
  target.classList.remove('drop-target');
  if (cell) return moveMeeting(id, { date: cell.dataset.date });
  const meeting = state.meetings.find((item) => item.id === id);
  if (!meeting) return;
  const duration = toMinutes(meeting.endTime) - toMinutes(meeting.startTime);
  const start = Math.min(minutesAt(column, event.clientY), HOUR_END * 60 - duration);
  return moveMeeting(id, { date: column.dataset.date, startTime: minutesToTime(start), endTime: minutesToTime(start + duration) });
});
ui.calendarView.addEventListener('keydown', (event) => {
  const cell = event.target.closest('.month-cell');
  if (!cell || event.target !== cell || !['Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  state.selectedDate = parseDate(cell.dataset.date);
  openModal({ date: cell.dataset.date, startTime: '09:00', endTime: '10:00' });
});
ui.details.addEventListener('click', (event) => {
  if (event.target.closest('.detail-close')) ui.details.hidden = true;
  const editButton = event.target.closest('[data-edit-id]');
  if (editButton) {
    const meeting = state.meetings.find((item) => item.id === editButton.dataset.editId);
    if (meeting) openModal({ meeting });
  }
  const deleteButton = event.target.closest('[data-delete-id]');
  if (deleteButton) deleteMeeting(deleteButton.dataset.deleteId);
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('#meetingDetails') && !event.target.closest('[data-meeting-id]')) ui.details.hidden = true;
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeModal(); ui.details.hidden = true; } });

ui.roomInput.innerHTML = ROOMS.map((room) => `<option value="${room.id}">${room.name}</option>`).join('');
render();
loadMeetings();
setInterval(refreshMeetings, 15000);
setInterval(updateEndedMeetingStyles, 30000);
