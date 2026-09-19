const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const ROOT = __dirname;
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

function overlaps(first, second) {
  return first.date === second.date && first.startTime < second.endTime && second.startTime < first.endTime;
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
      const meeting = {
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

      if (!meeting.title || !meeting.organizer || !validDate
        || !validTime(meeting.startTime) || !validTime(meeting.endTime)
        || meeting.startTime < '08:00' || meeting.endTime > '20:00'
        || meeting.startTime >= meeting.endTime) {
        return json(response, 400, { error: 'Vui lòng kiểm tra tên cuộc họp, ngày giờ và người đăng ký.' });
      }

      return await serializeMutation(async () => {
        const meetings = await readMeetings();
        const existingIndex = updateId ? meetings.findIndex((item) => item.id === updateId) : -1;
        if (updateId && existingIndex < 0) return json(response, 404, { error: 'Không tìm thấy cuộc họp.' });
        const conflict = meetings.find((item) => item.id !== updateId && overlaps(item, meeting));
        if (conflict) {
          return json(response, 409, { error: `Khung giờ này đã có “${conflict.title}” (${conflict.startTime}–${conflict.endTime}).` });
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
    if (!resolved.startsWith(`${ROOT}${path.sep}`) && resolved !== path.join(ROOT, 'index.html')) {
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
});
