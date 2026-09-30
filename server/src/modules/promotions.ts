import { db } from '../db.ts';
import { bad, HttpError, int, oneOf, optionalDate, str } from '../http.ts';
import type { Promotion } from '../../../shared/types.ts';

type PromotionRow = {
  id: number;
  code: string;
  name: string;
  type: 'percent' | 'amount';
  value: number;
  min_subtotal: number;
  max_discount: number | null;
  starts_at: string | null;
  ends_at: string | null;
  usage_limit: number | null;
  used_count: number;
  active: number;
};

const toPromotion = (r: PromotionRow): Promotion => ({
  id: r.id,
  code: r.code,
  name: r.name,
  type: r.type,
  value: r.value,
  minSubtotal: r.min_subtotal,
  maxDiscount: r.max_discount,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  usageLimit: r.usage_limit,
  usedCount: r.used_count,
  active: r.active === 1,
});

export function listPromotions(): Promotion[] {
  return (db.prepare('SELECT * FROM promotions ORDER BY active DESC, id DESC').all() as PromotionRow[]).map(toPromotion);
}

function optionalInt(value: unknown, code: string) {
  return value === null || value === undefined || value === '' ? null : int(value, code, { min: 1 });
}

function input(body: Record<string, unknown>) {
  const type = oneOf(body.type, ['percent', 'amount'] as const, 'invalid_type');
  const value = int(body.value, 'invalid_value', { min: 1, max: type === 'percent' ? 100 : Number.MAX_SAFE_INTEGER });
  const code = str(body.code, 'invalid_code', { max: 30 }).toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(code)) throw bad('invalid_code');
  return {
    code,
    name: str(body.name, 'invalid_name', { max: 100 }),
    type,
    value,
    minSubtotal: body.minSubtotal ? int(body.minSubtotal, 'invalid_min_subtotal') : 0,
    maxDiscount: optionalInt(body.maxDiscount, 'invalid_max_discount'),
    startsAt: optionalDate(body.startsAt, 'invalid_date'),
    endsAt: optionalDate(body.endsAt, 'invalid_date'),
    usageLimit: optionalInt(body.usageLimit, 'invalid_usage_limit'),
    active: body.active === false ? 0 : 1,
  };
}

export function createPromotion(body: Record<string, unknown>) {
  const p = input(body);
  if (db.prepare('SELECT 1 FROM promotions WHERE code = ?').get(p.code)) throw new HttpError(409, 'code_taken');
  db.prepare(
    `INSERT INTO promotions (code, name, type, value, min_subtotal, max_discount, starts_at, ends_at, usage_limit, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(p.code, p.name, p.type, p.value, p.minSubtotal, p.maxDiscount, p.startsAt, p.endsAt, p.usageLimit, p.active);
}

export function updatePromotion(id: number, body: Record<string, unknown>) {
  const p = input(body);
  const clash = db.prepare('SELECT id FROM promotions WHERE code = ? AND id != ?').get(p.code, id);
  if (clash) throw new HttpError(409, 'code_taken');
  const result = db
    .prepare(
      `UPDATE promotions SET code = ?, name = ?, type = ?, value = ?, min_subtotal = ?, max_discount = ?,
         starts_at = ?, ends_at = ?, usage_limit = ?, active = ? WHERE id = ?`,
    )
    .run(p.code, p.name, p.type, p.value, p.minSubtotal, p.maxDiscount, p.startsAt, p.endsAt, p.usageLimit, p.active, id);
  if (result.changes === 0) throw new HttpError(404, 'not_found');
}

/** Kiểm tra mã giảm giá cho một hóa đơn, trả về số tiền được giảm. */
export function applyVoucher(codeInput: string, subtotal: number): { promotion: Promotion; discount: number } {
  const row = db.prepare('SELECT * FROM promotions WHERE code = ?').get(codeInput.trim().toUpperCase()) as
    | PromotionRow
    | undefined;
  if (!row || row.active !== 1) throw new HttpError(409, 'voucher_invalid');
  const nowIso = new Date().toISOString();
  if ((row.starts_at && nowIso < row.starts_at) || (row.ends_at && nowIso > row.ends_at)) {
    throw new HttpError(409, 'voucher_expired');
  }
  if (row.usage_limit !== null && row.used_count >= row.usage_limit) throw new HttpError(409, 'voucher_used_up');
  if (subtotal < row.min_subtotal) throw new HttpError(409, 'voucher_min_subtotal');

  let discount = row.type === 'percent' ? Math.round((subtotal * row.value) / 100) : row.value;
  if (row.max_discount !== null) discount = Math.min(discount, row.max_discount);
  return { promotion: toPromotion(row), discount: Math.min(discount, subtotal) };
}

export function markVoucherUsed(id: number) {
  db.prepare('UPDATE promotions SET used_count = used_count + 1 WHERE id = ?').run(id);
}
