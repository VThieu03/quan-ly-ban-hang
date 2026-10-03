import * as config from './config.ts';
import type { SystemSettings } from './types.ts';

// Mô tả các thông số trong Cài đặt → Hệ thống: server dùng để kiểm tra giá trị hợp lệ,
// app quầy dùng để tự vẽ ô nhập. Thêm thông số mới: khai báo ở đây + types.ts + config.ts.

export type SystemNumberKey = Exclude<keyof SystemSettings, 'unitSuggestions'>;

export type SystemField = {
  key: SystemNumberKey;
  label: string;
  unit: string;
  min: number;
  max: number;
  decimal?: boolean;
  hint?: string;
};

export const SYSTEM_GROUPS: { title: string; fields: SystemField[] }[] = [
  {
    title: 'Màn hình',
    fields: [
      { key: 'pollSeconds', label: 'Tự tải lại dữ liệu mỗi', unit: 'giây', min: 2, max: 300, hint: 'Dự phòng khi mạng chặn cập nhật realtime.' },
      { key: 'bannerSeconds', label: 'Banner quảng cáo tự chuyển mỗi', unit: 'giây', min: 2, max: 120 },
      { key: 'forecastDays', label: 'Dự báo bán theo doanh số', unit: 'ngày gần nhất', min: 1, max: 365 },
    ],
  },
  {
    title: 'Gọi món & đặt bàn',
    fields: [
      { key: 'maxQuantityPerItem', label: 'Tối đa số phần 1 món mỗi lần gọi', unit: 'phần', min: 1, max: 999 },
      { key: 'maxOrderLines', label: 'Tối đa số món khác nhau mỗi lần gọi', unit: 'món', min: 1, max: 200 },
      { key: 'maxNoteLength', label: 'Độ dài ghi chú cho bếp', unit: 'ký tự', min: 0, max: 1000 },
      { key: 'reservationUpcomingHours', label: 'Nhắc lịch đặt bàn trên sơ đồ trước', unit: 'giờ', min: 0, max: 48 },
    ],
  },
  {
    title: 'Bảo mật đăng nhập',
    fields: [
      { key: 'loginMaxFailed', label: 'Khóa tạm khi nhập sai PIN', unit: 'lần liên tiếp', min: 1, max: 100 },
      { key: 'loginLockMinutes', label: 'Thời gian khóa', unit: 'phút', min: 1, max: 1440 },
    ],
  },
  {
    title: 'Server',
    fields: [
      { key: 'maxImageMB', label: 'Dung lượng ảnh tải lên tối đa', unit: 'MB', min: 0.1, max: 10, decimal: true },
      { key: 'backupKeep', label: 'Số bản sao lưu giữ lại', unit: 'bản', min: 1, max: 1000 },
      { key: 'invoiceRetryMinutes', label: 'Gửi lại hóa đơn điện tử lỗi mỗi', unit: 'phút', min: 1, max: 1440 },
      { key: 'realtimePingSeconds', label: 'Giữ kết nối realtime mỗi', unit: 'giây', min: 5, max: 300 },
    ],
  },
  {
    title: 'Máy in',
    fields: [
      { key: 'paperColumns', label: 'Số ký tự mỗi dòng', unit: 'ký tự', min: 24, max: 64, hint: '48 cho giấy 80mm, 32 cho giấy 58mm.' },
      { key: 'printMaxAttempts', label: 'Lệnh in lỗi thì thử lại tối đa', unit: 'lần', min: 1, max: 50 },
      { key: 'printAgentPollSeconds', label: 'Chương trình in hỏi lệnh mới mỗi', unit: 'giây', min: 1, max: 60 },
      { key: 'printerTimeoutSeconds', label: 'Chờ máy in phản hồi tối đa', unit: 'giây', min: 1, max: 60 },
    ],
  },
];

export const SYSTEM_FIELDS: SystemField[] = SYSTEM_GROUPS.flatMap((g) => g.fields);

/** Giá trị ban đầu khi chủ quán chưa chỉnh (lấy từ shared/config.ts). */
export const DEFAULT_SYSTEM: SystemSettings = {
  pollSeconds: config.POLL_SECONDS,
  bannerSeconds: config.BANNER_SECONDS,
  unitSuggestions: config.UNIT_SUGGESTIONS,
  forecastDays: config.FORECAST_DAYS,
  maxQuantityPerItem: config.MAX_QUANTITY_PER_ITEM,
  maxOrderLines: config.MAX_ORDER_LINES,
  maxNoteLength: config.MAX_NOTE_LENGTH,
  reservationUpcomingHours: config.RESERVATION_UPCOMING_HOURS,
  loginMaxFailed: config.LOGIN_MAX_FAILED,
  loginLockMinutes: config.LOGIN_LOCK_MINUTES,
  maxImageMB: config.MAX_IMAGE_MB,
  backupKeep: config.BACKUP_KEEP,
  invoiceRetryMinutes: config.INVOICE_RETRY_MINUTES,
  printMaxAttempts: config.PRINT_MAX_ATTEMPTS,
  realtimePingSeconds: config.REALTIME_PING_SECONDS,
  printAgentPollSeconds: config.PRINT_AGENT_POLL_SECONDS,
  printerTimeoutSeconds: config.PRINTER_TIMEOUT_SECONDS,
  paperColumns: config.PAPER_COLUMNS,
};
