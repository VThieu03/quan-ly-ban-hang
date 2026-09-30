import { timingSafeEqual } from 'node:crypto';
import { db, now } from '../db.ts';
import { HttpError } from '../http.ts';
import { getSecrets } from '../settings.ts';
import { checkout, computeBreakdown } from './checkout.ts';
import { TRANSFER_CODE_PATTERN } from '../../../shared/vietqr.ts';
import type { CheckoutBreakdown } from '../../../shared/types.ts';

// Webhook báo biến động số dư theo định dạng của SePay (https://sepay.vn):
// Header "Authorization: Apikey <khóa>", body JSON gồm id, transferType, transferAmount, content, ...

type SepayPayload = {
  id?: number | string;
  transferType?: string;
  transferAmount?: number;
  content?: string;
  accountNumber?: string;
  transactionDate?: string;
  referenceCode?: string;
};

export type BankMatch =
  | { status: 'ignored' | 'duplicate' | 'unmatched' }
  | { status: 'paid' | 'amount_mismatch'; tableId: number; sessionId: number; amount: number };

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyWebhookKey(header: string | undefined) {
  const key = header?.replace(/^Apikey\s+/i, '') ?? '';
  if (!safeEqual(key, getSecrets().bankWebhookKey)) throw new HttpError(401, 'unauthorized');
}

export async function handleBankTransaction(body: SepayPayload): Promise<BankMatch> {
  if (body.transferType !== 'in' || !body.id || !Number.isFinite(body.transferAmount)) return { status: 'ignored' };
  const amount = Math.round(body.transferAmount!);
  const content = String(body.content ?? '');

  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO bank_transactions (provider_ref, amount, content, account_number, transaction_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(String(body.id), amount, content, String(body.accountNumber ?? ''), String(body.transactionDate ?? ''), now());
  if (inserted.changes === 0) return { status: 'duplicate' }; // ngân hàng/SePay gửi lại cùng giao dịch

  const match = TRANSFER_CODE_PATTERN.exec(content.replace(/\s+/g, ' '));
  const sessionId = match ? Number(match[1]) : null;
  const open = sessionId
    ? (db.prepare('SELECT table_id, pending_payment FROM sessions WHERE id = ? AND closed_at IS NULL').get(sessionId) as
        | { table_id: number; pending_payment: string | null }
        | undefined)
    : undefined;
  if (!sessionId || !open) return { status: 'unmatched' };
  db.prepare('UPDATE bank_transactions SET session_id = ? WHERE provider_ref = ?').run(sessionId, String(body.id));

  // Dùng đúng yêu cầu thanh toán lúc hiện mã QR (giảm giá, điểm...); nếu khách quét mã in trên bill tạm tính thì tính mặc định.
  const pending = open.pending_payment ? (JSON.parse(open.pending_payment) as CheckoutBreakdown) : null;
  const request = pending?.request ?? { paymentMethod: 'transfer' as const };
  const expected = computeBreakdown(open.table_id, { ...request, paymentMethod: 'transfer' }).total;
  if (amount < expected) return { status: 'amount_mismatch', tableId: open.table_id, sessionId, amount };

  await checkout(open.table_id, { ...request, paymentMethod: 'transfer' }, null, String(body.referenceCode ?? body.id));
  return { status: 'paid', tableId: open.table_id, sessionId, amount };
}

export function recentBankTransactions() {
  return db
    .prepare(
      `SELECT b.id, b.amount, b.content, b.transaction_date AS transactionDate, b.created_at AS createdAt,
              b.session_id AS sessionId, t.name AS tableName
       FROM bank_transactions b LEFT JOIN sessions s ON s.id = b.session_id LEFT JOIN tables t ON t.id = s.table_id
       ORDER BY b.id DESC LIMIT 50`,
    )
    .all();
}
