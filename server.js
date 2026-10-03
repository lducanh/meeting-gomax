const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const ROOT = __dirname;
// Đọc cấu hình email từ .env nếu có (cần Node 20.12+; bản cũ hơn thì dùng biến môi trường).
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch {}

const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'meetings.json');
const PORT = Number(process.env.PORT || 3000);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};
const ROOMS = { tret: 'Phòng Trệt', tang2: 'Phòng Tầng 2' };
const { SMTP_USER } = process.env;
// Google hiển thị App Password thành 4 nhóm cách nhau bằng dấu cách; bỏ dấu cách để dán nguyên cũng chạy.
const SMTP_PASS = (process.env.SMTP_PASS || '').replace(/\s/g, '');
const NOTIFY_TO = process.env.NOTIFY_TO || SMTP_USER;
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const mailer = SMTP_USER && SMTP_PASS
  ? require('nodemailer').createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  })
  : null;
let mutationQueue = Promise.resolve();

function serializeMutation(action) {
  const result = mutationQueue.then(action);
  mutationQueue = result.catch(() => {});
  return result;
}

async function readMeetings() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const text = await fs.readFile(DATA_FILE, 'utf8');
    const entries = JSON.parse(text);
    return Array.isArray(entries) ? entries : [];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.writeFile(DATA_FILE, '[]\n', 'utf8');
    return [];
  }
}

async function writeMeetings(meetings) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temporaryFile = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify(meetings, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryFile, DATA_FILE);
}

function json(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': MIME_TYPES['.json'],
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error('Request too large'));
    });
    request.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON')); }
    });
    request.on('error', reject);
  });
}

function typeOf(meeting) {
  return meeting.type === 'private' ? 'private' : 'room';
}

function roomOf(meeting) {
  return Object.hasOwn(ROOMS, meeting.room) ? meeting.room : 'tret';
}

// Phòng họp chỉ trùng khi cùng phòng; họp riêng chỉ trùng khi cùng một người được hẹn.
function overlaps(first, second) {
  if (typeOf(first) !== typeOf(second)) return false;
  if (typeOf(first) === 'room' && roomOf(first) !== roomOf(second)) return false;
  if (typeOf(first) === 'private' && first.withWhom.toLowerCase() !== String(second.withWhom || '').toLowerCase()) return false;
  return first.date === second.date && first.startTime < second.endTime && second.startTime < first.endTime;
}

const ROOM_COLORS = { tret: '#0191fb', tang2: '#f76b15' };
const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

// Gửi sau khi lịch đã lưu; lỗi gửi mail chỉ ghi log, không ảnh hưởng việc đặt lịch.
// Tiêu đề mở đầu bằng [phòng] hoặc [Họp riêng · người] để nhận ra ngay trong hộp thư; màu thanh trên cùng khớp màu phòng trên lịch.
function notifyNewMeeting(meeting) {
  if (!mailer) return;
  const isPrivate = meeting.type === 'private';
  const place = isPrivate ? `Họp riêng · ${meeting.withWhom}` : ROOMS[meeting.room];
  const color = isPrivate ? '#1c2024' : ROOM_COLORS[meeting.room];
  const [year, month, day] = meeting.date.split('-');
  const weekday = WEEKDAYS[new Date(`${meeting.date}T12:00:00+07:00`).getUTCDay()];
  const when = `${weekday} ${day}/${month}/${year}, ${meeting.startTime}–${meeting.endTime}`;
  const rows = [
    [isPrivate ? 'Họp với' : 'Phòng', isPrivate ? meeting.withWhom : ROOMS[meeting.room]],
    ['Thời gian', `${when} (UTC+7)`],
    ['Người đăng ký', meeting.organizer],
    ['Người tham dự', meeting.attendees.join(', ')],
    ['Ghi chú', meeting.notes],
  ].filter(([, value]) => value);
  const html = `<div style="font-family:Roboto,Arial,sans-serif;font-size:14px;line-height:20px;color:#1c2024;max-width:480px;border:1px solid #e0e1e6;border-top:4px solid ${color};border-radius:8px;padding:16px 20px">
<div style="font-size:12px;font-weight:bold;color:${color}">${escapeHtml(place)}</div>
<div style="font-size:18px;line-height:26px;font-weight:bold;margin:2px 0 12px">${escapeHtml(meeting.title)}</div>
<table style="border-collapse:collapse;font-size:14px;line-height:20px">${rows.map(([label, value]) => `<tr><td style="padding:3px 16px 3px 0;color:#6b6f76;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:3px 0;white-space:pre-wrap">${escapeHtml(value)}</td></tr>`).join('')}</table>
</div>`;
  mailer.sendMail({
    from: { name: 'Lịch phòng họp GOMAX', address: SMTP_USER },
    to: NOTIFY_TO,
    subject: `[${place}] ${meeting.title} · ${weekday} ${day}/${month}, ${meeting.startTime}–${meeting.endTime}`,
    text: [meeting.title, ...rows.map(([label, value]) => `${label}: ${value}`)].join('\n'),
    html,
  }).catch((error) => console.error(`Không gửi được email thông báo: ${error.message}`));
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    if (url.pathname === '/api/meetings' && request.method === 'GET') {
      return json(response, 200, await readMeetings());
    }

    const isMeetingUpdate = request.method === 'PUT' && /^\/api\/meetings\/[^/]+$/.test(url.pathname);
    if ((url.pathname === '/api/meetings' && request.method === 'POST') || isMeetingUpdate) {
      const updateId = isMeetingUpdate ? decodeURIComponent(url.pathname.slice('/api/meetings/'.length)) : null;
      const input = await readBody(request);
      const type = typeOf(input);
      const meeting = {
        type,
        ...(type === 'private' ? { withWhom: String(input.withWhom || '').trim() } : { room: roomOf(input) }),
        title: String(input.title || '').trim(),
        date: String(input.date || ''),
        startTime: String(input.startTime || ''),
        endTime: String(input.endTime || ''),
        organizer: String(input.organizer || '').trim(),
        attendees: Array.isArray(input.attendees) ? input.attendees.map(String).map((name) => name.trim()).filter(Boolean) : [],
        notes: String(input.notes || '').trim(),
      };
      const parsedDate = new Date(`${meeting.date}T12:00:00+07:00`);
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(meeting.date) && !Number.isNaN(parsedDate.getTime())
        && parsedDate.toISOString().slice(0, 10) === meeting.date;
      const validTime = (time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

      if (!meeting.title || !meeting.organizer || (type === 'private' && !meeting.withWhom) || !validDate
        || !validTime(meeting.startTime) || !validTime(meeting.endTime)
        || meeting.startTime < '08:00' || meeting.endTime > '20:00'
        || meeting.startTime >= meeting.endTime) {
        return json(response, 400, { error: 'Vui lòng kiểm tra tên cuộc họp, người họp cùng, ngày giờ (08:00–20:00) và người đăng ký.' });
      }

      return await serializeMutation(async () => {
        const meetings = await readMeetings();
        const existingIndex = updateId ? meetings.findIndex((item) => item.id === updateId) : -1;
        if (updateId && existingIndex < 0) return json(response, 404, { error: 'Không tìm thấy cuộc họp.' });
        const conflict = meetings.find((item) => item.id !== updateId && overlaps(item, meeting));
        if (conflict) {
          return json(response, 409, { error: `${type === 'private' ? `${conflict.withWhom} đã có lịch` : `${ROOMS[meeting.room]} đã có lịch`} “${conflict.title}” (${conflict.startTime}–${conflict.endTime}).` });
        }

        const previous = existingIndex >= 0 ? meetings[existingIndex] : null;
        const saved = {
          ...meeting,
          id: updateId || randomUUID(),
          createdAt: previous?.createdAt || new Date().toISOString(),
          ...(previous ? { updatedAt: new Date().toISOString() } : {}),
        };
        if (existingIndex >= 0) meetings[existingIndex] = saved;
        else meetings.push(saved);
        meetings.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
        await writeMeetings(meetings);
        if (!updateId) notifyNewMeeting(saved);
        return json(response, updateId ? 200 : 201, saved);
      });
    }

    if (url.pathname.startsWith('/api/meetings/') && request.method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.slice('/api/meetings/'.length));
      return await serializeMutation(async () => {
        const meetings = await readMeetings();
        const nextMeetings = meetings.filter((item) => item.id !== id);
        if (nextMeetings.length === meetings.length) return json(response, 404, { error: 'Không tìm thấy cuộc họp.' });
        await writeMeetings(nextMeetings);
        return json(response, 200, { ok: true });
      });
    }

    if (url.pathname.startsWith('/api/')) return json(response, 404, { error: 'Không tìm thấy API.' });

    const requestedPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const resolved = path.resolve(ROOT, `.${requestedPath}`);
    // Chỉ phục vụ file giao diện; chặn .env, dữ liệu, mã nguồn server và node_modules.
    const isPublic = /^\/(index\.html|app\.js|styles\.css|[\w-]+\.webp)$/.test(requestedPath);
    if (!isPublic || !resolved.startsWith(`${ROOT}${path.sep}`)) {
      response.writeHead(403);
      return response.end('Forbidden');
    }
    const file = await fs.readFile(resolved);
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(resolved)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    return response.end(file);
  } catch (error) {
    const status = error.message === 'Invalid JSON' || error.message === 'Request too large' ? 400 : 500;
    return json(response, status, { error: status === 500 ? 'Không thể xử lý yêu cầu lúc này.' : error.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`GoMax room calendar is ready at http://localhost:${PORT}`);
  console.log(mailer ? `Email thông báo lịch mới gửi đến ${NOTIFY_TO}` : 'Chưa bật email thông báo (thiếu SMTP_USER hoặc SMTP_PASS trong .env).');
});
