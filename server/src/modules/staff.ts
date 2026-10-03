import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db, now, randomToken, transaction } from '../db.ts';
import { bad, HttpError, int, oneOf, str } from '../http.ts';
import { getSettings } from '../settings.ts';
import { ROLES } from '../../../shared/permissions.ts';
import type { Role } from '../../../shared/permissions.ts';
import type { CashShift, StaffMember, Timesheet } from '../../../shared/types.ts';

// ---------- Mã PIN ----------

function hashPin(pin: string) {
  const salt = randomBytes(16);
  return `${salt.toString('base64')}:${scryptSync(pin, salt, 32).toString('base64')}`;
}

function verifyPin(pin: string, stored: string) {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(pin, Buffer.from(salt, 'base64'), 32);
  return timingSafeEqual(expected, actual);
}

function validPin(value: unknown) {
  const pin = str(value, 'invalid_pin', { max: 12 });
  if (!/^\d{4,12}$/.test(pin)) throw bad('invalid_pin');
  return pin;
}

// ---------- Nhân viên ----------

type StaffRow = { id: number; name: string; role: Role; pin_hash: string; active: number };

const toStaff = (r: StaffRow): StaffMember => ({ id: r.id, name: r.name, role: r.role, active: r.active === 1 });

export function listStaff(): StaffMember[] {
  return (db.prepare('SELECT * FROM staff ORDER BY active DESC, id').all() as StaffRow[]).map(toStaff);
}

function findStaffByPin(pin: string): StaffRow | undefined {
  const rows = db.prepare('SELECT * FROM staff WHERE active = 1').all() as StaffRow[];
  return rows.find((r) => verifyPin(pin, r.pin_hash));
}

export function createStaff(input: { name?: unknown; role?: unknown; pin?: unknown }): StaffMember {
  const name = str(input.name, 'invalid_name', { max: 60 });
  const role = oneOf(input.role, ROLES, 'invalid_role');
  const pin = validPin(input.pin);
  // PIN dùng để nhận diện người đăng nhập nên không được trùng.
  if (findStaffByPin(pin)) throw new HttpError(409, 'pin_taken');
  const result = db
    .prepare('INSERT INTO staff (name, role, pin_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(name, role, hashPin(pin), now());
  return toStaff(db.prepare('SELECT * FROM staff WHERE id = ?').get(Number(result.lastInsertRowid)) as StaffRow);
}

export function updateStaff(id: number, input: { name?: unknown; role?: unknown; pin?: unknown; active?: unknown }) {
  const row = db.prepare('SELECT * FROM staff WHERE id = ?').get(id) as StaffRow | undefined;
  if (!row) throw new HttpError(404, 'not_found');
  const name = input.name !== undefined ? str(input.name, 'invalid_name', { max: 60 }) : row.name;
  const role = input.role !== undefined ? oneOf(input.role, ROLES, 'invalid_role') : row.role;
  const active = input.active !== undefined ? Boolean(input.active) : row.active === 1;

  // Không cho khóa / hạ quyền quản lý cuối cùng, tránh bị khóa ngoài hệ thống.
  if (row.role === 'admin' && (role !== 'admin' || !active)) {
    const { count } = db.prepare("SELECT COUNT(*) AS count FROM staff WHERE role = 'admin' AND active = 1").get() as {
      count: number;
    };
    if (count <= 1) throw new HttpError(409, 'last_admin');
  }

  let pinHash = row.pin_hash;
  if (input.pin !== undefined && input.pin !== '') {
    const pin = validPin(input.pin);
    const owner = findStaffByPin(pin);
    if (owner && owner.id !== id) throw new HttpError(409, 'pin_taken');
    pinHash = hashPin(pin);
  }
  transaction(() => {
    db.prepare('UPDATE staff SET name = ?, role = ?, active = ?, pin_hash = ? WHERE id = ?').run(
      name,
      role,
      active ? 1 : 0,
      pinHash,
      id,
    );
    if (!active || pinHash !== row.pin_hash) db.prepare('DELETE FROM staff_tokens WHERE staff_id = ?').run(id);
  });
}

export function ensureAdmin() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM staff').get() as { count: number };
  if (count > 0) return;
  const pin = process.env.STAFF_PIN ?? '1234';
  db.prepare("INSERT INTO staff (name, role, pin_hash, created_at) VALUES ('Quản lý', 'admin', ?, ?)").run(
    hashPin(pin),
    now(),
  );
  console.log(`Đã tạo tài khoản quản lý đầu tiên (PIN lấy từ STAFF_PIN${process.env.STAFF_PIN ? '' : ', mặc định 1234'}).`);
}

// ---------- Đăng nhập ----------

// Chống dò PIN theo từng địa chỉ IP: sai N lần thì khóa tạm (chỉnh trong Cài đặt → Hệ thống).
const failures = new Map<string, { count: number; lockedUntil: number }>();

export function login(pinInput: unknown, ip: string): { token: string; staff: StaffMember } {
  const entry = failures.get(ip);
  if (entry && Date.now() < entry.lockedUntil) throw new HttpError(429, 'too_many_attempts');

  const staff = typeof pinInput === 'string' ? findStaffByPin(pinInput) : undefined;
  if (!staff) {
    const count = (entry?.count ?? 0) + 1;
    const { loginMaxFailed, loginLockMinutes } = getSettings().system;
    failures.set(ip, count >= loginMaxFailed ? { count: 0, lockedUntil: Date.now() + loginLockMinutes * 60_000 } : { count, lockedUntil: 0 });
    throw new HttpError(401, 'wrong_pin');
  }
  failures.delete(ip);
  const token = randomToken(24);
  db.prepare('INSERT INTO staff_tokens (token, staff_id, created_at) VALUES (?, ?, ?)').run(token, staff.id, now());
  return { token, staff: toStaff(staff) };
}

export function staffFromToken(token: string): StaffMember | undefined {
  const row = db
    .prepare('SELECT s.* FROM staff_tokens t JOIN staff s ON s.id = t.staff_id WHERE t.token = ? AND s.active = 1')
    .get(token) as StaffRow | undefined;
  return row ? toStaff(row) : undefined;
}

export function logout(token: string) {
  db.prepare('DELETE FROM staff_tokens WHERE token = ?').run(token);
}

// ---------- Chấm công ----------

type TimesheetRow = { id: number; staff_id: number; staff_name: string; clock_in: string; clock_out: string | null };

const toTimesheet = (r: TimesheetRow): Timesheet => ({
  id: r.id,
  staffId: r.staff_id,
  staffName: r.staff_name,
  clockIn: r.clock_in,
  clockOut: r.clock_out,
  minutes: Math.round(((r.clock_out ? new Date(r.clock_out) : new Date()).getTime() - new Date(r.clock_in).getTime()) / 60_000),
});

export function currentTimesheet(staffId: number): Timesheet | null {
  const row = db
    .prepare(
      `SELECT t.*, s.name AS staff_name FROM timesheets t JOIN staff s ON s.id = t.staff_id
       WHERE t.staff_id = ? AND t.clock_out IS NULL`,
    )
    .get(staffId) as TimesheetRow | undefined;
  return row ? toTimesheet(row) : null;
}

export function clockIn(staffId: number) {
  if (currentTimesheet(staffId)) throw new HttpError(409, 'already_clocked_in');
  db.prepare('INSERT INTO timesheets (staff_id, clock_in) VALUES (?, ?)').run(staffId, now());
}

export function clockOut(staffId: number) {
  const current = currentTimesheet(staffId);
  if (!current) throw new HttpError(409, 'not_clocked_in');
  db.prepare('UPDATE timesheets SET clock_out = ? WHERE id = ?').run(now(), current.id);
}

export function listTimesheets(startIso: string, endIso: string): Timesheet[] {
  return (
    db
      .prepare(
        `SELECT t.*, s.name AS staff_name FROM timesheets t JOIN staff s ON s.id = t.staff_id
         WHERE t.clock_in >= ? AND t.clock_in < ? ORDER BY t.clock_in DESC`,
      )
      .all(startIso, endIso) as TimesheetRow[]
  ).map(toTimesheet);
}

// ---------- Ca thu ngân ----------

type ShiftRow = {
  id: number;
  staff_name: string;
  opened_at: string;
  opening_cash: number;
  closed_at: string | null;
  closed_by_name: string | null;
  counted_cash: number | null;
  expected_cash: number | null;
  note: string;
};

function cashSalesBetween(fromIso: string, toIso: string) {
  const row = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE method = 'cash' AND created_at >= ? AND created_at < ?")
    .get(fromIso, toIso) as { total: number };
  return row.total;
}

function toShift(r: ShiftRow): CashShift {
  const cashSales = cashSalesBetween(r.opened_at, r.closed_at ?? '9999');
  return {
    id: r.id,
    staffName: r.staff_name,
    openedAt: r.opened_at,
    openingCash: r.opening_cash,
    closedAt: r.closed_at,
    closedByName: r.closed_by_name,
    cashSales,
    expectedCash: r.expected_cash ?? r.opening_cash + cashSales,
    countedCash: r.counted_cash,
    note: r.note,
  };
}

const SHIFT_SELECT = `
  SELECT c.*, s.name AS staff_name, cb.name AS closed_by_name
  FROM cash_shifts c JOIN staff s ON s.id = c.staff_id LEFT JOIN staff cb ON cb.id = c.closed_by`;

export function currentShift(): CashShift | null {
  const row = db.prepare(`${SHIFT_SELECT} WHERE c.closed_at IS NULL`).get() as ShiftRow | undefined;
  return row ? toShift(row) : null;
}

export function listShifts(): CashShift[] {
  return (db.prepare(`${SHIFT_SELECT} ORDER BY c.id DESC LIMIT 60`).all() as ShiftRow[]).map(toShift);
}

export function openShift(staffId: number, openingCash: unknown) {
  if (currentShift()) throw new HttpError(409, 'shift_already_open');
  db.prepare('INSERT INTO cash_shifts (staff_id, opened_at, opening_cash) VALUES (?, ?, ?)').run(
    staffId,
    now(),
    int(openingCash, 'invalid_amount'),
  );
}

export function closeShift(staffId: number, countedCash: unknown, note: unknown): CashShift {
  const shift = currentShift();
  if (!shift) throw new HttpError(409, 'no_open_shift');
  const closedAt = now();
  const expected = shift.openingCash + cashSalesBetween(shift.openedAt, closedAt);
  db.prepare(
    'UPDATE cash_shifts SET closed_at = ?, closed_by = ?, counted_cash = ?, expected_cash = ?, note = ? WHERE id = ?',
  ).run(
    closedAt,
    staffId,
    int(countedCash, 'invalid_amount'),
    expected,
    str(note, 'invalid_note', { max: 300, required: false }),
    shift.id,
  );
  return toShift(db.prepare(`${SHIFT_SELECT} WHERE c.id = ?`).get(shift.id) as ShiftRow);
}
