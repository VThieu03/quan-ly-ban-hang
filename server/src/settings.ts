import { db, randomToken } from './db.ts';
import { bad, int, num, oneOf, str } from './http.ts';
import {
  DEFAULT_CANCEL_REASONS,
  DEFAULT_KITCHEN_LATE_MINUTES,
  DEFAULT_LOW_STOCK_BADGE,
  DEFAULT_PORTION,
  DEFAULT_VOID_REASONS,
} from '../../shared/config.ts';
import type { Secrets, Settings } from '../../shared/types.ts';

export const DEFAULT_SETTINGS: Settings = {
  restaurant: { name: 'K-BBQ', address: '', phone: '', taxCode: '' },
  // Thuế GTGT dịch vụ ăn uống: 8% (giảm 2%) theo chính sách hiện hành — kiểm tra lại với kế toán.
  vatRate: 8,
  bank: { bin: '', accountNumber: '', accountName: '' },
  loyalty: { enabled: true, spendPerPoint: 10_000, pointValue: 1_000 },
  invoice: { provider: 'none', autoIssue: true, templateCode: '', series: '' },
  printing: { removeAccents: true, kitchenTickets: true, receiptOnCheckout: false },
  inventory: { autoSoldOut: false },
  operations: {
    defaultPortion: DEFAULT_PORTION,
    lowStockBadge: DEFAULT_LOW_STOCK_BADGE,
    kitchenLateMinutes: DEFAULT_KITCHEN_LATE_MINUTES,
    cancelReasons: DEFAULT_CANCEL_REASONS,
    voidReasons: DEFAULT_VOID_REASONS,
  },
};

function read<T>(key: string): T | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

function write(key: string, value: unknown) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}

export function getSettings(): Settings {
  const stored = read<Partial<Settings>>('settings') ?? {};
  // Gộp từng nhóm để khi thêm trường mới vẫn có giá trị mặc định.
  return {
    restaurant: { ...DEFAULT_SETTINGS.restaurant, ...stored.restaurant },
    vatRate: stored.vatRate ?? DEFAULT_SETTINGS.vatRate,
    bank: { ...DEFAULT_SETTINGS.bank, ...stored.bank },
    loyalty: { ...DEFAULT_SETTINGS.loyalty, ...stored.loyalty },
    invoice: { ...DEFAULT_SETTINGS.invoice, ...stored.invoice },
    printing: { ...DEFAULT_SETTINGS.printing, ...stored.printing },
    inventory: { ...DEFAULT_SETTINGS.inventory, ...stored.inventory },
    operations: { ...DEFAULT_SETTINGS.operations, ...stored.operations },
  };
}

/** Danh sách lý do gợi ý: bỏ dòng trống / trùng, tối đa 20 dòng, mỗi dòng 100 ký tự. */
function reasons(value: unknown): string[] {
  if (!Array.isArray(value)) throw bad('invalid_reasons');
  const list = value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
  if (list.some((v) => v.length > 100)) throw bad('invalid_reasons');
  return [...new Set(list)].slice(0, 20);
}

export function updateSettings(input: unknown): Settings {
  const body = (input ?? {}) as Partial<Settings>;
  const current = getSettings();
  const next: Settings = {
    restaurant: body.restaurant
      ? {
          name: str(body.restaurant.name, 'invalid_restaurant_name', { max: 100 }),
          address: str(body.restaurant.address, 'invalid_address', { max: 300, required: false }),
          phone: str(body.restaurant.phone, 'invalid_phone', { max: 30, required: false }),
          taxCode: str(body.restaurant.taxCode, 'invalid_tax_code', { max: 20, required: false }),
        }
      : current.restaurant,
    vatRate: body.vatRate !== undefined ? num(body.vatRate, 'invalid_vat_rate', { max: 20 }) : current.vatRate,
    bank: body.bank
      ? {
          bin: body.bank.bin ? str(body.bank.bin, 'invalid_bank_bin', { max: 6 }) : '',
          accountNumber: str(body.bank.accountNumber, 'invalid_account_number', { max: 30, required: false }),
          accountName: str(body.bank.accountName, 'invalid_account_name', { max: 100, required: false }),
        }
      : current.bank,
    loyalty: body.loyalty
      ? {
          enabled: Boolean(body.loyalty.enabled),
          spendPerPoint: int(body.loyalty.spendPerPoint, 'invalid_loyalty', { min: 1 }),
          pointValue: int(body.loyalty.pointValue, 'invalid_loyalty'),
        }
      : current.loyalty,
    invoice: body.invoice
      ? {
          provider: oneOf(body.invoice.provider, ['none', 'mock'] as const, 'invalid_invoice_provider'),
          autoIssue: Boolean(body.invoice.autoIssue),
          templateCode: str(body.invoice.templateCode, 'invalid_invoice', { max: 20, required: false }),
          series: str(body.invoice.series, 'invalid_invoice', { max: 20, required: false }),
        }
      : current.invoice,
    printing: body.printing
      ? {
          removeAccents: Boolean(body.printing.removeAccents),
          kitchenTickets: Boolean(body.printing.kitchenTickets),
          receiptOnCheckout: Boolean(body.printing.receiptOnCheckout),
        }
      : current.printing,
    inventory: body.inventory ? { autoSoldOut: Boolean(body.inventory.autoSoldOut) } : current.inventory,
    operations: body.operations
      ? {
          defaultPortion: num(body.operations.defaultPortion, 'invalid_default_portion', { min: 0.001, max: 1000 }),
          lowStockBadge: int(body.operations.lowStockBadge, 'invalid_low_stock_badge', { max: 999 }),
          kitchenLateMinutes: int(body.operations.kitchenLateMinutes, 'invalid_kitchen_late', { min: 1, max: 600 }),
          cancelReasons: reasons(body.operations.cancelReasons),
          voidReasons: reasons(body.operations.voidReasons),
        }
      : current.operations,
  };
  if (next.bank.bin && !/^\d{6}$/.test(next.bank.bin)) throw bad('invalid_bank_bin');
  write('settings', next);
  return next;
}

export function getSecrets(): Secrets {
  let secrets = read<Secrets>('secrets');
  if (!secrets) {
    secrets = { bankWebhookKey: randomToken(24), printAgentKey: randomToken(24) };
    write('secrets', secrets);
  }
  return secrets;
}

export function regenerateSecret(name: keyof Secrets): Secrets {
  const secrets = { ...getSecrets(), [name]: randomToken(24) };
  write('secrets', secrets);
  return secrets;
}
