import type {
  BillDetail,
  BillSummary,
  CashShift,
  CheckoutBreakdown,
  CheckoutRequest,
  CheckoutResult,
  Customer,
  DailySummary,
  Ingredient,
  InvoiceBuyer,
  InvoiceInfo,
  MenuCategory,
  NewOrderRequest,
  Order,
  OrderStatus,
  PaymentMethod,
  Printer,
  Promotion,
  Purchase,
  RecipeLine,
  ReportSummary,
  Reservation,
  Secrets,
  Settings,
  StaffMember,
  StaffTable,
  StockMove,
  Supplier,
  Timesheet,
} from '../../shared/types.ts';

const TOKEN_KEY = 'staffToken';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Không lưu được thì phải đăng nhập lại mỗi lần tải trang.
  }
}

export class ApiRequestError extends Error {
  status: number;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${getToken()}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api/staff${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/login') onUnauthorized();
    throw new ApiRequestError(res.status, data.error ?? 'server_error');
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const q = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return s ? `?${s}` : '';
};

export type PosConfig = {
  orderBaseUrl: string;
  restaurantName: string;
  vatRate: number;
  loyalty: Settings['loyalty'];
  bankConfigured: boolean;
  invoiceEnabled: boolean;
};

export type MeInfo = { staff: StaffMember; timesheet: Timesheet | null; cashShift: CashShift | null };

export type PrintJobInfo = {
  id: number;
  printer: string;
  status: 'pending' | 'printed' | 'failed';
  attempts: number;
  error: string;
  createdAt: string;
  printedAt: string | null;
};

export type BankTransaction = {
  id: number;
  amount: number;
  content: string;
  transactionDate: string;
  createdAt: string;
  sessionId: number | null;
  tableName: string | null;
};

export type TransferInfo = { breakdown: CheckoutBreakdown; qrPayload: string; bank: Settings['bank'] };

export const api = {
  login: (pin: string) => request<{ token: string; staff: StaffMember }>('/login', 'POST', { pin }),
  logout: () => request<void>('/logout', 'POST'),
  me: () => request<MeInfo>('/me'),
  clockIn: () => request<void>('/me/clock-in', 'POST'),
  clockOut: () => request<void>('/me/clock-out', 'POST'),
  config: () => request<PosConfig>('/config'),
  summary: () => request<DailySummary>('/summary'),

  // Bàn & gọi món
  tables: () => request<StaffTable[]>('/tables'),
  openTable: (id: number, body: { guestCount?: number | null; reservationId?: number | null }) =>
    request<void>(`/tables/${id}/open`, 'POST', body),
  staffOrder: (id: number, body: NewOrderRequest) => request<Order>(`/tables/${id}/orders`, 'POST', body),
  moveTable: (id: number, toTableId: number) => request<void>(`/tables/${id}/move`, 'POST', { toTableId }),
  mergeTable: (id: number, intoTableId: number) => request<void>(`/tables/${id}/merge`, 'POST', { intoTableId }),
  splitTable: (id: number, toTableId: number, lines: { orderItemId: number; quantity: number }[]) =>
    request<void>(`/tables/${id}/split`, 'POST', { toTableId, lines }),
  printBill: (id: number, body: Partial<CheckoutRequest> = {}) => request<void>(`/tables/${id}/print-bill`, 'POST', body),
  kitchen: () => request<Order[]>('/kitchen'),
  setOrderStatus: (id: number, status: OrderStatus) => request<void>(`/orders/${id}`, 'PATCH', { status }),
  cancelOrderItem: (id: number, quantity: number, reason: string) =>
    request<void>(`/order-items/${id}/cancel`, 'POST', { quantity, reason }),

  // Thanh toán
  previewCheckout: (id: number, body: CheckoutRequest) =>
    request<CheckoutBreakdown>(`/tables/${id}/checkout/preview`, 'POST', body),
  prepareTransfer: (id: number, body: CheckoutRequest) =>
    request<TransferInfo>(`/tables/${id}/checkout/transfer`, 'POST', body),
  cancelTransfer: (id: number) => request<void>(`/tables/${id}/checkout/transfer`, 'DELETE'),
  checkout: (id: number, body: CheckoutRequest) => request<CheckoutResult>(`/tables/${id}/checkout`, 'POST', body),

  // Hóa đơn
  bills: (from: string, to: string) => request<BillSummary[]>(`/bills${q({ from, to })}`),
  bill: (id: number) => request<BillDetail>(`/bills/${id}`),
  reprintBill: (id: number) => request<void>(`/bills/${id}/reprint`, 'POST'),
  issueInvoice: (id: number, buyer?: InvoiceBuyer | null) =>
    request<InvoiceInfo>(`/bills/${id}/invoice`, 'POST', buyer === undefined ? {} : { buyer }),
  retryInvoices: () => request<{ retried: number }>('/invoices/retry', 'POST'),

  // Khách hàng
  customers: (search = '') => request<Customer[]>(`/customers${q({ q: search })}`),
  lookupCustomer: (phone: string) => request<Customer | null>(`/customers/lookup${q({ phone })}`),
  createCustomer: (body: { phone: string; name: string; note: string }) => request<void>('/customers', 'POST', body),
  updateCustomer: (id: number, body: Partial<Pick<Customer, 'name' | 'note' | 'points'>>) =>
    request<void>(`/customers/${id}`, 'PATCH', body),

  // Đặt bàn
  reservations: (from: string, to: string) => request<Reservation[]>(`/reservations${q({ from, to })}`),
  createReservation: (body: unknown) => request<void>('/reservations', 'POST', body),
  updateReservation: (id: number, body: unknown) => request<void>(`/reservations/${id}`, 'PATCH', body),

  // Ca thu ngân
  cashShifts: () => request<{ current: CashShift | null; history: CashShift[] }>('/cash-shifts'),
  openShift: (openingCash: number) => request<void>('/cash-shifts/open', 'POST', { openingCash }),
  closeShift: (countedCash: number, note: string) => request<CashShift>('/cash-shifts/close', 'POST', { countedCash, note }),

  // Thực đơn
  menu: () => request<MenuCategory[]>('/menu'),
  menuCosts: () => request<Record<string, number>>('/menu/costs'),
  createCategory: (title: unknown) => request<{ id: string }>('/menu/categories', 'POST', { title }),
  updateCategory: (id: string, title: unknown) => request<void>(`/menu/categories/${encodeURIComponent(id)}`, 'PATCH', { title }),
  deleteCategory: (id: string) => request<void>(`/menu/categories/${encodeURIComponent(id)}`, 'DELETE'),
  createMenuItem: (body: unknown) => request<{ id: string }>('/menu/items', 'POST', body),
  updateMenuItem: (id: string, patch: unknown) => request<void>(`/menu/items/${encodeURIComponent(id)}`, 'PATCH', patch),
  deleteMenuItem: (id: string) => request<void>(`/menu/items/${encodeURIComponent(id)}`, 'DELETE'),
  uploadImage: (dataUrl: string) => request<{ url: string }>('/menu/images', 'POST', { dataUrl }),

  // Khuyến mãi
  promotions: () => request<Promotion[]>('/promotions'),
  createPromotion: (body: unknown) => request<void>('/promotions', 'POST', body),
  updatePromotion: (id: number, body: unknown) => request<void>(`/promotions/${id}`, 'PATCH', body),

  // Kho
  ingredients: () => request<Ingredient[]>('/inventory/ingredients'),
  createIngredient: (body: unknown) => request<void>('/inventory/ingredients', 'POST', body),
  updateIngredient: (id: number, body: unknown) => request<void>(`/inventory/ingredients/${id}`, 'PATCH', body),
  recipes: () => request<Record<string, RecipeLine[]>>('/inventory/recipes'),
  setRecipe: (menuItemId: string, lines: RecipeLine[]) =>
    request<void>(`/inventory/recipes/${encodeURIComponent(menuItemId)}`, 'PUT', { lines }),
  suppliers: () => request<Supplier[]>('/inventory/suppliers'),
  createSupplier: (body: unknown) => request<void>('/inventory/suppliers', 'POST', body),
  updateSupplier: (id: number, body: unknown) => request<void>(`/inventory/suppliers/${id}`, 'PATCH', body),
  purchases: (from: string, to: string) => request<Purchase[]>(`/inventory/purchases${q({ from, to })}`),
  createPurchase: (body: unknown) => request<void>('/inventory/purchases', 'POST', body),
  adjustStock: (body: unknown) => request<void>('/inventory/adjust', 'POST', body),
  stocktake: (body: unknown) => request<void>('/inventory/stocktake', 'POST', body),
  stockMoves: (from: string, to: string) => request<StockMove[]>(`/inventory/moves${q({ from, to })}`),

  // Báo cáo
  report: (from: string, to: string) => request<ReportSummary>(`/reports${q({ from, to })}`),

  // Nhân viên
  staff: () => request<StaffMember[]>('/staff'),
  createStaff: (body: unknown) => request<StaffMember>('/staff', 'POST', body),
  updateStaff: (id: number, body: unknown) => request<void>(`/staff/${id}`, 'PATCH', body),
  timesheets: (from: string, to: string) => request<Timesheet[]>(`/timesheets${q({ from, to })}`),

  // Cài đặt
  settings: () =>
    request<{ settings: Settings; secrets: Secrets; bankWebhookUrl: string; printAgentUrl: string }>('/settings'),
  saveSettings: (body: Partial<Settings>) => request<Settings>('/settings', 'PUT', body),
  regenerateSecret: (name: keyof Secrets) => request<Secrets>(`/settings/secrets/${name}/regenerate`, 'POST'),
  printers: () => request<{ printers: Printer[]; jobs: PrintJobInfo[] }>('/printers'),
  createPrinter: (body: unknown) => request<void>('/printers', 'POST', body),
  updatePrinter: (id: number, body: unknown) => request<void>(`/printers/${id}`, 'PUT', body),
  deletePrinter: (id: number) => request<void>(`/printers/${id}`, 'DELETE'),
  testPrinter: (id: number) => request<void>(`/printers/${id}/test`, 'POST'),
  retryPrintJob: (id: number) => request<void>(`/print-jobs/${id}/retry`, 'POST'),
  bankTransactions: () => request<BankTransaction[]>('/bank-transactions'),
  createTable: (body: { name: string; area: string }) => request<{ id: number }>('/tables', 'POST', body),
  updateTable: (id: number, body: { name?: string; area?: string }) => request<void>(`/tables/${id}`, 'PATCH', body),
  regenerateTableToken: (id: number) => request<void>(`/tables/${id}/token`, 'POST'),
  deleteTable: (id: number) => request<void>(`/tables/${id}`, 'DELETE'),
  backups: () => request<{ name: string; size: number }[]>('/backups'),
  createBackup: () => request<{ name: string; size: number }[]>('/backups', 'POST'),
};

/** Tải file cần đăng nhập (CSV, bản sao lưu) bằng fetch rồi lưu xuống máy. */
export async function download(path: string, filename: string) {
  const res = await fetch(`/api/staff${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiRequestError(res.status, 'download_failed');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function eventsUrl() {
  return `/api/staff/events?token=${encodeURIComponent(getToken() ?? '')}`;
}

const errorMessages: Record<string, string> = {
  wrong_pin: 'Sai mã PIN.',
  too_many_attempts: 'Nhập sai quá nhiều lần, vui lòng thử lại sau 1 phút.',
  forbidden: 'Bạn không có quyền làm thao tác này.',
  table_already_open: 'Bàn này đã được mở.',
  table_closed: 'Bàn đã đóng hoặc đã thanh toán.',
  target_table_busy: 'Bàn đích đang có khách. Dùng "Gộp bàn" nếu muốn gộp.',
  same_table: 'Hãy chọn một bàn khác.',
  table_has_history: 'Bàn đã có lịch sử bán hàng nên không xóa được. Có thể đổi tên thay vì xóa.',
  item_unavailable: 'Có món đã hết.',
  invalid_items: 'Danh sách món không hợp lệ.',
  invalid_price: 'Giá không hợp lệ.',
  invalid_name: 'Tên không hợp lệ.',
  invalid_pin: 'Mã PIN phải gồm 4–12 chữ số.',
  pin_taken: 'Mã PIN này đã có người dùng.',
  last_admin: 'Phải còn ít nhất một tài khoản quản lý đang hoạt động.',
  invalid_phone: 'Số điện thoại không hợp lệ.',
  phone_taken: 'Số điện thoại đã có trong danh sách khách hàng.',
  voucher_invalid: 'Mã giảm giá không tồn tại hoặc đã tắt.',
  voucher_expired: 'Mã giảm giá chưa bắt đầu hoặc đã hết hạn.',
  voucher_used_up: 'Mã giảm giá đã hết lượt dùng.',
  voucher_min_subtotal: 'Hóa đơn chưa đạt giá trị tối thiểu để dùng mã.',
  code_taken: 'Mã khuyến mãi đã tồn tại.',
  points_unavailable: 'Cần nhập SĐT khách hàng (và bật tích điểm) để dùng điểm.',
  not_enough_points: 'Khách không đủ điểm.',
  invalid_discount: 'Giảm giá không hợp lệ.',
  bank_not_configured: 'Chưa cài đặt tài khoản ngân hàng (Cài đặt → Thanh toán).',
  no_receipt_printer: 'Chưa cài đặt máy in hóa đơn.',
  invalid_buyer_tax_code: 'Mã số thuế công ty không hợp lệ (10 hoặc 13 số).',
  invalid_buyer_name: 'Thiếu tên công ty.',
  invalid_buyer_address: 'Thiếu địa chỉ công ty.',
  invoice_already_issued: 'Hóa đơn điện tử đã được xuất.',
  invoice_disabled: 'Chưa bật hóa đơn điện tử (Cài đặt → Hóa đơn điện tử).',
  shift_already_open: 'Đang có ca thu ngân mở.',
  no_open_shift: 'Chưa mở ca thu ngân.',
  already_clocked_in: 'Bạn đã vào ca rồi.',
  not_clocked_in: 'Bạn chưa vào ca.',
  category_not_empty: 'Danh mục còn món, hãy chuyển hoặc xóa món trước.',
  invalid_image: 'Ảnh phải là JPG, PNG hoặc WEBP.',
  image_too_large: 'Ảnh quá lớn (tối đa 2MB).',
  too_large: 'Dữ liệu gửi lên quá lớn.',
  reservation_not_bookable: 'Lịch đặt này đã được xử lý.',
  invalid_address: 'Địa chỉ không hợp lệ.',
  invalid_bank_bin: 'Mã ngân hàng không hợp lệ.',
  invalid_lines: 'Danh sách hàng không hợp lệ.',
  invalid_quantity: 'Số lượng không hợp lệ.',
  invalid_date: 'Ngày không hợp lệ.',
  invalid_time: 'Thời gian không hợp lệ.',
  not_found: 'Không tìm thấy dữ liệu, vui lòng tải lại.',
};

export function errorText(err: unknown) {
  if (err instanceof ApiRequestError) return errorMessages[err.message] ?? `Lỗi (${err.message}).`;
  return 'Mất kết nối tới máy chủ.';
}

/** Chạy một thao tác, báo lỗi bằng alert nếu thất bại. Trả về true nếu thành công. */
export async function run(action: () => Promise<unknown>) {
  try {
    await action();
    return true;
  } catch (err) {
    if (!(err instanceof ApiRequestError && err.status === 401)) alert(errorText(err));
    return false;
  }
}

export const paymentLabels: Record<PaymentMethod, string> = {
  cash: 'Tiền mặt',
  transfer: 'Chuyển khoản',
  card: 'Thẻ',
};

export const statusLabels: Record<OrderStatus, string> = {
  new: 'Mới',
  preparing: 'Đang làm',
  served: 'Đã lên món',
  cancelled: 'Đã hủy',
};

/** Tiếng "ting" báo có đơn mới / khách gọi thanh toán / tiền về. */
export function beep(frequency = 880) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
    osc.onended = () => ctx.close();
  } catch {
    // Trình duyệt không hỗ trợ âm thanh.
  }
}
