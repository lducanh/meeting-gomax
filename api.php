<?php
// API lịch họp cho hosting PHP (7.4+), không cần thư viện ngoài.
// GET: trả danh sách lịch. POST JSON: {action: "save", ...} để tạo/sửa (có id là sửa), {action: "delete", id} để xóa.

const DATA_FILE = __DIR__ . '/data/meetings.json';
// Giữ id khớp với ROOMS trong app.js. Lịch cũ chưa có phòng được tính là phòng đầu tiên.
const ROOMS = ['tret' => 'Phòng Trệt', 'tang2' => 'Phòng Tầng 2'];
const ROOM_COLORS = ['tret' => '#0191fb', 'tang2' => '#f76b15'];
const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function respond(int $status, $payload): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function text(array $input, string $key): string
{
    return is_scalar($input[$key] ?? null) ? trim((string) $input[$key]) : '';
}

function lower(string $value): string
{
    return function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);
}

function typeOf(array $meeting): string
{
    return ($meeting['type'] ?? '') === 'private' ? 'private' : 'room';
}

function roomOf(array $meeting): string
{
    $room = text($meeting, 'room');
    return isset(ROOMS[$room]) ? $room : 'tret';
}

// Phòng họp chỉ trùng khi cùng phòng; họp riêng chỉ trùng khi cùng một người được hẹn.
function overlaps(array $first, array $second): bool
{
    if (typeOf($first) !== typeOf($second)) return false;
    if (typeOf($first) === 'room' && roomOf($first) !== roomOf($second)) return false;
    if (typeOf($first) === 'private' && lower($first['withWhom']) !== lower(text($second, 'withWhom'))) return false;
    return $first['date'] === $second['date'] && $first['startTime'] < $second['endTime'] && $second['startTime'] < $first['endTime'];
}

function readStore($handle): array
{
    rewind($handle);
    $meetings = json_decode(stream_get_contents($handle) ?: '[]', true);
    return is_array($meetings) ? array_values($meetings) : [];
}

function writeStore($handle, array $meetings): void
{
    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, json_encode(array_values($meetings), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
    fflush($handle);
}

function encodeHeader(string $value): string
{
    return '=?UTF-8?B?' . base64_encode($value) . '?=';
}

function smtpSend(array $config, array $recipients, string $message): void
{
    $host = $config['smtp_host'] ?? 'smtp.gmail.com';
    $port = (int) ($config['smtp_port'] ?? 465);
    $socket = @stream_socket_client(($port === 465 ? 'ssl://' : 'tcp://') . "$host:$port", $errno, $error, 15);
    if (!$socket) throw new RuntimeException("Không kết nối được $host:$port ($error)");
    stream_set_timeout($socket, 15);
    $expect = function (int $code) use ($socket): void {
        do { $line = (string) fgets($socket, 1024); } while (isset($line[3]) && $line[3] === '-');
        if ((int) substr($line, 0, 3) !== $code) throw new RuntimeException(trim($line) ?: 'Máy chủ thư không phản hồi');
    };
    $send = function (string $command, int $code) use ($socket, $expect): void {
        fwrite($socket, $command . "\r\n");
        $expect($code);
    };
    $hello = 'EHLO ' . (gethostname() ?: 'localhost');
    $expect(220);
    $send($hello, 250);
    if ($port !== 465) {
        $send('STARTTLS', 220);
        stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
        $send($hello, 250);
    }
    $send('AUTH LOGIN', 334);
    $send(base64_encode($config['smtp_user']), 334);
    // Google hiển thị App Password thành 4 nhóm cách nhau bằng dấu cách; bỏ dấu cách để dán nguyên cũng chạy.
    $send(base64_encode(preg_replace('/\s/', '', $config['smtp_pass'])), 235);
    $send("MAIL FROM:<{$config['smtp_user']}>", 250);
    foreach ($recipients as $recipient) $send("RCPT TO:<$recipient>", 250);
    $send('DATA', 354);
    $send($message . "\r\n.", 250);
    fwrite($socket, "QUIT\r\n");
    fclose($socket);
}

// Gửi sau khi lịch đã lưu; lỗi gửi mail chỉ ghi log, không ảnh hưởng việc đặt lịch.
// Tiêu đề mở đầu bằng [phòng] hoặc [Họp riêng · người] để nhận ra ngay trong hộp thư; màu thanh trên cùng khớp màu phòng trên lịch.
function notifyNewMeeting(array $meeting, array $config): void
{
    $recipients = array_values(array_filter(array_map('trim', explode(',', $config['notify_to'] ?? ($config['smtp_user'] ?? '')))));
    if (!$recipients) return;
    $useSmtp = !empty($config['smtp_user']) && !empty($config['smtp_pass']);
    $isPrivate = $meeting['type'] === 'private';
    $place = $isPrivate ? "Họp riêng · {$meeting['withWhom']}" : ROOMS[$meeting['room']];
    $color = $isPrivate ? '#1c2024' : ROOM_COLORS[$meeting['room']];
    [$year, $month, $day] = explode('-', $meeting['date']);
    $weekday = WEEKDAYS[(int) gmdate('w', strtotime("{$meeting['date']} 12:00:00 UTC"))];
    $time = "{$meeting['startTime']}–{$meeting['endTime']}";
    $rows = array_filter([
        $isPrivate ? 'Họp với' : 'Phòng' => $isPrivate ? $meeting['withWhom'] : ROOMS[$meeting['room']],
        'Thời gian' => "$weekday $day/$month/$year, $time (UTC+7)",
        'Người đăng ký' => $meeting['organizer'],
        'Người tham dự' => implode(', ', $meeting['attendees']),
        'Ghi chú' => $meeting['notes'],
    ]);
    $escape = function (string $value): string { return htmlspecialchars($value, ENT_QUOTES, 'UTF-8'); };
    $plain = $meeting['title'] . "\n";
    $table = '';
    foreach ($rows as $label => $value) {
        $plain .= "$label: $value\n";
        $table .= '<tr><td style="padding:3px 16px 3px 0;color:#6b6f76;white-space:nowrap;vertical-align:top">' . $label . '</td><td style="padding:3px 0;white-space:pre-wrap">' . $escape($value) . '</td></tr>';
    }
    $html = '<div style="font-family:Roboto,Arial,sans-serif;font-size:14px;line-height:20px;color:#1c2024;max-width:480px;border:1px solid #e0e1e6;border-top:4px solid ' . $color . ';border-radius:8px;padding:16px 20px">'
        . '<div style="font-size:12px;font-weight:bold;color:' . $color . '">' . $escape($place) . '</div>'
        . '<div style="font-size:18px;line-height:26px;font-weight:bold;margin:2px 0 12px">' . $escape($meeting['title']) . '</div>'
        . '<table style="border-collapse:collapse;font-size:14px;line-height:20px">' . $table . '</table></div>';

    $host = preg_replace('/[^a-z0-9.-]/i', '', $_SERVER['HTTP_HOST'] ?? '') ?: 'localhost';
    $from = $useSmtp ? $config['smtp_user'] : "no-reply@$host";
    $subject = encodeHeader("[$place] {$meeting['title']} · $weekday $day/$month, $time");
    $boundary = 'gomax-' . bin2hex(random_bytes(8));
    $headers = [
        'From: ' . encodeHeader('Lịch phòng họp GOMAX') . " <$from>",
        'MIME-Version: 1.0',
        "Content-Type: multipart/alternative; boundary=\"$boundary\"",
    ];
    $body = '';
    foreach (['text/plain' => $plain, 'text/html' => $html] as $type => $content) {
        $body .= "--$boundary\r\nContent-Type: $type; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($content));
    }
    $body .= "--$boundary--";
    try {
        if ($useSmtp) {
            $headers[] = 'To: ' . implode(', ', $recipients);
            $headers[] = "Subject: $subject";
            $headers[] = 'Date: ' . date('r');
            $headers[] = 'Message-ID: <' . bin2hex(random_bytes(12)) . "@$host>";
            smtpSend($config, $recipients, implode("\r\n", $headers) . "\r\n\r\n" . $body);
        } elseif (!mail(implode(', ', $recipients), $subject, $body, implode("\r\n", $headers))) {
            throw new RuntimeException('Hàm mail() của hosting trả về lỗi');
        }
    } catch (Throwable $error) {
        error_log('Không gửi được email thông báo: ' . $error->getMessage());
    }
}

$config = is_file(__DIR__ . '/config.php') ? (array) require __DIR__ . '/config.php' : [];
if (!is_dir(dirname(DATA_FILE))) mkdir(dirname(DATA_FILE), 0755, true);
$store = fopen(DATA_FILE, 'c+');
if (!$store) {
    respond(500, ['error' => 'Không ghi được dữ liệu. Kiểm tra quyền ghi của thư mục data.']);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    flock($store, LOCK_SH);
    respond(200, readStore($store));
    exit;
}

$input = json_decode(file_get_contents('php://input') ?: '', true);
if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !is_array($input)) {
    respond(400, ['error' => 'Yêu cầu không hợp lệ.']);
    exit;
}

// Khóa file trong suốt quá trình đọc–sửa–ghi để hai người đặt cùng lúc không ghi đè nhau.
flock($store, LOCK_EX);
$meetings = readStore($store);
$id = text($input, 'id');
$existingIndex = null;
foreach ($meetings as $index => $item) {
    if ($id !== '' && ($item['id'] ?? '') === $id) $existingIndex = $index;
}
if ($id !== '' && $existingIndex === null) {
    respond(404, ['error' => 'Không tìm thấy cuộc họp.']);
    exit;
}

if (($input['action'] ?? '') === 'delete') {
    if ($existingIndex === null) {
        respond(404, ['error' => 'Không tìm thấy cuộc họp.']);
        exit;
    }
    array_splice($meetings, $existingIndex, 1);
    writeStore($store, $meetings);
    respond(200, ['ok' => true]);
    exit;
}

$type = typeOf($input);
$meeting = ['type' => $type]
    + ($type === 'private' ? ['withWhom' => text($input, 'withWhom')] : ['room' => roomOf($input)])
    + [
        'title' => text($input, 'title'),
        'date' => text($input, 'date'),
        'startTime' => text($input, 'startTime'),
        'endTime' => text($input, 'endTime'),
        'organizer' => text($input, 'organizer'),
        'attendees' => array_values(array_filter(array_map(function ($name) { return is_scalar($name) ? trim((string) $name) : ''; }, is_array($input['attendees'] ?? null) ? $input['attendees'] : []), 'strlen')),
        'notes' => text($input, 'notes'),
    ];
$validDate = preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $meeting['date'], $parts) && checkdate((int) $parts[2], (int) $parts[3], (int) $parts[1]);
$validTime = function (string $time): bool { return (bool) preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $time); };
if ($meeting['title'] === '' || $meeting['organizer'] === '' || ($type === 'private' && $meeting['withWhom'] === '') || !$validDate
    || !$validTime($meeting['startTime']) || !$validTime($meeting['endTime'])
    || $meeting['startTime'] < '08:00' || $meeting['endTime'] > '20:00'
    || $meeting['startTime'] >= $meeting['endTime']) {
    respond(400, ['error' => 'Vui lòng kiểm tra tên cuộc họp, người họp cùng, ngày giờ (08:00–20:00) và người đăng ký.']);
    exit;
}

foreach ($meetings as $item) {
    if (($item['id'] ?? '') !== $id && overlaps($meeting, $item)) {
        $owner = $type === 'private' ? $item['withWhom'] : ROOMS[$meeting['room']];
        respond(409, ['error' => "$owner đã có lịch “{$item['title']}” ({$item['startTime']}–{$item['endTime']})."]);
        exit;
    }
}

$now = gmdate('Y-m-d\TH:i:s\Z');
$previous = $existingIndex === null ? null : $meetings[$existingIndex];
$saved = $meeting + [
    'id' => $previous ? $id : vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex(random_bytes(16)), 4)),
    'createdAt' => $previous['createdAt'] ?? $now,
] + ($previous ? ['updatedAt' => $now] : []);
if ($previous) $meetings[$existingIndex] = $saved;
else $meetings[] = $saved;
usort($meetings, function (array $a, array $b): int { return strcmp($a['date'] . $a['startTime'], $b['date'] . $b['startTime']); });
writeStore($store, $meetings);
flock($store, LOCK_UN);
respond($previous ? 200 : 201, $saved);

if (!$previous) {
    // Trả kết quả cho trình duyệt trước rồi mới gửi mail, để người đặt không phải chờ máy chủ thư.
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request();
    notifyNewMeeting($saved, $config);
}
