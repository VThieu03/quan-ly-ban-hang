// Kiểu dữ liệu dùng chung giữa server, app gọi món (kiosk-app) và app nhân viên (pos-app).
import type { Role } from './permissions.ts';

export type Lang = 'vi' | 'en' | 'ko' | 'zh' | 'ja';
export const LANGS: Lang[] = ['vi', 'en', 'ko', 'zh', 'ja'];

export type LocalizedText = Record<Lang, string>;

// ---------- Thực đơn ----------

export type MenuItem = {
  id: string;
  categoryId: string;
  name: LocalizedText;
  price: number;
  unit: string;
  image: string;
  available: boolean;
  /** Món best seller: hiện trong mục "Best seller" đầu menu của khách. */
  featured: boolean;
  /** Số phần còn làm được theo tồn kho (null = món chưa khai báo định lượng, không theo dõi). */
  remaining: number | null;
};

export type MenuCategory = {
  id: string;
  title: LocalizedText;
  items: MenuItem[];
};

export type MenuItemInput = {
  categoryId: string;
  name: LocalizedText;
  price: number;
  unit?: string;
  image?: string;
  available?: boolean;
  featured?: boolean;
};

// ---------- Banner quảng cáo ----------

export type BannerTarget = 'none' | 'category' | 'item';

export type Banner = {
  id: number;
  title: LocalizedText;
  subtitle: LocalizedText;
  image: string;
  targetType: BannerTarget;
  /** id danh mục hoặc id món khi khách bấm vào banner. */
  targetId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
};

// ---------- Đơn gọi món ----------

export type OrderStatus = 'new' | 'preparing' | 'served' | 'cancelled';

export type OrderItem = {
  id: number;
  menuItemId: string;
  name: LocalizedText;
  price: number;
  quantity: number;
  cancelled: boolean;
  cancelReason: string;
};

export type Order = {
  id: number;
  sessionId: number;
  tableId: number;
  tableName: string;
  status: OrderStatus;
  note: string;
  source: 'customer' | 'staff';
  createdAt: string;
  items: OrderItem[];
  total: number;
};

export type NewOrderRequest = {
  items: { menuItemId: string; quantity: number }[];
  note?: string;
};

// ---------- Bàn & lượt ngồi ----------

export type PaymentMethod = 'cash' | 'transfer' | 'card';

/** Một lượt khách ngồi bàn, từ lúc mở bàn đến lúc thanh toán. */
export type TableSession = {
  id: number;
  openedAt: string;
  billRequestedAt: string | null;
  guestCount: number | null;
  orders: Order[];
  /** Tổng tiền các món chưa hủy (trước giảm giá). */
  total: number;
  /** Đang chờ khách chuyển khoản (đã hiện mã QR). */
  pendingPayment: CheckoutBreakdown | null;
};

/** Thông tin bàn khách nhìn thấy (không có token). */
export type CustomerTableView = {
  id: number;
  name: string;
  session: TableSession | null;
};

/** Thông tin bàn nhân viên nhìn thấy. */
export type StaffTable = {
  id: number;
  name: string;
  area: string;
  token: string;
  session: TableSession | null;
  nextReservation: Reservation | null;
};

// ---------- Thanh toán ----------

export type InvoiceBuyer = {
  companyName: string;
  taxCode: string;
  address: string;
  email: string;
  buyerName?: string;
};

export type CheckoutRequest = {
  paymentMethod: PaymentMethod;
  discount?: { type: 'percent' | 'amount'; value: number; note?: string } | null;
  voucherCode?: string | null;
  customerPhone?: string | null;
  customerName?: string | null;
  usePoints?: number;
  buyer?: InvoiceBuyer | null;
};

export type CustomerSummary = { id: number | null; phone: string; name: string; points: number };

export type CheckoutBreakdown = {
  sessionId: number;
  subtotal: number;
  manualDiscount: number;
  voucher: { code: string; name: string; discount: number } | null;
  pointsUsed: number;
  pointsDiscount: number;
  discountTotal: number;
  total: number;
  vatRate: number;
  /** Tiền thuế GTGT đã bao gồm trong tổng (giá bán là giá đã có thuế). */
  vatAmount: number;
  customer: CustomerSummary | null;
  pointsEarned: number;
  transferCode: string;
  request: CheckoutRequest;
};

export type CheckoutResult = { billId: number; total: number; invoice: InvoiceInfo | null };

// ---------- Hóa đơn ----------

export type InvoiceStatus = 'pending' | 'issued' | 'failed' | 'cancelled';

export type InvoiceInfo = {
  id: number;
  status: InvoiceStatus;
  provider: string;
  invoiceNo: string | null;
  lookupCode: string | null;
  lookupUrl: string | null;
  error: string;
  issuedAt: string | null;
};

export type BillSummary = {
  id: number;
  tableName: string;
  openedAt: string;
  closedAt: string;
  subtotal: number;
  discountAmount: number;
  total: number;
  paymentMethod: PaymentMethod;
  customer: { name: string; phone: string } | null;
  cashier: string | null;
  invoice: InvoiceInfo | null;
  /** Hóa đơn đã bị hủy sau khi thanh toán (không tính doanh thu). */
  voided: { at: string; by: string | null; reason: string } | null;
};

export type BillDetail = BillSummary & {
  discountNote: string;
  pointsUsed: number;
  pointsEarned: number;
  vatRate: number;
  orders: Order[];
};

// ---------- Nhân viên ----------

export type StaffMember = {
  id: number;
  name: string;
  role: Role;
  active: boolean;
};

export type StaffSession = {
  token: string;
  staff: StaffMember;
};

export type Timesheet = {
  id: number;
  staffId: number;
  staffName: string;
  clockIn: string;
  clockOut: string | null;
  minutes: number;
};

export type CashShift = {
  id: number;
  staffName: string;
  openedAt: string;
  openingCash: number;
  closedAt: string | null;
  closedByName: string | null;
  cashSales: number;
  expectedCash: number;
  countedCash: number | null;
  note: string;
};

// ---------- Khách hàng & khuyến mãi ----------

export type Customer = {
  id: number;
  phone: string;
  name: string;
  points: number;
  totalSpent: number;
  visits: number;
  note: string;
  createdAt: string;
};

export type Promotion = {
  id: number;
  code: string;
  name: string;
  type: 'percent' | 'amount';
  value: number;
  minSubtotal: number;
  maxDiscount: number | null;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  usedCount: number;
  active: boolean;
};

export type PromotionInput = Omit<Promotion, 'id' | 'usedCount'>;

// ---------- Đặt bàn ----------

export type ReservationStatus = 'booked' | 'seated' | 'cancelled' | 'no_show';

export type Reservation = {
  id: number;
  customerName: string;
  phone: string;
  partySize: number;
  reservedAt: string;
  tableId: number | null;
  tableName: string | null;
  note: string;
  status: ReservationStatus;
};

export type ReservationInput = {
  customerName: string;
  phone: string;
  partySize: number;
  reservedAt: string;
  tableId: number | null;
  note: string;
};

// ---------- Kho ----------

export type Ingredient = {
  id: number;
  name: string;
  unit: string;
  stock: number;
  minStock: number;
  cost: number;
  active: boolean;
  /** Đã có lịch sử xuất nhập (khi đó không đổi đơn vị / không xóa được). */
  hasHistory: boolean;
  /** Số món đang dùng nguyên liệu này trong định lượng. */
  usedInRecipes: number;
};

export type RecipeLine = { ingredientId: number; quantity: number };

export type Supplier = { id: number; name: string; phone: string; address: string; note: string };

export type PurchaseInput = {
  supplierId: number | null;
  note: string;
  lines: { ingredientId: number; quantity: number; unitCost: number }[];
};

export type Purchase = {
  id: number;
  supplierId: number | null;
  supplierName: string | null;
  total: number;
  note: string;
  staffName: string | null;
  createdAt: string;
  lines: { ingredientId: number; ingredientName: string; unit: string; quantity: number; unitCost: number }[];
  voided: { at: string; by: string | null; reason: string } | null;
  /** Lần sửa gần nhất (nếu có). */
  edited: { at: string; by: string | null } | null;
};

export type StockMoveType =
  | 'opening' // tồn đầu kỳ
  | 'purchase'
  | 'purchase_void' // hủy phiếu nhập
  | 'purchase_edit' // sửa phiếu nhập (trả số cũ / ghi số mới)
  | 'sale'
  | 'void' // hoàn kho khi hủy hóa đơn
  | 'adjust'
  | 'waste'
  | 'stocktake'
  | 'cost_adjust'; // sửa giá vốn (số lượng không đổi)

export type StockMove = {
  id: number;
  ingredientId: number;
  ingredientName: string;
  unit: string;
  change: number;
  unitCost: number;
  type: StockMoveType;
  note: string;
  staffName: string | null;
  createdAt: string;
};

// ---------- Máy in ----------

export type PrinterKind = 'kitchen' | 'receipt';

export type Printer = {
  id: number;
  name: string;
  kind: PrinterKind;
  address: string; // ip:port, thường là cổng 9100
  categoryIds: string[]; // máy in bếp: chỉ in các danh mục này (rỗng = tất cả)
  active: boolean;
};

export type PrintLine =
  | { type: 'text'; text: string; align?: 'left' | 'center' | 'right'; bold?: boolean; size?: 'normal' | 'large' }
  | { type: 'row'; left: string; right: string; bold?: boolean }
  | { type: 'divider' }
  | { type: 'qr'; data: string }
  | { type: 'feed'; lines: number };

export type PrintJob = {
  id: number;
  printerId: number;
  printerName: string;
  address: string;
  lines: PrintLine[];
  removeAccents: boolean;
};

// ---------- Cài đặt ----------

export type InvoiceProviderId = 'none' | 'mock';

export type Settings = {
  restaurant: { name: string; address: string; phone: string; taxCode: string };
  /** Thuế suất GTGT (%) đã bao gồm trong giá bán. */
  vatRate: number;
  bank: { bin: string; accountNumber: string; accountName: string };
  loyalty: { enabled: boolean; spendPerPoint: number; pointValue: number };
  invoice: { provider: InvoiceProviderId; autoIssue: boolean; templateCode: string; series: string };
  printing: { removeAccents: boolean; kitchenTickets: boolean; receiptOnCheckout: boolean };
  /** autoSoldOut: tự báo "Hết món" khi không còn đủ nguyên liệu cho 1 phần, tự bật lại khi có hàng. */
  inventory: { autoSoldOut: boolean };
  /** Thông số vận hành chủ quán tự chỉnh trong Cài đặt → Vận hành (mặc định lấy từ shared/config.ts). */
  operations: {
    defaultPortion: number;
    lowStockBadge: number;
    kitchenLateMinutes: number;
    cancelReasons: string[];
    voidReasons: string[];
  };
};

// ---------- Dự báo tồn kho ----------

export type DishForecast = {
  menuItemId: string;
  name: string;
  price: number;
  /** Giá vốn 1 phần. */
  cost: number;
  /** Số phần còn làm được (đã trừ món đã gọi nhưng chưa thanh toán). */
  portions: number;
  limitingIngredient: string | null;
  /** Tiền bán / lãi gộp nếu bán hết số phần còn làm được (từng món tính riêng). */
  revenue: number;
  profit: number;
};

export type IngredientForecast = {
  ingredientId: number;
  name: string;
  unit: string;
  /** Tồn khả dụng = tồn kho − lượng đã gọi chưa thanh toán. */
  available: number;
  stockValue: number;
  /** Doanh thu bình quân mang lại trên 1 đơn vị nguyên liệu. */
  revenuePerUnit: number;
  expectedRevenue: number;
  basis: 'sales' | 'menu' | 'none';
};

export type InventoryForecast = {
  days: number;
  stockValue: number;
  expectedRevenue: number;
  expectedProfit: number;
  /** Giá trị tồn của nguyên liệu chưa dùng trong định lượng nào (không ước tính được). */
  untrackedValue: number;
  dishes: DishForecast[];
  ingredients: IngredientForecast[];
};

export type Secrets = { bankWebhookKey: string; printAgentKey: string };

// ---------- Báo cáo ----------

export type ReportSummary = {
  from: string;
  to: string;
  bills: number;
  guests: number;
  subtotal: number;
  discounts: number;
  revenue: number;
  averageBill: number;
  cogs: number;
  grossProfit: number;
  byMethod: Record<PaymentMethod, number>;
  byDay: { date: string; bills: number; revenue: number }[];
  byHour: { hour: number; bills: number; revenue: number }[];
  topItems: { menuItemId: string; name: string; quantity: number; revenue: number }[];
  byCategory: { categoryId: string; name: string; quantity: number; revenue: number }[];
  byStaff: { staffId: number | null; name: string; bills: number; revenue: number }[];
  cancelled: { items: number; amount: number };
  voided: { bills: number; amount: number };
};

export type DailySummary = {
  date: string;
  bills: number;
  revenue: number;
  byMethod: Record<PaymentMethod, number>;
};

// ---------- Realtime ----------

export type ServerEvent =
  | { type: 'table'; tableId: number }
  | { type: 'menu' }
  | { type: 'payment'; tableId: number; sessionId: number; amount: number }
  | { type: 'data' }; // dữ liệu quản lý khác thay đổi (kho, đặt bàn...)

export type ApiError = { error: string; itemId?: string };
