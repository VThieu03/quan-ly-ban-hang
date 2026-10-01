// =============================================================================
//  THÔNG SỐ CỦA HỆ THỐNG – sửa ở đây là áp dụng cho server, app quầy, app khách
//  và chương trình in. Sửa xong cần build / khởi động lại server.
//
//  Không phải mọi giá trị đều nằm ở đây:
//   - Cài đặt kinh doanh (VAT, ngân hàng, tích điểm, máy in, định lượng mặc định,
//     lý do hủy...) chỉnh trong app quầy: Cài đặt. Các giá trị DEFAULT_* bên dưới
//     chỉ là giá trị ban đầu khi chưa chỉnh.
//   - Khóa bí mật / địa chỉ server (STAFF_PIN, PORT, ORDER_BASE_URL...) đặt bằng
//     biến môi trường, KHÔNG ghi vào file này (repo đang công khai).
// =============================================================================

// ---------- Giá trị mặc định cho Cài đặt → Vận hành ----------

/** Lượng nguyên liệu cho 1 phần khi tạo định lượng từ thực đơn (theo đơn vị nguyên liệu, vd 0.15 kg). */
export const DEFAULT_PORTION = 0.15;

/** Còn từ chừng này phần trở xuống thì khách thấy nhãn "Chỉ còn N phần" (khi bật tự báo hết món). */
export const DEFAULT_LOW_STOCK_BADGE = 5;

/** Đơn chờ quá số phút này thì màn hình bếp hiện màu đỏ. */
export const DEFAULT_KITCHEN_LATE_MINUTES = 15;

/** Lý do gợi ý khi hủy món trong đơn. */
export const DEFAULT_CANCEL_REASONS = [
  "Khách đổi ý",
  "Hết món",
  "Nhầm món",
  "Lên chậm",
];

/** Lý do gợi ý khi hủy hóa đơn đã thanh toán. */
export const DEFAULT_VOID_REASONS = [
  "Tính nhầm món / giá",
  "Khách trả món",
  "Thanh toán nhầm bàn",
  "Nhập sai hình thức thanh toán",
];

// ---------- Màn hình ----------

/** App khách và app quầy tự tải lại dữ liệu mỗi chừng này mili-giây (dự phòng khi mạng chặn cập nhật realtime). */
export const POLL_MS = 10_000;

/** Banner quảng cáo tự chuyển mỗi chừng này mili-giây. */
export const BANNER_ROTATE_MS = 5_000;

/** Đơn vị gợi ý khi tạo nguyên liệu. */
export const UNIT_SUGGESTIONS = [
  "kg",
  "g",
  "lít",
  "ml",
  "cái",
  "quả",
  "gói",
  "hộp",
  "chai",
  "lon",
  "bó",
];

/** Số ngày bán gần nhất dùng để ước tính doanh thu từ tồn kho (Kho → Dự báo bán). */
export const FORECAST_DAYS = 30;

// ---------- Gọi món ----------

/** Tối đa số phần cho 1 món trong 1 lần gọi. */
export const MAX_QUANTITY_PER_ITEM = 99;

/** Tối đa số món khác nhau trong 1 lần gọi. */
export const MAX_ORDER_LINES = 50;

/** Độ dài tối đa ghi chú cho bếp. */
export const MAX_NOTE_LENGTH = 200;

/** Lịch đặt bàn hiện trên sơ đồ bàn trong khoảng chừng này giờ trước giờ đến. */
export const RESERVATION_UPCOMING_HOURS = 3;

// ---------- Bảo mật đăng nhập ----------

/** Nhập sai PIN chừng này lần liên tiếp (theo từng máy / IP) thì bị khóa tạm. */
export const LOGIN_MAX_FAILED = 5;

/** Thời gian khóa sau khi nhập sai PIN quá nhiều (mili-giây). */
export const LOGIN_LOCK_MS = 60_000;

// ---------- Server ----------

/** Dung lượng tối đa ảnh món / banner tải lên (byte). */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Số bản sao lưu database giữ lại (có thể đổi bằng biến môi trường BACKUP_KEEP). */
export const BACKUP_KEEP = 30;

/** Gửi lại hóa đơn điện tử bị lỗi mỗi chừng này mili-giây. */
export const INVOICE_RETRY_MS = 5 * 60_000;

/** Lệnh in lỗi quá chừng này lần thì dừng thử lại (vào Cài đặt → Máy in để in lại). */
export const PRINT_MAX_ATTEMPTS = 5;

/** Gửi tín hiệu giữ kết nối realtime mỗi chừng này mili-giây (tránh router / proxy tự ngắt). */
export const REALTIME_PING_MS = 25_000;

// ---------- Chương trình in (print-agent) ----------

/** Chương trình in hỏi server có lệnh in mới mỗi chừng này mili-giây (đổi bằng biến môi trường POLL_MS). */
export const PRINT_AGENT_POLL_MS = 2_000;

/** Chờ máy in phản hồi tối đa chừng này mili-giây. */
export const PRINTER_TIMEOUT_MS = 5_000;

/** Số ký tự mỗi dòng: 48 cho giấy 80mm, 32 cho giấy 58mm (đổi bằng biến môi trường PAPER_COLUMNS). */
export const PAPER_COLUMNS = 48;
