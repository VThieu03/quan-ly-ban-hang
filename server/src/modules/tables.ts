import { db, now, randomToken, transaction } from '../db.ts';
import { bad, HttpError, int, str } from '../http.ts';
import { clearPendingPayment, queryOrders } from './orders.ts';
import { nextReservationFor, seatReservation } from './reservations.ts';
import type { CheckoutBreakdown, StaffTable, TableSession } from '../../../shared/types.ts';

type SessionRow = {
  id: number;
  table_id: number;
  opened_at: string;
  bill_requested_at: string | null;
  guest_count: number | null;
  pending_payment: string | null;
};

export function getOpenSessionRow(tableId: number) {
  return db
    .prepare(
      `SELECT id, table_id, opened_at, bill_requested_at, guest_count, pending_payment
       FROM sessions WHERE table_id = ? AND closed_at IS NULL`,
    )
    .get(tableId) as SessionRow | undefined;
}

export function getOpenSession(tableId: number): TableSession | null {
  const row = getOpenSessionRow(tableId);
  if (!row) return null;
  const orders = queryOrders('o.session_id = ?', row.id);
  return {
    id: row.id,
    openedAt: row.opened_at,
    billRequestedAt: row.bill_requested_at,
    guestCount: row.guest_count,
    orders,
    total: orders.reduce((sum, o) => sum + o.total, 0),
    pendingPayment: row.pending_payment ? (JSON.parse(row.pending_payment) as CheckoutBreakdown) : null,
  };
}

/** Phiên bản cho khách: không lộ thông tin thanh toán nội bộ. */
export function getCustomerSession(tableId: number): TableSession | null {
  const session = getOpenSession(tableId);
  return session && { ...session, pendingPayment: null };
}

type TableRow = { id: number; name: string; area: string; token: string };

export function findTableByToken(token: string) {
  return db.prepare('SELECT id, name, area, token FROM tables WHERE token = ?').get(token) as TableRow | undefined;
}

export function requireTable(tableId: number) {
  const table = db.prepare('SELECT id, name, area, token FROM tables WHERE id = ?').get(tableId) as TableRow | undefined;
  if (!table) throw new HttpError(404, 'not_found');
  return table;
}

export function getStaffTables(): StaffTable[] {
  const tables = db.prepare('SELECT id, name, area, token FROM tables ORDER BY area, id').all() as TableRow[];
  return tables.map((t) => ({ ...t, session: getOpenSession(t.id), nextReservation: nextReservationFor(t.id) }));
}

export function createTable(input: { name?: unknown; area?: unknown }) {
  const result = db
    .prepare('INSERT INTO tables (name, area, token) VALUES (?, ?, ?)')
    .run(
      str(input.name, 'invalid_name', { max: 40 }),
      str(input.area, 'invalid_area', { max: 40, required: false }),
      randomToken(),
    );
  return Number(result.lastInsertRowid);
}

export function updateTable(tableId: number, input: { name?: unknown; area?: unknown }) {
  const table = requireTable(tableId);
  db.prepare('UPDATE tables SET name = ?, area = ? WHERE id = ?').run(
    input.name !== undefined ? str(input.name, 'invalid_name', { max: 40 }) : table.name,
    input.area !== undefined ? str(input.area, 'invalid_area', { max: 40, required: false }) : table.area,
    tableId,
  );
}

/** Đổi mã QR của bàn (khi mã cũ bị lộ). Mã QR đã in trước đó sẽ hết hiệu lực. */
export function regenerateTableToken(tableId: number) {
  requireTable(tableId);
  db.prepare('UPDATE tables SET token = ? WHERE id = ?').run(randomToken(), tableId);
}

export function deleteTable(tableId: number) {
  requireTable(tableId);
  const used = db.prepare('SELECT 1 FROM sessions WHERE table_id = ? LIMIT 1').get(tableId);
  if (used) throw new HttpError(409, 'table_has_history');
  db.prepare('DELETE FROM tables WHERE id = ?').run(tableId);
}

export function openTable(
  tableId: number,
  input: { guestCount?: unknown; reservationId?: unknown } = {},
  staffId: number | null = null,
) {
  requireTable(tableId);
  if (getOpenSessionRow(tableId)) throw new HttpError(409, 'table_already_open');
  const guestCount =
    input.guestCount === undefined || input.guestCount === null ? null : int(input.guestCount, 'invalid_guest_count', { min: 1, max: 100 });
  const reservationId =
    input.reservationId === undefined || input.reservationId === null ? null : int(input.reservationId, 'invalid_reservation');
  transaction(() => {
    db.prepare(
      'INSERT INTO sessions (table_id, opened_at, guest_count, opened_by, reservation_id) VALUES (?, ?, ?, ?, ?)',
    ).run(tableId, now(), guestCount, staffId, reservationId);
    if (reservationId) seatReservation(reservationId, tableId);
  });
}

export function requestBill(tableId: number) {
  const session = getOpenSessionRow(tableId);
  if (!session) throw new HttpError(409, 'table_closed');
  if (!session.bill_requested_at) {
    db.prepare('UPDATE sessions SET bill_requested_at = ? WHERE id = ?').run(now(), session.id);
  }
}

/** Chuyển cả bàn sang bàn trống khác. */
export function moveTable(fromTableId: number, toTableId: number) {
  if (fromTableId === toTableId) throw bad('same_table');
  requireTable(toTableId);
  const session = getOpenSessionRow(fromTableId);
  if (!session) throw new HttpError(409, 'table_closed');
  if (getOpenSessionRow(toTableId)) throw new HttpError(409, 'target_table_busy');
  db.prepare('UPDATE sessions SET table_id = ? WHERE id = ?').run(toTableId, session.id);
}

/** Gộp bàn: toàn bộ đơn của bàn nguồn chuyển sang bàn đích, bàn nguồn được đóng. */
export function mergeTables(fromTableId: number, intoTableId: number) {
  if (fromTableId === intoTableId) throw bad('same_table');
  const source = getOpenSessionRow(fromTableId);
  const target = getOpenSessionRow(intoTableId);
  if (!source || !target) throw new HttpError(409, 'table_closed');
  transaction(() => {
    db.prepare('UPDATE orders SET session_id = ? WHERE session_id = ?').run(target.id, source.id);
    db.prepare(
      `UPDATE sessions SET guest_count = COALESCE(guest_count, 0) + ?,
         bill_requested_at = COALESCE(bill_requested_at, ?) WHERE id = ?`,
    ).run(source.guest_count ?? 0, source.bill_requested_at, target.id);
    db.prepare('UPDATE sessions SET closed_at = ?, merged_into = ?, subtotal = 0, total = 0 WHERE id = ?').run(
      now(),
      target.id,
      source.id,
    );
    clearPendingPayment(target.id);
  });
}

export function seedTables() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM tables').get() as { count: number };
  if (count > 0) return;
  const tableCount = Number(process.env.TABLE_COUNT ?? 10);
  const insert = db.prepare('INSERT INTO tables (name, token) VALUES (?, ?)');
  transaction(() => {
    for (let i = 1; i <= tableCount; i++) insert.run(`Bàn ${i}`, randomToken());
  });
  console.log(`Đã tạo ${tableCount} bàn.`);
}
