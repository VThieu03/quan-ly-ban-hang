import { db } from '../db.ts';
import type { PaymentMethod, ReportSummary } from '../../../shared/types.ts';

/** Hóa đơn đã thanh toán trong khoảng thời gian, không tính bàn bị gộp và hóa đơn đã hủy. */
const CLOSED = 's.closed_at >= ? AND s.closed_at < ? AND s.merged_into IS NULL AND s.voided_at IS NULL';

/** Giờ theo múi giờ máy chủ (dùng để nhóm theo ngày/giờ). */
function local(iso: string) {
  const d = new Date(iso);
  return { date: d.toLocaleDateString('sv-SE'), hour: d.getHours() };
}

export function getReport(from: string, to: string, startIso: string, endIso: string): ReportSummary {
  const bills = db
    .prepare(
      `SELECT s.id, s.closed_at, s.subtotal, s.total, s.discount_amount, s.payment_method, s.guest_count, s.closed_by,
              st.name AS staff_name
       FROM sessions s LEFT JOIN staff st ON st.id = s.closed_by WHERE ${CLOSED}`,
    )
    .all(startIso, endIso) as {
    id: number;
    closed_at: string;
    subtotal: number | null;
    total: number;
    discount_amount: number;
    payment_method: PaymentMethod;
    guest_count: number | null;
    closed_by: number | null;
    staff_name: string | null;
  }[];

  const byMethod: Record<PaymentMethod, number> = { cash: 0, transfer: 0, card: 0 };
  const byDay = new Map<string, { date: string; bills: number; revenue: number }>();
  const byHour = new Map<number, { hour: number; bills: number; revenue: number }>();
  const byStaff = new Map<string, { staffId: number | null; name: string; bills: number; revenue: number }>();
  let revenue = 0;
  let subtotal = 0;
  let discounts = 0;
  let guests = 0;

  // Điền đủ các ngày trong khoảng để biểu đồ không bị hụt ngày.
  for (let d = new Date(`${from}T00:00:00`); d <= new Date(`${to}T00:00:00`); d.setDate(d.getDate() + 1)) {
    const key = d.toLocaleDateString('sv-SE');
    byDay.set(key, { date: key, bills: 0, revenue: 0 });
  }

  for (const b of bills) {
    revenue += b.total;
    subtotal += b.subtotal ?? b.total;
    discounts += b.discount_amount;
    guests += b.guest_count ?? 0;
    byMethod[b.payment_method] = (byMethod[b.payment_method] ?? 0) + b.total;
    const { date, hour } = local(b.closed_at);
    const day = byDay.get(date) ?? { date, bills: 0, revenue: 0 };
    day.bills++;
    day.revenue += b.total;
    byDay.set(date, day);
    const h = byHour.get(hour) ?? { hour, bills: 0, revenue: 0 };
    h.bills++;
    h.revenue += b.total;
    byHour.set(hour, h);
    const staffKey = String(b.closed_by);
    const s = byStaff.get(staffKey) ?? { staffId: b.closed_by, name: b.staff_name ?? 'Tự động / không ghi nhận', bills: 0, revenue: 0 };
    s.bills++;
    s.revenue += b.total;
    byStaff.set(staffKey, s);
  }

  // Doanh số món tính theo giá bán (trước giảm giá trên hóa đơn).
  const items = db
    .prepare(
      `SELECT i.menu_item_id, i.name, SUM(i.quantity) AS quantity, SUM(i.quantity * i.price) AS revenue,
              m.category_id, c.title AS category_title
       FROM order_items i
       JOIN orders o ON o.id = i.order_id
       JOIN sessions s ON s.id = o.session_id
       LEFT JOIN menu_items m ON m.id = i.menu_item_id
       LEFT JOIN categories c ON c.id = m.category_id
       WHERE ${CLOSED} AND i.cancelled = 0 AND o.status != 'cancelled'
       GROUP BY i.menu_item_id
       ORDER BY quantity DESC`,
    )
    .all(startIso, endIso) as {
    menu_item_id: string;
    name: string;
    quantity: number;
    revenue: number;
    category_id: string | null;
    category_title: string | null;
  }[];

  const byCategory = new Map<string, { categoryId: string; name: string; quantity: number; revenue: number }>();
  for (const i of items) {
    const key = i.category_id ?? 'other';
    const c = byCategory.get(key) ?? {
      categoryId: key,
      name: i.category_title ? JSON.parse(i.category_title).vi : 'Khác',
      quantity: 0,
      revenue: 0,
    };
    c.quantity += i.quantity;
    c.revenue += i.revenue;
    byCategory.set(key, c);
  }

  const cancelled = db
    .prepare(
      `SELECT COUNT(*) AS items, COALESCE(SUM(i.quantity * i.price), 0) AS amount
       FROM order_items i JOIN orders o ON o.id = i.order_id JOIN sessions s ON s.id = o.session_id
       WHERE ${CLOSED} AND (i.cancelled = 1 OR o.status = 'cancelled')`,
    )
    .get(startIso, endIso) as { items: number; amount: number };

  // Giá vốn = nguyên liệu đã trừ kho khi bán (theo giá bình quân lúc bán).
  const { cogs } = db
    .prepare(
      `SELECT COALESCE(SUM(-m.qty_change * m.unit_cost), 0) AS cogs FROM stock_moves m
       JOIN sessions s ON s.id = m.ref_id WHERE m.type = 'sale' AND ${CLOSED}`,
    )
    .get(startIso, endIso) as { cogs: number };

  const voided = db
    .prepare(
      `SELECT COUNT(*) AS bills, COALESCE(SUM(total), 0) AS amount FROM sessions
       WHERE closed_at >= ? AND closed_at < ? AND merged_into IS NULL AND voided_at IS NOT NULL`,
    )
    .get(startIso, endIso) as { bills: number; amount: number };

  return {
    from,
    to,
    bills: bills.length,
    guests,
    subtotal,
    discounts,
    revenue,
    averageBill: bills.length ? Math.round(revenue / bills.length) : 0,
    cogs: Math.round(cogs),
    grossProfit: revenue - Math.round(cogs),
    byMethod,
    byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byHour: [...byHour.values()].sort((a, b) => a.hour - b.hour),
    topItems: items.slice(0, 20).map((i) => ({ menuItemId: i.menu_item_id, name: JSON.parse(i.name).vi, quantity: i.quantity, revenue: i.revenue })),
    byCategory: [...byCategory.values()].sort((a, b) => b.revenue - a.revenue),
    byStaff: [...byStaff.values()].sort((a, b) => b.revenue - a.revenue),
    cancelled,
    voided,
  };
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Xuất danh sách hóa đơn ra CSV (mở bằng Excel). */
export function billsCsv(startIso: string, endIso: string) {
  const rows = db
    .prepare(
      `SELECT s.id, t.name AS table_name, s.opened_at, s.closed_at, s.guest_count, s.subtotal, s.discount_amount,
              s.discount_note, s.total, s.payment_method, s.vat_rate, c.phone, c.name AS customer_name, st.name AS cashier,
              inv.invoice_no, s.voided_at, s.void_reason
       FROM sessions s JOIN tables t ON t.id = s.table_id
       LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN staff st ON st.id = s.closed_by
       LEFT JOIN invoices inv ON inv.session_id = s.id
       WHERE s.closed_at >= ? AND s.closed_at < ? AND s.merged_into IS NULL ORDER BY s.closed_at`,
    )
    .all(startIso, endIso) as Record<string, unknown>[];
  const header = [
    'Mã HĐ', 'Bàn', 'Giờ vào', 'Giờ thanh toán', 'Số khách', 'Tạm tính', 'Giảm giá', 'Ghi chú giảm',
    'Thành tiền', 'Hình thức', 'VAT %', 'SĐT khách', 'Tên khách', 'Thu ngân', 'Số HĐĐT', 'Trạng thái', 'Lý do hủy',
  ];
  const lines = rows.map((r) =>
    [
      r.id, r.table_name, new Date(r.opened_at as string).toLocaleString('vi-VN'), new Date(r.closed_at as string).toLocaleString('vi-VN'),
      r.guest_count, r.subtotal, r.discount_amount, r.discount_note, r.total, r.payment_method, r.vat_rate,
      r.phone, r.customer_name, r.cashier, r.invoice_no, r.voided_at ? 'Đã hủy' : 'Đã thanh toán', r.void_reason,
    ]
      .map(csvCell)
      .join(','),
  );
  // BOM để Excel đọc đúng tiếng Việt.
  return '﻿' + [header.join(','), ...lines].join('\r\n');
}
