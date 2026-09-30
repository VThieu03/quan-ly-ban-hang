import { db, now } from '../db.ts';
import { bad, HttpError, oneOf, str } from '../http.ts';
import { getSettings } from '../settings.ts';
import { formatPrice, formatTime } from '../../../shared/format.ts';
import type { Order, Printer, PrinterKind, PrintJob, PrintLine } from '../../../shared/types.ts';

const MAX_ATTEMPTS = 5;

type PrinterRow = { id: number; name: string; kind: PrinterKind; address: string; category_ids: string; active: number };

const toPrinter = (r: PrinterRow): Printer => ({
  id: r.id,
  name: r.name,
  kind: r.kind,
  address: r.address,
  categoryIds: JSON.parse(r.category_ids),
  active: r.active === 1,
});

export function listPrinters(): Printer[] {
  return (db.prepare('SELECT * FROM printers ORDER BY id').all() as PrinterRow[]).map(toPrinter);
}

function printerInput(input: Record<string, unknown>) {
  const address = str(input.address, 'invalid_address', { max: 100 });
  if (!/^[\w.-]+(:\d{1,5})?$/.test(address)) throw bad('invalid_address');
  const categoryIds = Array.isArray(input.categoryIds) ? input.categoryIds.filter((c) => typeof c === 'string') : [];
  return {
    name: str(input.name, 'invalid_name', { max: 60 }),
    kind: oneOf(input.kind, ['kitchen', 'receipt'] as const, 'invalid_kind'),
    address,
    categoryIds: JSON.stringify(categoryIds),
    active: input.active === false ? 0 : 1,
  };
}

export function createPrinter(input: Record<string, unknown>) {
  const p = printerInput(input);
  db.prepare('INSERT INTO printers (name, kind, address, category_ids, active) VALUES (?, ?, ?, ?, ?)').run(
    p.name,
    p.kind,
    p.address,
    p.categoryIds,
    p.active,
  );
}

export function updatePrinter(id: number, input: Record<string, unknown>) {
  const p = printerInput(input);
  const result = db
    .prepare('UPDATE printers SET name = ?, kind = ?, address = ?, category_ids = ?, active = ? WHERE id = ?')
    .run(p.name, p.kind, p.address, p.categoryIds, p.active, id);
  if (result.changes === 0) throw new HttpError(404, 'not_found');
}

export function deletePrinter(id: number) {
  db.prepare('DELETE FROM print_jobs WHERE printer_id = ?').run(id);
  db.prepare('DELETE FROM printers WHERE id = ?').run(id);
}

function enqueue(printerId: number, lines: PrintLine[]) {
  db.prepare('INSERT INTO print_jobs (printer_id, content, created_at) VALUES (?, ?, ?)').run(
    printerId,
    JSON.stringify(lines),
    now(),
  );
}

function activePrinters(kind: PrinterKind) {
  return listPrinters().filter((p) => p.active && p.kind === kind);
}

/** Phiếu bếp: mỗi máy in bếp chỉ nhận các món thuộc danh mục của nó. */
export function enqueueKitchenTickets(order: Order) {
  if (!getSettings().printing.kitchenTickets) return;
  const categoryOf = db.prepare('SELECT category_id FROM menu_items WHERE id = ?');
  for (const printer of activePrinters('kitchen')) {
    const items = order.items.filter((item) => {
      if (item.cancelled) return false;
      if (printer.categoryIds.length === 0) return true;
      const row = categoryOf.get(item.menuItemId) as { category_id: string } | undefined;
      return row !== undefined && printer.categoryIds.includes(row.category_id);
    });
    if (items.length === 0) continue;
    enqueue(printer.id, [
      { type: 'text', text: order.tableName, align: 'center', bold: true, size: 'large' },
      { type: 'text', text: `Phiếu bếp #${order.id} · ${formatTime(order.createdAt)}`, align: 'center' },
      { type: 'text', text: order.source === 'staff' ? 'Nhân viên gọi' : 'Khách gọi QR', align: 'center' },
      { type: 'divider' },
      ...items.map((i): PrintLine => ({ type: 'text', text: `${i.quantity} x ${i.name.vi}`, bold: true, size: 'large' })),
      ...(order.note ? [{ type: 'divider' } as PrintLine, { type: 'text', text: `Ghi chú: ${order.note}`, bold: true } as PrintLine] : []),
      { type: 'feed', lines: 3 },
    ]);
  }
}

export type BillPrintData = {
  title: string;
  tableName: string;
  openedAt: string;
  lines: { name: string; quantity: number; price: number }[];
  subtotal: number;
  discounts: { label: string; amount: number }[];
  total: number;
  vatRate: number;
  paymentMethod?: string;
  qrPayload?: string;
  footer?: string[];
};

export function billLines(data: BillPrintData): PrintLine[] {
  const { restaurant } = getSettings();
  return [
    { type: 'text', text: restaurant.name, align: 'center', bold: true, size: 'large' },
    ...(restaurant.address ? [{ type: 'text', text: restaurant.address, align: 'center' } as PrintLine] : []),
    ...(restaurant.phone ? [{ type: 'text', text: `ĐT: ${restaurant.phone}`, align: 'center' } as PrintLine] : []),
    { type: 'divider' },
    { type: 'text', text: data.title, align: 'center', bold: true },
    { type: 'text', text: `${data.tableName} · Vào ${formatTime(data.openedAt)} · In ${formatTime(now())}` },
    { type: 'text', text: new Date().toLocaleDateString('vi-VN') },
    { type: 'divider' },
    ...data.lines.flatMap((l): PrintLine[] => [
      { type: 'text', text: l.name },
      { type: 'row', left: `  ${l.quantity} x ${formatPrice(l.price)}`, right: formatPrice(l.quantity * l.price) },
    ]),
    { type: 'divider' },
    { type: 'row', left: 'Tạm tính', right: formatPrice(data.subtotal) },
    ...data.discounts.map((d): PrintLine => ({ type: 'row', left: d.label, right: `-${formatPrice(d.amount)}` })),
    { type: 'row', left: 'TỔNG CỘNG', right: formatPrice(data.total), bold: true },
    ...(data.vatRate > 0 ? [{ type: 'text', text: `(Giá đã bao gồm VAT ${data.vatRate}%)`, align: 'right' } as PrintLine] : []),
    ...(data.paymentMethod ? [{ type: 'text', text: `Thanh toán: ${data.paymentMethod}` } as PrintLine] : []),
    ...(data.qrPayload
      ? [
          { type: 'text', text: 'Quét mã để chuyển khoản', align: 'center' } as PrintLine,
          { type: 'qr', data: data.qrPayload } as PrintLine,
        ]
      : []),
    ...(data.footer ?? []).map((text): PrintLine => ({ type: 'text', text, align: 'center' })),
    { type: 'text', text: 'Cảm ơn quý khách!', align: 'center' },
    { type: 'feed', lines: 4 },
  ];
}

/** In hóa đơn ra máy in hóa đơn đầu tiên đang bật. Trả về false nếu chưa cấu hình máy in. */
export function enqueueReceipt(lines: PrintLine[]) {
  const printer = activePrinters('receipt')[0];
  if (!printer) return false;
  enqueue(printer.id, lines);
  return true;
}

export function enqueueTestPage(printerId: number) {
  const printer = listPrinters().find((p) => p.id === printerId);
  if (!printer) throw new HttpError(404, 'not_found');
  enqueue(printer.id, [
    { type: 'text', text: 'IN THỬ', align: 'center', bold: true, size: 'large' },
    { type: 'text', text: printer.name, align: 'center' },
    { type: 'text', text: new Date().toLocaleString('vi-VN'), align: 'center' },
    { type: 'divider' },
    { type: 'row', left: 'Tiếng Việt có dấu', right: 'ĐƯỢC' },
    { type: 'qr', data: 'https://example.com' },
    { type: 'feed', lines: 4 },
  ]);
}

// ---------- API cho chương trình in trên máy quầy ----------

export function pendingJobs(): PrintJob[] {
  const { removeAccents } = getSettings().printing;
  const rows = db
    .prepare(
      `SELECT j.id, j.printer_id, j.content, p.name, p.address FROM print_jobs j
       JOIN printers p ON p.id = j.printer_id
       WHERE j.status = 'pending' AND j.attempts < ? AND p.active = 1
       ORDER BY j.id LIMIT 20`,
    )
    .all(MAX_ATTEMPTS) as { id: number; printer_id: number; content: string; name: string; address: string }[];
  return rows.map((r) => ({
    id: r.id,
    printerId: r.printer_id,
    printerName: r.name,
    address: r.address,
    lines: JSON.parse(r.content),
    removeAccents,
  }));
}

export function reportJob(id: number, ok: boolean, error: unknown) {
  if (ok) {
    db.prepare("UPDATE print_jobs SET status = 'printed', printed_at = ? WHERE id = ?").run(now(), id);
  } else {
    db.prepare(
      `UPDATE print_jobs SET attempts = attempts + 1, error = ?,
         status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END
       WHERE id = ?`,
    ).run(typeof error === 'string' ? error.slice(0, 300) : 'unknown', MAX_ATTEMPTS, id);
  }
}

export function recentJobs() {
  return db
    .prepare(
      `SELECT j.id, p.name AS printer, j.status, j.attempts, j.error, j.created_at AS createdAt, j.printed_at AS printedAt
       FROM print_jobs j JOIN printers p ON p.id = j.printer_id ORDER BY j.id DESC LIMIT 30`,
    )
    .all();
}

export function retryJob(id: number) {
  db.prepare("UPDATE print_jobs SET status = 'pending', attempts = 0, error = '' WHERE id = ?").run(id);
}
