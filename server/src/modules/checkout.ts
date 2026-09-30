import { db, now, transaction } from '../db.ts';
import { bad, HttpError, int, oneOf, phone, str } from '../http.ts';
import { getSettings } from '../settings.ts';
import { findCustomerByPhone, upsertCustomer } from './customers.ts';
import { deductForSession } from './inventory.ts';
import { createInvoice, ensureInvoiceForBill, invoiceForSession, issueInvoice, updateInvoiceBuyer } from './invoices.ts';
import type { InvoicePayload } from './invoices.ts';
import { queryOrders } from './orders.ts';
import { billLines, enqueueReceipt } from './printing.ts';
import type { BillPrintData } from './printing.ts';
import { applyVoucher, markVoucherUsed } from './promotions.ts';
import { getOpenSession } from './tables.ts';
import { buildVietQrPayload, transferCode } from '../../../shared/vietqr.ts';
import type {
  BillDetail,
  BillSummary,
  CheckoutBreakdown,
  CheckoutRequest,
  CheckoutResult,
  InvoiceBuyer,
  Order,
  PaymentMethod,
} from '../../../shared/types.ts';

const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'transfer', 'card'];
export const PAYMENT_LABELS: Record<PaymentMethod, string> = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Thẻ' };

function parseBuyer(value: unknown): InvoiceBuyer | null {
  if (value === null || value === undefined) return null;
  const b = value as Record<string, unknown>;
  const taxCode = str(b.taxCode, 'invalid_buyer_tax_code', { max: 14 });
  if (!/^\d{10}(-\d{3})?$/.test(taxCode)) throw bad('invalid_buyer_tax_code');
  return {
    companyName: str(b.companyName, 'invalid_buyer_name', { max: 200 }),
    taxCode,
    address: str(b.address, 'invalid_buyer_address', { max: 300 }),
    email: str(b.email, 'invalid_buyer_email', { max: 100, required: false }),
    buyerName: str(b.buyerName, 'invalid_buyer_name', { max: 100, required: false }),
  };
}

/** Chuẩn hóa yêu cầu thanh toán từ client (không tin dữ liệu gửi lên). */
export function parseCheckoutRequest(body: unknown): CheckoutRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const discount = b.discount as Record<string, unknown> | null | undefined;
  return {
    paymentMethod: oneOf(b.paymentMethod, PAYMENT_METHODS, 'invalid_payment_method'),
    discount:
      discount && discount.value
        ? {
            type: oneOf(discount.type, ['percent', 'amount'] as const, 'invalid_discount'),
            value: int(discount.value, 'invalid_discount'),
            note: str(discount.note, 'invalid_discount', { max: 100, required: false }),
          }
        : null,
    voucherCode: b.voucherCode ? str(b.voucherCode, 'invalid_voucher', { max: 30 }) : null,
    customerPhone: b.customerPhone ? phone(b.customerPhone) : null,
    customerName: str(b.customerName, 'invalid_name', { max: 60, required: false }) || null,
    usePoints: b.usePoints ? int(b.usePoints, 'invalid_points') : 0,
    buyer: parseBuyer(b.buyer),
  };
}

/** Tính tiền một bàn đang mở theo yêu cầu thanh toán. Không ghi gì vào database. */
export function computeBreakdown(tableId: number, request: CheckoutRequest): CheckoutBreakdown {
  const session = getOpenSession(tableId);
  if (!session) throw new HttpError(409, 'table_closed');
  const settings = getSettings();
  const subtotal = session.total;
  let remaining = subtotal;

  let manualDiscount = 0;
  if (request.discount) {
    const { type, value } = request.discount;
    if (type === 'percent' && value > 100) throw bad('invalid_discount');
    manualDiscount = Math.min(type === 'percent' ? Math.round((subtotal * value) / 100) : value, remaining);
    remaining -= manualDiscount;
  }

  let voucher: CheckoutBreakdown['voucher'] = null;
  if (request.voucherCode) {
    const { promotion, discount } = applyVoucher(request.voucherCode, remaining);
    voucher = { code: promotion.code, name: promotion.name, discount };
    remaining -= discount;
  }

  let customer: CheckoutBreakdown['customer'] = null;
  if (request.customerPhone) {
    const existing = findCustomerByPhone(request.customerPhone);
    customer = existing
      ? { id: existing.id, phone: existing.phone, name: existing.name || request.customerName || '', points: existing.points }
      : { id: null, phone: request.customerPhone, name: request.customerName ?? '', points: 0 };
  }

  let pointsUsed = 0;
  let pointsDiscount = 0;
  if (request.usePoints && request.usePoints > 0) {
    if (!settings.loyalty.enabled || !customer) throw new HttpError(409, 'points_unavailable');
    if (request.usePoints > customer.points) throw new HttpError(409, 'not_enough_points');
    pointsDiscount = Math.min(request.usePoints * settings.loyalty.pointValue, remaining);
    pointsUsed = settings.loyalty.pointValue > 0 ? Math.ceil(pointsDiscount / settings.loyalty.pointValue) : 0;
    remaining -= pointsDiscount;
  }

  const total = Math.max(remaining, 0);
  const vatRate = settings.vatRate;
  return {
    sessionId: session.id,
    subtotal,
    manualDiscount,
    voucher,
    pointsUsed,
    pointsDiscount,
    discountTotal: subtotal - total,
    total,
    vatRate,
    vatAmount: total - Math.round(total / (1 + vatRate / 100)),
    customer,
    pointsEarned: settings.loyalty.enabled && customer ? Math.floor(total / settings.loyalty.spendPerPoint) : 0,
    transferCode: transferCode(session.id),
    request,
  };
}

function qrPayloadFor(breakdown: CheckoutBreakdown): string | null {
  const { bank } = getSettings();
  if (!bank.bin || !bank.accountNumber) return null;
  return buildVietQrPayload({
    bin: bank.bin,
    accountNumber: bank.accountNumber,
    amount: breakdown.total,
    description: breakdown.transferCode,
  });
}

/** Hiện mã VietQR: lưu yêu cầu thanh toán lại để webhook ngân hàng tự chốt bill khi tiền về. */
export function prepareTransfer(tableId: number, request: CheckoutRequest) {
  const breakdown = computeBreakdown(tableId, { ...request, paymentMethod: 'transfer' });
  const qrPayload = qrPayloadFor(breakdown);
  if (!qrPayload) throw new HttpError(409, 'bank_not_configured');
  db.prepare('UPDATE sessions SET pending_payment = ? WHERE id = ?').run(JSON.stringify(breakdown), breakdown.sessionId);
  return { breakdown, qrPayload, bank: getSettings().bank };
}

export function cancelPendingTransfer(tableId: number) {
  const session = getOpenSession(tableId);
  if (session) db.prepare('UPDATE sessions SET pending_payment = NULL WHERE id = ?').run(session.id);
}

function discountNote(b: CheckoutBreakdown) {
  return [
    b.manualDiscount ? `Giảm giá${b.request.discount?.note ? `: ${b.request.discount.note}` : ''}` : '',
    b.voucher ? `Mã ${b.voucher.code}` : '',
    b.pointsUsed ? `Dùng ${b.pointsUsed} điểm` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Gộp các món giống nhau (cùng giá) qua các lần gọi để in / xuất hóa đơn. */
function groupLines(orders: Order[]) {
  const lines = new Map<string, { menuItemId: string; name: string; price: number; quantity: number }>();
  for (const order of orders) {
    if (order.status === 'cancelled') continue;
    for (const item of order.items) {
      if (item.cancelled) continue;
      const key = `${item.menuItemId}:${item.price}`;
      const line = lines.get(key) ?? { menuItemId: item.menuItemId, name: item.name.vi, price: item.price, quantity: 0 };
      line.quantity += item.quantity;
      lines.set(key, line);
    }
  }
  return [...lines.values()];
}

function unitOf(menuItemId: string) {
  const row = db.prepare('SELECT unit FROM menu_items WHERE id = ?').get(menuItemId) as { unit: string } | undefined;
  return row?.unit ?? 'Phần';
}

function invoicePayload(
  sessionId: number,
  orders: Order[],
  totals: { discount: number; total: number; vatRate: number; paymentMethod: PaymentMethod },
  buyer: InvoiceBuyer | null,
): InvoicePayload {
  const { restaurant, invoice } = getSettings();
  const amountBeforeVat = Math.round(totals.total / (1 + totals.vatRate / 100));
  return {
    sessionId,
    issuedAt: now(),
    seller: { name: restaurant.name, taxCode: restaurant.taxCode, address: restaurant.address, phone: restaurant.phone },
    template: { templateCode: invoice.templateCode, series: invoice.series },
    buyer,
    paymentMethod: totals.paymentMethod,
    lines: groupLines(orders).map((l) => ({
      name: l.name,
      unit: unitOf(l.menuItemId),
      quantity: l.quantity,
      unitPrice: l.price,
      amount: l.price * l.quantity,
    })),
    discount: totals.discount,
    vatRate: totals.vatRate,
    amountBeforeVat,
    vatAmount: totals.total - amountBeforeVat,
    total: totals.total,
  };
}

/** Chốt thanh toán: đóng bàn, cộng/trừ điểm, trừ kho, ghi nhận thanh toán, tạo hóa đơn điện tử. */
export async function checkout(
  tableId: number,
  request: CheckoutRequest,
  staffId: number | null,
  reference = '',
): Promise<CheckoutResult> {
  const settings = getSettings();
  const { breakdown, invoiceId } = transaction(() => {
    const breakdown = computeBreakdown(tableId, request);
    const session = getOpenSession(tableId)!;

    let customerId: number | null = null;
    if (breakdown.customer) {
      const customer = upsertCustomer(breakdown.customer.phone, breakdown.customer.name);
      customerId = customer.id;
      db.prepare(
        'UPDATE customers SET points = points - ? + ?, total_spent = total_spent + ?, visits = visits + 1 WHERE id = ?',
      ).run(breakdown.pointsUsed, breakdown.pointsEarned, breakdown.total, customer.id);
    }
    let promotionId: number | null = null;
    if (breakdown.voucher) {
      promotionId = (db.prepare('SELECT id FROM promotions WHERE code = ?').get(breakdown.voucher.code) as { id: number }).id;
      markVoucherUsed(promotionId);
    }

    db.prepare(
      `UPDATE sessions SET closed_at = ?, closed_by = ?, payment_method = ?, subtotal = ?, discount_amount = ?,
         discount_note = ?, promotion_id = ?, customer_id = ?, points_used = ?, points_earned = ?, vat_rate = ?,
         total = ?, pending_payment = NULL
       WHERE id = ?`,
    ).run(
      now(),
      staffId,
      request.paymentMethod,
      breakdown.subtotal,
      breakdown.discountTotal,
      discountNote(breakdown),
      promotionId,
      customerId,
      breakdown.pointsUsed,
      breakdown.pointsEarned,
      breakdown.vatRate,
      breakdown.total,
      session.id,
    );
    db.prepare('INSERT INTO payments (session_id, method, amount, reference, staff_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      session.id,
      request.paymentMethod,
      breakdown.total,
      reference,
      staffId,
      now(),
    );
    deductForSession(session.id, staffId);

    const invoiceId =
      settings.invoice.autoIssue || request.buyer
        ? createInvoice(
            invoicePayload(
              session.id,
              session.orders,
              { discount: breakdown.discountTotal, total: breakdown.total, vatRate: breakdown.vatRate, paymentMethod: request.paymentMethod },
              request.buyer ?? null,
            ),
          )
        : null;

    if (settings.printing.receiptOnCheckout) {
      enqueueReceipt(billLines(billPrintData(session.id, 'HÓA ĐƠN THANH TOÁN')));
    }
    return { breakdown, invoiceId };
  });

  const invoice = invoiceId !== null ? await issueInvoice(invoiceId) : null;
  return { billId: breakdown.sessionId, total: breakdown.total, invoice };
}

// ---------- In hóa đơn ----------

function billPrintData(sessionId: number, title: string, breakdown?: CheckoutBreakdown): BillPrintData {
  const row = db
    .prepare(
      `SELECT s.*, t.name AS table_name FROM sessions s JOIN tables t ON t.id = s.table_id WHERE s.id = ?`,
    )
    .get(sessionId) as SessionBillRow;
  const orders = queryOrders('o.session_id = ?', sessionId);
  const lines = groupLines(orders);
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const closed = row.closed_at !== null;

  const discounts = breakdown
    ? [
        ...(breakdown.manualDiscount ? [{ label: 'Giảm giá', amount: breakdown.manualDiscount }] : []),
        ...(breakdown.voucher ? [{ label: `Mã ${breakdown.voucher.code}`, amount: breakdown.voucher.discount }] : []),
        ...(breakdown.pointsDiscount ? [{ label: `Dùng ${breakdown.pointsUsed} điểm`, amount: breakdown.pointsDiscount }] : []),
      ]
    : closed && row.discount_amount
      ? [{ label: row.discount_note || 'Giảm giá', amount: row.discount_amount }]
      : [];
  const total = breakdown ? breakdown.total : closed ? (row.total ?? subtotal) : subtotal;

  // Hóa đơn tạm tính chưa thanh toán thì in kèm VietQR đúng số tiền.
  const qrPayload = !closed ? qrPayloadFor({ total, transferCode: transferCode(sessionId) } as CheckoutBreakdown) : null;
  const invoice = closed ? invoiceForSession(sessionId) : null;
  return {
    title,
    tableName: row.table_name,
    openedAt: row.opened_at,
    lines: lines.map((l) => ({ name: l.name, quantity: l.quantity, price: l.price })),
    subtotal,
    discounts,
    total,
    vatRate: breakdown?.vatRate ?? (closed ? row.vat_rate : getSettings().vatRate),
    paymentMethod: closed && row.payment_method ? PAYMENT_LABELS[row.payment_method] : undefined,
    qrPayload: qrPayload ?? undefined,
    footer: [
      ...(qrPayload ? [`Nội dung CK: ${transferCode(sessionId)}`] : []),
      ...(invoice?.invoiceNo ? [`HĐĐT số ${invoice.invoiceNo}`, `Mã tra cứu: ${invoice.lookupCode}`] : []),
    ],
  };
}

/** In hóa đơn tạm tính cho bàn đang mở (kèm mã QR chuyển khoản). */
export function printProvisionalBill(tableId: number, request: CheckoutRequest | null) {
  const session = getOpenSession(tableId);
  if (!session) throw new HttpError(409, 'table_closed');
  const breakdown = request ? computeBreakdown(tableId, request) : undefined;
  if (!enqueueReceipt(billLines(billPrintData(session.id, 'HÓA ĐƠN TẠM TÍNH', breakdown)))) {
    throw new HttpError(409, 'no_receipt_printer');
  }
}

export function reprintBill(billId: number) {
  requireClosedSession(billId);
  if (!enqueueReceipt(billLines(billPrintData(billId, 'HÓA ĐƠN (IN LẠI)')))) throw new HttpError(409, 'no_receipt_printer');
}

// ---------- Danh sách hóa đơn đã thanh toán ----------

type SessionBillRow = {
  id: number;
  table_id: number;
  table_name: string;
  opened_at: string;
  closed_at: string | null;
  subtotal: number | null;
  discount_amount: number;
  discount_note: string;
  total: number | null;
  payment_method: PaymentMethod | null;
  points_used: number;
  points_earned: number;
  vat_rate: number;
  customer_name: string | null;
  customer_phone: string | null;
  cashier: string | null;
};

const BILL_SELECT = `
  SELECT s.*, t.name AS table_name, c.name AS customer_name, c.phone AS customer_phone, st.name AS cashier
  FROM sessions s
  JOIN tables t ON t.id = s.table_id
  LEFT JOIN customers c ON c.id = s.customer_id
  LEFT JOIN staff st ON st.id = s.closed_by`;

function toBill(r: SessionBillRow): BillSummary {
  return {
    id: r.id,
    tableName: r.table_name,
    openedAt: r.opened_at,
    closedAt: r.closed_at!,
    subtotal: r.subtotal ?? r.total ?? 0,
    discountAmount: r.discount_amount,
    total: r.total ?? 0,
    paymentMethod: r.payment_method ?? 'cash',
    customer: r.customer_phone ? { name: r.customer_name ?? '', phone: r.customer_phone } : null,
    cashier: r.cashier,
    invoice: invoiceForSession(r.id),
  };
}

export function listBills(startIso: string, endIso: string): BillSummary[] {
  return (
    db
      .prepare(`${BILL_SELECT} WHERE s.closed_at >= ? AND s.closed_at < ? AND s.merged_into IS NULL ORDER BY s.closed_at DESC`)
      .all(startIso, endIso) as SessionBillRow[]
  ).map(toBill);
}

function requireClosedSession(billId: number) {
  const row = db.prepare(`${BILL_SELECT} WHERE s.id = ? AND s.closed_at IS NOT NULL AND s.merged_into IS NULL`).get(billId) as
    | SessionBillRow
    | undefined;
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}

export function billDetail(billId: number): BillDetail {
  const row = requireClosedSession(billId);
  return {
    ...toBill(row),
    discountNote: row.discount_note,
    pointsUsed: row.points_used,
    pointsEarned: row.points_earned,
    vatRate: row.vat_rate,
    orders: queryOrders('o.session_id = ?', billId),
  };
}

/** Xuất (hoặc xuất lại) hóa đơn điện tử cho bill đã thanh toán, có thể kèm thông tin công ty. */
export async function issueBillInvoice(billId: number, buyerInput: unknown) {
  const row = requireClosedSession(billId);
  const buyer = buyerInput === undefined ? undefined : parseBuyer(buyerInput);
  const invoiceId = ensureInvoiceForBill(billId, () =>
    invoicePayload(
      billId,
      queryOrders('o.session_id = ?', billId),
      { discount: row.discount_amount, total: row.total ?? 0, vatRate: row.vat_rate, paymentMethod: row.payment_method ?? 'cash' },
      buyer ?? null,
    ),
  );
  if (buyer !== undefined) updateInvoiceBuyer(invoiceId, buyer);
  return issueInvoice(invoiceId);
}

export function tableIdOfSession(sessionId: number) {
  const row = db.prepare('SELECT table_id FROM sessions WHERE id = ?').get(sessionId) as { table_id: number } | undefined;
  return row?.table_id ?? null;
}
