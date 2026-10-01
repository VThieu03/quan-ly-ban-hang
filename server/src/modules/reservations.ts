import { db, now } from '../db.ts';
import { bad, HttpError, int, oneOf, str } from '../http.ts';
import { RESERVATION_UPCOMING_HOURS } from '../../../shared/config.ts';
import type { Reservation, ReservationStatus } from '../../../shared/types.ts';

const STATUSES: ReservationStatus[] = ['booked', 'seated', 'cancelled', 'no_show'];
/** Bàn có lịch đặt trong khoảng này sẽ được nhắc trên sơ đồ bàn. */
const UPCOMING_MS = RESERVATION_UPCOMING_HOURS * 60 * 60 * 1000;

type ReservationRow = {
  id: number;
  customer_name: string;
  phone: string;
  party_size: number;
  reserved_at: string;
  table_id: number | null;
  table_name: string | null;
  note: string;
  status: ReservationStatus;
};

const toReservation = (r: ReservationRow): Reservation => ({
  id: r.id,
  customerName: r.customer_name,
  phone: r.phone,
  partySize: r.party_size,
  reservedAt: r.reserved_at,
  tableId: r.table_id,
  tableName: r.table_name,
  note: r.note,
  status: r.status,
});

const SELECT = 'SELECT r.*, t.name AS table_name FROM reservations r LEFT JOIN tables t ON t.id = r.table_id';

export function listReservations(startIso: string, endIso: string): Reservation[] {
  return (
    db.prepare(`${SELECT} WHERE r.reserved_at >= ? AND r.reserved_at < ? ORDER BY r.reserved_at`).all(startIso, endIso) as ReservationRow[]
  ).map(toReservation);
}

export function nextReservationFor(tableId: number): Reservation | null {
  const nowMs = Date.now();
  const row = db
    .prepare(`${SELECT} WHERE r.table_id = ? AND r.status = 'booked' AND r.reserved_at >= ? AND r.reserved_at < ? ORDER BY r.reserved_at LIMIT 1`)
    .get(tableId, new Date(nowMs - 30 * 60_000).toISOString(), new Date(nowMs + UPCOMING_MS).toISOString()) as
    | ReservationRow
    | undefined;
  return row ? toReservation(row) : null;
}

function input(body: Record<string, unknown>) {
  const reservedAt = str(body.reservedAt, 'invalid_time');
  const date = new Date(reservedAt);
  if (Number.isNaN(date.getTime())) throw bad('invalid_time');
  const tableId = body.tableId === null || body.tableId === undefined || body.tableId === '' ? null : int(body.tableId, 'invalid_table');
  if (tableId !== null && !db.prepare('SELECT 1 FROM tables WHERE id = ?').get(tableId)) throw bad('invalid_table');
  return {
    customerName: str(body.customerName, 'invalid_name', { max: 60 }),
    phone: str(body.phone, 'invalid_phone', { max: 20, required: false }),
    partySize: int(body.partySize, 'invalid_party_size', { min: 1, max: 200 }),
    reservedAt: date.toISOString(),
    tableId,
    note: str(body.note, 'invalid_note', { max: 300, required: false }),
  };
}

export function createReservation(body: Record<string, unknown>) {
  const r = input(body);
  db.prepare(
    'INSERT INTO reservations (customer_name, phone, party_size, reserved_at, table_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(r.customerName, r.phone, r.partySize, r.reservedAt, r.tableId, r.note, now());
}

export function updateReservation(id: number, body: Record<string, unknown>) {
  const exists = db.prepare('SELECT 1 FROM reservations WHERE id = ?').get(id);
  if (!exists) throw new HttpError(404, 'not_found');
  if (body.status !== undefined && Object.keys(body).length === 1) {
    db.prepare('UPDATE reservations SET status = ? WHERE id = ?').run(oneOf(body.status, STATUSES, 'invalid_status'), id);
    return;
  }
  const r = input(body);
  db.prepare(
    'UPDATE reservations SET customer_name = ?, phone = ?, party_size = ?, reserved_at = ?, table_id = ?, note = ? WHERE id = ?',
  ).run(r.customerName, r.phone, r.partySize, r.reservedAt, r.tableId, r.note, id);
}

export function seatReservation(id: number, tableId: number) {
  const result = db
    .prepare("UPDATE reservations SET status = 'seated', table_id = ? WHERE id = ? AND status = 'booked'")
    .run(tableId, id);
  if (result.changes === 0) throw new HttpError(409, 'reservation_not_bookable');
}
