# Bản đồ quy hoạch — Bình Dương • TP.HCM

Web app bản đồ giúp định vị thửa đất, đổi tọa độ VN-2000 trên sổ đỏ sang vị trí
trên bản đồ, rồi mở cổng tra cứu quy hoạch chính thức của Sở Quy hoạch – Kiến trúc TP.HCM.

Mở app: https://thangdv123.github.io/app1muse/ban-do-quy-hoach/
(GitHub Pages đã bật sẵn cho repo app1muse. Sau này nếu muốn repo riêng,
tạo repo `ban-do-quy-hoach` trên GitHub rồi chuyển thư mục này sang đó.)

## Tính năng

- **Bản đồ nền**: đường phố (OpenStreetMap) và vệ tinh (Esri World Imagery), chuyển qua lại được.
- **Chạm vào bản đồ** để ghim điểm: hiện địa chỉ, tọa độ WGS84 và tọa độ VN-2000
  (kinh tuyến trục 105°45' cho Bình Dương / TP.HCM), kèm nút mở cổng quy hoạch chính thức tại điểm đó.
- **Tìm địa chỉ / tên đường** (Nominatim, giới hạn Việt Nam).
- **Vị trí của tôi** (GPS của điện thoại).
- **Đổi tọa độ VN-2000 trên sổ đỏ**: nhập X (hướng Bắc), Y (hướng Đông) và chọn tỉnh
  → ghim đúng vị trí thửa đất lên bản đồ. Kinh tuyến trục các tỉnh theo
  Thông tư 973/2001/TT-TCĐC (múi chiếu 3°, k = 0,9999): Bình Dương 105°45',
  TP.HCM 105°45', Đồng Nai 107°45', Tây Ninh 105°30', Bình Phước 106°15',
  Long An 105°45', Bà Rịa – Vũng Tàu 107°45'.

## Giới hạn quan trọng (đã kiểm chứng ngày 17/11/2026)

Lớp quy hoạch chính thức (quy hoạch phân khu 1/2000, quy hoạch chung…) của Sở Quy hoạch –
Kiến trúc TP.HCM **không thể nhúng vào app khác**:

- Dữ liệu chạy trên ArcGIS Enterprise tại `api-gisxaydung.tphcm.gov.vn`.
- Mọi yêu cầu (MapServer, tra cứu thửa đất) đều yêu cầu token `Authorization: Bearer`
  lấy qua phiên cookie riêng của cổng chính thức (`POST /authV2/refresh`); gọi trực tiếp
  không token trả về 401, gọi từ origin khác bị tường lửa chặn 403.
- Cổng chính thức đặt `X-Frame-Options: SAMEORIGIN` nên cũng không nhúng được bằng iframe,
  và không có tham số URL để mở sẵn tới một tọa độ.

Vì vậy app này **không tự vẽ lớp quy hoạch** — nó làm phần việc quanh đó (định vị, đổi tọa độ),
rồi đưa người dùng sang cổng chính thức để tra cứu. Dữ liệu quy hoạch phủ cả khu vực
Bình Dương cũ (đã kiểm chứng bằng tra cứu thửa thật tại VSIP 2, phường Vĩnh Tân, Tân Uyên:
số tờ 15, số thửa 7009). Kết quả tra cứu online chỉ mang tính tham khảo, không thay thế
văn bản xác nhận của cơ quan có thẩm quyền.

## Công nghệ

- Leaflet 1.9.4 + OpenStreetMap / Esri World Imagery (không cần API key).
- proj4js cho phép chuyển đổi VN-2000 ↔ WGS84.
- Nominatim (OpenStreetMap) cho tìm kiếm địa chỉ và địa chỉ ngược.
- Web tĩnh, không cần máy chủ — chạy được trên GitHub Pages.
