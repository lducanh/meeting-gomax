# Lịch họp GoMax Digital

Ứng dụng lịch dùng chung, gồm hai tab: **Phòng họp** (Phòng Trệt và Phòng Tầng 2, lọc theo phòng, không cho trùng giờ trong cùng một phòng) và **Họp riêng** (hẹn lịch với BOD, sếp, quản lý hoặc nhân sự; lọc theo từng người, chỉ báo trùng khi cùng một người đã có lịch). Có chế độ xem ngày, tuần, tháng; tạo cuộc họp từ nút hoặc ô giờ; ghi người đăng ký, người tham dự và ghi chú; kéo thả để đổi lịch; sửa/xóa cuộc họp; tự kiểm tra lịch bị trùng.

Giao diện theo design system GoMax Console: toàn bộ token (màu, chữ, khoảng cách, bo góc) nằm ở đầu `styles.css`. Danh sách người có sẵn ở tab Họp riêng là `DEFAULT_PEOPLE` trong `app.js`; tên khác tự xuất hiện sau lần đặt lịch đầu tiên.

## Chạy trong mạng công ty

1. Cài Node.js 18 trở lên trên máy chủ nội bộ.
2. Tải dự án lên máy chủ và chạy `npm start`.
3. Mọi người truy cập `http://<địa-chỉ-máy-chủ>:3000` bằng trình duyệt.

Máy chủ ghi lịch vào `data/meetings.json` và cập nhật cho các trình duyệt đang mở sau tối đa 15 giây. Giữ máy chủ chạy để mọi người cùng xem và đặt lịch. Có thể đặt `PORT` để chọn cổng khác.

## Email thông báo lịch mới

Mỗi lần có người tạo lịch, máy chủ gửi một email thông báo. Tạo file `.env` cạnh `server.js` (file này không đưa vào git):

```
SMTP_USER=dia-chi-gui@gmail.com
SMTP_PASS=app-password-16-ky-tu
NOTIFY_TO=dia-chi-nhan@gmail.com
```

- `SMTP_PASS` là App Password của Gmail (Tài khoản Google → Bảo mật → Xác minh 2 bước → Mật khẩu ứng dụng), không phải mật khẩu đăng nhập.
- `NOTIFY_TO` nhận nhiều địa chỉ cách nhau bằng dấu phẩy; bỏ trống thì gửi về chính `SMTP_USER`.
- Hộp thư không phải Gmail: thêm `SMTP_HOST` và `SMTP_PORT`.
- Cần Node.js 20.12 trở lên để đọc `.env`, chạy `npm install` một lần, và máy chủ phải ra được internet qua cổng 465.
- Thiếu `SMTP_USER` hoặc `SMTP_PASS` thì tính năng tự tắt; gửi lỗi chỉ ghi log, lịch vẫn được lưu.

## Lưu ý triển khai

Máy chủ và tệp dữ liệu cần nằm trên một máy nội bộ luôn hoạt động để lịch được chia sẻ ổn định. Sao lưu `data/meetings.json` định kỳ nếu đây là lịch sử dụng chính thức.

Phiên bản đầu chưa có đăng nhập hoặc phân quyền: người truy cập được địa chỉ máy chủ đều có thể tạo và xóa cuộc họp. Vì vậy, chỉ nên chia sẻ trong mạng nội bộ công ty.
