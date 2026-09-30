// Lỗi trả về client và các hàm kiểm tra dữ liệu đầu vào.

export class HttpError extends Error {
  status: number;
  itemId?: string;

  constructor(status: number, code: string, itemId?: string) {
    super(code);
    this.status = status;
    this.itemId = itemId;
  }
}

export const bad = (code: string) => new HttpError(400, code);

export function str(value: unknown, code: string, { max = 200, required = true } = {}): string {
  if (value === undefined || value === null) {
    if (required) throw bad(code);
    return '';
  }
  if (typeof value !== 'string') throw bad(code);
  const trimmed = value.trim();
  if ((required && !trimmed) || trimmed.length > max) throw bad(code);
  return trimmed;
}

export function int(value: unknown, code: string, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw bad(code);
  return value as number;
}

export function num(value: unknown, code: string, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw bad(code);
  return value;
}

export function oneOf<T extends string>(value: unknown, options: readonly T[], code: string): T {
  if (!options.includes(value as T)) throw bad(code);
  return value as T;
}

export function optionalDate(value: unknown, code: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) throw bad(code);
  return new Date(value).toISOString();
}

export function phone(value: unknown, code = 'invalid_phone'): string {
  const digits = str(value, code, { max: 20 }).replace(/[\s.-]/g, '');
  if (!/^\+?\d{8,15}$/.test(digits)) throw bad(code);
  return digits;
}

/** Khoảng ngày [from, to] (YYYY-MM-DD, theo giờ máy chủ) → mốc ISO để lọc. */
export function dateRange(from: unknown, to: unknown) {
  const today = new Date().toLocaleDateString('sv-SE');
  const f = typeof from === 'string' && from ? from : today;
  const t = typeof to === 'string' && to ? to : f;
  const start = new Date(`${f}T00:00:00`);
  const end = new Date(`${t}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) throw bad('invalid_date');
  end.setDate(end.getDate() + 1);
  return { from: f, to: t, startIso: start.toISOString(), endIso: end.toISOString() };
}
