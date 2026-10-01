import { db, now, transaction } from '../db.ts';
import { HttpError, int, phone, str } from '../http.ts';
import type { Customer } from '../../../shared/types.ts';

type CustomerRow = {
  id: number;
  phone: string;
  name: string;
  points: number;
  total_spent: number;
  visits: number;
  note: string;
  created_at: string;
};

const toCustomer = (r: CustomerRow): Customer => ({
  id: r.id,
  phone: r.phone,
  name: r.name,
  points: r.points,
  totalSpent: r.total_spent,
  visits: r.visits,
  note: r.note,
  createdAt: r.created_at,
});

export function listCustomers(search: unknown): Customer[] {
  const q = typeof search === 'string' ? search.trim() : '';
  const rows = q
    ? db
        .prepare('SELECT * FROM customers WHERE phone LIKE ? OR name LIKE ? ORDER BY total_spent DESC LIMIT 100')
        .all(`%${q}%`, `%${q}%`)
    : db.prepare('SELECT * FROM customers ORDER BY total_spent DESC LIMIT 100').all();
  return (rows as CustomerRow[]).map(toCustomer);
}

export function findCustomerByPhone(value: string): Customer | null {
  const row = db.prepare('SELECT * FROM customers WHERE phone = ?').get(value) as CustomerRow | undefined;
  return row ? toCustomer(row) : null;
}

export function lookupCustomer(value: unknown): Customer | null {
  return findCustomerByPhone(phone(value));
}

/** Tìm theo SĐT, chưa có thì tạo mới. Dùng khi thanh toán. */
export function upsertCustomer(phoneNumber: string, name: string): Customer {
  const existing = findCustomerByPhone(phoneNumber);
  if (existing) {
    if (name && !existing.name) db.prepare('UPDATE customers SET name = ? WHERE id = ?').run(name, existing.id);
    return { ...existing, name: existing.name || name };
  }
  db.prepare('INSERT INTO customers (phone, name, created_at) VALUES (?, ?, ?)').run(phoneNumber, name, now());
  return findCustomerByPhone(phoneNumber)!;
}

export function createCustomer(body: Record<string, unknown>) {
  const phoneNumber = phone(body.phone);
  if (findCustomerByPhone(phoneNumber)) throw new HttpError(409, 'phone_taken');
  db.prepare('INSERT INTO customers (phone, name, note, created_at) VALUES (?, ?, ?, ?)').run(
    phoneNumber,
    str(body.name, 'invalid_name', { max: 60, required: false }),
    str(body.note, 'invalid_note', { max: 300, required: false }),
    now(),
  );
}

/** Xóa khách hàng; hóa đơn cũ vẫn giữ nhưng không còn gắn với khách này. */
export function deleteCustomer(id: number) {
  transaction(() => {
    db.prepare('UPDATE sessions SET customer_id = NULL WHERE customer_id = ?').run(id);
    const result = db.prepare('DELETE FROM customers WHERE id = ?').run(id);
    if (result.changes === 0) throw new HttpError(404, 'not_found');
  });
}

export function updateCustomer(id: number, body: Record<string, unknown>) {
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as CustomerRow | undefined;
  if (!row) throw new HttpError(404, 'not_found');
  db.prepare('UPDATE customers SET name = ?, note = ?, points = ? WHERE id = ?').run(
    body.name !== undefined ? str(body.name, 'invalid_name', { max: 60, required: false }) : row.name,
    body.note !== undefined ? str(body.note, 'invalid_note', { max: 300, required: false }) : row.note,
    body.points !== undefined ? int(body.points, 'invalid_points') : row.points,
    id,
  );
}
