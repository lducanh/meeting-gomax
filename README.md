# Lịch phòng họp GoMax Digital

Ứng dụng lịch dùng chung cho một phòng họp. Có chế độ xem ngày, tuần, tháng; tạo cuộc họp từ nút hoặc ô giờ; ghi người đăng ký, người tham dự và ghi chú; kéo thả để đổi lịch; sửa/xóa cuộc họp; tự kiểm tra lịch bị trùng.

Header dùng logo GoMax bản ngang, avatar mô phỏng người dùng `Member`, và bảng màu đỏ cam GoMax trên nền sáng.

## Chạy trong mạng công ty

1. Cài Node.js 18 trở lên trên máy chủ nội bộ.
2. Tải dự án lên máy chủ và chạy `npm start`.
3. Mọi người truy cập `http://<địa-chỉ-máy-chủ>:3000` bằng trình duyệt.

Máy chủ ghi lịch vào `data/meetings.json` và cập nhật cho các trình duyệt đang mở sau tối đa 15 giây. Giữ máy chủ chạy để mọi người cùng xem và đặt lịch. Có thể đặt `PORT` để chọn cổng khác.

## Lưu ý triển khai

Máy chủ và tệp dữ liệu cần nằm trên một máy nội bộ luôn hoạt động để lịch được chia sẻ ổn định. Sao lưu `data/meetings.json` định kỳ nếu đây là lịch sử dụng chính thức.

Phiên bản đầu chưa có đăng nhập hoặc phân quyền: người truy cập được địa chỉ máy chủ đều có thể tạo và xóa cuộc họp. Vì vậy, chỉ nên chia sẻ trong mạng nội bộ công ty.
