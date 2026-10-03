<?php
// Chép file này thành config.php rồi điền thông tin. config.php không đưa vào git.
return [
    // Địa chỉ nhận thông báo lịch mới; nhiều địa chỉ cách nhau bằng dấu phẩy. Bỏ trống để tắt email.
    'notify_to' => 'dia-chi-nhan@gmail.com',
    // Hộp thư dùng để gửi. Với Gmail, smtp_pass là App Password 16 ký tự (https://myaccount.google.com/apppasswords).
    // Bỏ trống smtp_user và smtp_pass thì dùng hàm mail() có sẵn của hosting.
    'smtp_user' => 'dia-chi-gui@gmail.com',
    'smtp_pass' => '',
    'smtp_host' => 'smtp.gmail.com',
    'smtp_port' => 465,
];
