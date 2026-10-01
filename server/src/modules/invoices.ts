import { db, now, randomToken } from '../db.ts';
import { HttpError } from '../http.ts';
import { getSettings } from '../settings.ts';
import type { InvoiceBuyer, InvoiceInfo, InvoiceProviderId, InvoiceStatus, PaymentMethod } from '../../../shared/types.ts';

// Hóa đơn điện tử khởi tạo từ máy tính tiền.
// Mỗi nhà cung cấp (Viettel S-Invoice, VNPT, MISA meInvoice...) là một adapter cài đặt InvoiceProvider.
// Khi đã chọn nhà cung cấp và có tài liệu API + tài khoản test, thêm adapter mới vào PROVIDERS.

export type InvoicePayload = {
  sessionId: number;
  issuedAt: string;
  seller: { name: string; taxCode: string; address: string; phone: string };
  template: { templateCode: string; series: string };
  buyer: InvoiceBuyer | null; // null = khách lẻ không lấy hóa đơn công ty
  paymentMethod: PaymentMethod;
  /** Giá đã bao gồm thuế GTGT. */
  lines: { name: string; unit: string; quantity: number; unitPrice: number; amount: number }[];
  discount: number;
  vatRate: number;
  amountBeforeVat: number;
  vatAmount: number;
  total: number;
};

type IssueResult = { invoiceNo: string; lookupCode: string; lookupUrl: string | null };

interface InvoiceProvider {
  issue(payload: InvoicePayload): Promise<IssueResult>;
  /** Hủy hóa đơn đã phát hành (khi hủy bill). Không có thì phải hủy tay trên trang nhà cung cấp. */
  cancel?(invoiceNo: string, reason: string): Promise<void>;
}

/** Nhà cung cấp giả lập để chạy thử quy trình, KHÔNG gửi lên cơ quan thuế. */
const mockProvider: InvoiceProvider = {
  async issue() {
    const { count } = db.prepare("SELECT COUNT(*) AS count FROM invoices WHERE invoice_no IS NOT NULL").get() as {
      count: number;
    };
    return { invoiceNo: `TEST-${String(count + 1).padStart(7, '0')}`, lookupCode: randomToken(6).toUpperCase(), lookupUrl: null };
  },
  async cancel() {},
};

const PROVIDERS: Record<Exclude<InvoiceProviderId, 'none'>, InvoiceProvider> = {
  mock: mockProvider,
};

type InvoiceRow = {
  id: number;
  session_id: number;
  status: InvoiceStatus;
  provider: string;
  invoice_no: string | null;
  lookup_code: string | null;
  lookup_url: string | null;
  payload: string;
  error: string;
  issued_at: string | null;
};

export const toInvoiceInfo = (r: InvoiceRow): InvoiceInfo => ({
  id: r.id,
  status: r.status,
  provider: r.provider,
  invoiceNo: r.invoice_no,
  lookupCode: r.lookup_code,
  lookupUrl: r.lookup_url,
  error: r.error,
  issuedAt: r.issued_at,
});

export function invoiceForSession(sessionId: number): InvoiceInfo | null {
  const row = db.prepare('SELECT * FROM invoices WHERE session_id = ?').get(sessionId) as InvoiceRow | undefined;
  return row ? toInvoiceInfo(row) : null;
}

/** Tạo bản ghi hóa đơn (trạng thái chờ) trong transaction thanh toán; việc gửi đi làm sau bằng issueInvoice. */
export function createInvoice(payload: InvoicePayload): number | null {
  const { provider } = getSettings().invoice;
  if (provider === 'none') return null;
  const result = db
    .prepare('INSERT INTO invoices (session_id, status, provider, buyer, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(payload.sessionId, 'pending', provider, JSON.stringify(payload.buyer), JSON.stringify(payload), now());
  return Number(result.lastInsertRowid);
}

export async function issueInvoice(invoiceId: number): Promise<InvoiceInfo> {
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as InvoiceRow | undefined;
  if (!row) throw new HttpError(404, 'not_found');
  if (row.status === 'issued' || row.status === 'cancelled') return toInvoiceInfo(row);
  const provider = PROVIDERS[row.provider as keyof typeof PROVIDERS];
  try {
    if (!provider) throw new Error(`Chưa cài đặt nhà cung cấp "${row.provider}"`);
    const result = await provider.issue(JSON.parse(row.payload) as InvoicePayload);
    db.prepare(
      "UPDATE invoices SET status = 'issued', invoice_no = ?, lookup_code = ?, lookup_url = ?, error = '', attempts = attempts + 1, issued_at = ? WHERE id = ?",
    ).run(result.invoiceNo, result.lookupCode, result.lookupUrl, now(), invoiceId);
  } catch (err) {
    db.prepare("UPDATE invoices SET status = 'failed', error = ?, attempts = attempts + 1 WHERE id = ?").run(
      err instanceof Error ? err.message.slice(0, 300) : String(err),
      invoiceId,
    );
  }
  return toInvoiceInfo(db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as InvoiceRow);
}

/** Tạo hóa đơn cho bill đã thanh toán mà chưa có (ví dụ khách xin xuất hóa đơn công ty sau). */
export function ensureInvoiceForBill(sessionId: number, buildPayload: () => InvoicePayload): number {
  const existing = invoiceForSession(sessionId);
  if (existing) {
    if (existing.status === 'issued') throw new HttpError(409, 'invoice_already_issued');
    return existing.id;
  }
  const id = createInvoice(buildPayload());
  if (id === null) throw new HttpError(409, 'invoice_disabled');
  return id;
}

export function updateInvoiceBuyer(invoiceId: number, buyer: InvoiceBuyer | null) {
  const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as InvoiceRow;
  if (row.status === 'issued') throw new HttpError(409, 'invoice_already_issued');
  const payload = { ...(JSON.parse(row.payload) as InvoicePayload), buyer };
  db.prepare('UPDATE invoices SET buyer = ?, payload = ? WHERE id = ?').run(JSON.stringify(buyer), JSON.stringify(payload), invoiceId);
}

/**
 * Hủy hóa đơn điện tử của một bill bị hủy. Hóa đơn chưa phát hành thì chỉ đánh dấu hủy (không gửi nữa);
 * đã phát hành thì gọi nhà cung cấp hủy, lỗi thì ghi lại để xử lý tay.
 */
export async function cancelInvoiceForSession(sessionId: number, reason: string) {
  const row = db.prepare('SELECT * FROM invoices WHERE session_id = ?').get(sessionId) as InvoiceRow | undefined;
  if (!row || row.status === 'cancelled') return;
  if (row.status !== 'issued') {
    db.prepare("UPDATE invoices SET status = 'cancelled', error = '' WHERE id = ?").run(row.id);
    return;
  }
  const provider = PROVIDERS[row.provider as keyof typeof PROVIDERS];
  try {
    if (!provider?.cancel) throw new Error('Nhà cung cấp chưa hỗ trợ hủy tự động, hãy hủy trên trang của nhà cung cấp');
    await provider.cancel(row.invoice_no!, reason);
    db.prepare("UPDATE invoices SET status = 'cancelled', error = '' WHERE id = ?").run(row.id);
  } catch (err) {
    db.prepare('UPDATE invoices SET error = ? WHERE id = ?').run(
      `Hủy HĐĐT lỗi: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
      row.id,
    );
  }
}

/** Gửi lại các hóa đơn lỗi / còn chờ (chạy định kỳ). */
export async function retryPendingInvoices() {
  const rows = db
    .prepare("SELECT id FROM invoices WHERE status IN ('pending', 'failed') AND attempts < 10 ORDER BY id LIMIT 20")
    .all() as { id: number }[];
  for (const { id } of rows) await issueInvoice(id);
  return rows.length;
}
