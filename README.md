# Lịch họp GoMax Digital

Ứng dụng lịch dùng chung, gồm hai tab: **Phòng họp** (Phòng Trệt và Phòng Tầng 2, lọc theo phòng, không cho trùng giờ trong cùng một phòng) và **Họp riêng** (hẹn lịch với BOD, sếp, quản lý hoặc nhân sự; lọc theo từng người, chỉ báo trùng khi cùng một người đã có lịch). Có chế độ xem ngày, tuần, tháng; tạo cuộc họp từ nút hoặc ô giờ; ghi người đăng ký, người tham dự và ghi chú; kéo thả để đổi lịch; sửa/xóa cuộc họp; gửi email mỗi khi có lịch mới.

Giao diện là file tĩnh (`index.html`, `styles.css`, `app.js`); phần lưu lịch và gửi email là một file `api.php`, chạy được trên hosting PHP thông thường (cPanel, DirectAdmin), không cần Node, không cần cơ sở dữ liệu, không cần cài thư viện.

Giao diện theo design system GoMax Console: toàn bộ token (màu, chữ, khoảng cách, bo góc) nằm ở đầu `styles.css`. Danh sách người có sẵn ở tab Họp riêng là `DEFAULT_PEOPLE` trong `app.js`; tên khác tự xuất hiện sau lần đặt lịch đầu tiên. Danh sách phòng là `ROOMS`, khai báo ở cả `app.js` và `api.php`.

## Đưa lên hosting

1. Hosting cần PHP 7.4 trở lên.
2. Upload toàn bộ file vào thư mục web (ví dụ `public_html` hoặc một thư mục con như `public_html/lich-hop`). Nhớ upload cả file ẩn `.htaccess`.
3. Chép `config.example.php` thành `config.php` và điền thông tin email (xem bên dưới).
4. Mở địa chỉ trang. Lần đầu chạy, `api.php` tự tạo `data/meetings.json`. Nếu báo không ghi được dữ liệu, đặt quyền ghi cho thư mục `data` (chmod 755 hoặc 775).

Lịch lưu trong `data/meetings.json`; trang tự cập nhật cho các trình duyệt đang mở sau tối đa 15 giây. Sao lưu file này định kỳ. Khi cập nhật code, đừng ghi đè `data/meetings.json` và `config.php` trên hosting.

## Tự deploy khi đẩy code lên GitHub

`.github/workflows/deploy.yml` tự upload code lên hosting qua FTP mỗi lần đẩy lên nhánh `main`. Khai báo 4 secret trong GitHub (Settings → Secrets and variables → Actions → New repository secret):

- `FTP_SERVER`: địa chỉ FTP của hosting (ví dụ `ftp.tenmien.com`).
- `FTP_USERNAME`, `FTP_PASSWORD`: tài khoản FTP.
- `FTP_DIR`: thư mục đích, kết thúc bằng dấu `/` (ví dụ `public_html/lich-hop/`).

`config.php` và `data/meetings.json` không nằm trong git nên không bị ghi đè; tạo `config.php` trên hosting một lần bằng File Manager. Chưa khai báo secret thì workflow tự bỏ qua. Nếu hosting không hỗ trợ FTPS, đổi `protocol: ftps` thành `ftp` trong file workflow.

## Email thông báo lịch mới

Cấu hình trong `config.php` (file này không đưa vào git):

- `notify_to`: địa chỉ nhận, nhiều địa chỉ cách nhau bằng dấu phẩy. Bỏ trống để tắt email.
- `smtp_user`, `smtp_pass`: hộp thư dùng để gửi. Với Gmail, `smtp_pass` là App Password 16 ký tự tạo tại https://myaccount.google.com/apppasswords (cần bật Xác minh 2 bước), không phải mật khẩu đăng nhập.
- Bỏ trống `smtp_user` và `smtp_pass` thì dùng hàm `mail()` có sẵn của hosting; thư kiểu này dễ vào Spam hơn.
- Một số hosting chặn kết nối ra cổng 465. Khi đó thử `smtp_port` 587, hoặc dùng SMTP của chính hosting (`smtp_host`, `smtp_user`, `smtp_pass` của hộp thư tên miền).

Gửi lỗi không ảnh hưởng việc đặt lịch; lỗi được ghi vào error log của PHP trên hosting.

## Bảo mật

- `.htaccess` chặn tải trực tiếp `data/meetings.json`, `config.php` và các file tài liệu. File này chỉ có tác dụng trên Apache hoặc LiteSpeed; hosting chỉ chạy Nginx cần cấu hình chặn tương đương.
- Chưa có đăng nhập hoặc phân quyền: ai có địa chỉ trang đều xem, tạo và xóa lịch được. Nếu trang mở ra internet, nên bật "Password Protect Directory" trong bảng điều khiển hosting hoặc đặt ở địa chỉ khó đoán.

## Chạy thử trên máy

Cần PHP: `php -S localhost:3000` trong thư mục dự án rồi mở `http://localhost:3000`. Máy chủ thử của PHP không đọc `.htaccess`.
