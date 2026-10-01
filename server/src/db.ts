import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const dbPath = process.env.DB_PATH ?? fileURLToPath(new URL('../data/app.db', import.meta.url));
/** Thư mục chứa database; ảnh tải lên và bản sao lưu nằm cạnh đó. */
export const dataDir = `${dirname(dbPath)}/`;
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// Mỗi phần tử là một bước nâng cấp database. Chỉ được THÊM bước mới ở cuối, không sửa bước cũ.
const migrations: string[] = [
  // 1. Gọi món QR, bàn, đơn
  `
  CREATE TABLE IF NOT EXISTS categories (
    id    TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    sort  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS menu_items (
    id          TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES categories(id),
    name        TEXT NOT NULL,
    price       INTEGER NOT NULL,
    image       TEXT NOT NULL,
    available   INTEGER NOT NULL DEFAULT 1,
    sort        INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tables (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    name  TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id          INTEGER NOT NULL REFERENCES tables(id),
    opened_at         TEXT NOT NULL,
    closed_at         TEXT,
    bill_requested_at TEXT,
    payment_method    TEXT,
    total             INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_open_per_table
    ON sessions(table_id) WHERE closed_at IS NULL;
  CREATE TABLE IF NOT EXISTS orders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    status     TEXT NOT NULL DEFAULT 'new',
    note       TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS orders_session ON orders(session_id);
  CREATE TABLE IF NOT EXISTS order_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id     INTEGER NOT NULL REFERENCES orders(id),
    menu_item_id TEXT NOT NULL,
    name         TEXT NOT NULL,
    price        INTEGER NOT NULL,
    quantity     INTEGER NOT NULL,
    cancelled    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS order_items_order ON order_items(order_id);
  CREATE TABLE IF NOT EXISTS staff_tokens (
    token      TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );
  `,

  // 2. Nhân viên, thanh toán, khách hàng, khuyến mãi, đặt bàn, kho, máy in, hóa đơn điện tử
  `
  CREATE TABLE staff (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    role       TEXT NOT NULL,
    pin_hash   TEXT NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  DELETE FROM staff_tokens;
  ALTER TABLE staff_tokens ADD COLUMN staff_id INTEGER REFERENCES staff(id);

  CREATE TABLE timesheets (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id  INTEGER NOT NULL REFERENCES staff(id),
    clock_in  TEXT NOT NULL,
    clock_out TEXT
  );
  CREATE TABLE cash_shifts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id      INTEGER NOT NULL REFERENCES staff(id),
    opened_at     TEXT NOT NULL,
    opening_cash  INTEGER NOT NULL,
    closed_at     TEXT,
    closed_by     INTEGER REFERENCES staff(id),
    counted_cash  INTEGER,
    expected_cash INTEGER,
    note          TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE customers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    phone       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL DEFAULT '',
    points      INTEGER NOT NULL DEFAULT 0,
    total_spent INTEGER NOT NULL DEFAULT 0,
    visits      INTEGER NOT NULL DEFAULT 0,
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
  );

  CREATE TABLE promotions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    code         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name         TEXT NOT NULL,
    type         TEXT NOT NULL,
    value        INTEGER NOT NULL,
    min_subtotal INTEGER NOT NULL DEFAULT 0,
    max_discount INTEGER,
    starts_at    TEXT,
    ends_at      TEXT,
    usage_limit  INTEGER,
    used_count   INTEGER NOT NULL DEFAULT 0,
    active       INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE reservations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    phone         TEXT NOT NULL DEFAULT '',
    party_size    INTEGER NOT NULL,
    reserved_at   TEXT NOT NULL,
    table_id      INTEGER REFERENCES tables(id),
    note          TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'booked',
    created_at    TEXT NOT NULL
  );
  CREATE INDEX reservations_time ON reservations(reserved_at);

  ALTER TABLE sessions ADD COLUMN guest_count INTEGER;
  ALTER TABLE sessions ADD COLUMN opened_by INTEGER;
  ALTER TABLE sessions ADD COLUMN closed_by INTEGER;
  ALTER TABLE sessions ADD COLUMN subtotal INTEGER;
  ALTER TABLE sessions ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sessions ADD COLUMN discount_note TEXT NOT NULL DEFAULT '';
  ALTER TABLE sessions ADD COLUMN promotion_id INTEGER;
  ALTER TABLE sessions ADD COLUMN customer_id INTEGER;
  ALTER TABLE sessions ADD COLUMN points_used INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sessions ADD COLUMN points_earned INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE sessions ADD COLUMN vat_rate REAL NOT NULL DEFAULT 0;
  ALTER TABLE sessions ADD COLUMN merged_into INTEGER;
  ALTER TABLE sessions ADD COLUMN pending_payment TEXT;
  ALTER TABLE sessions ADD COLUMN reservation_id INTEGER;
  UPDATE sessions SET subtotal = total WHERE closed_at IS NOT NULL;
  CREATE INDEX sessions_closed ON sessions(closed_at);

  ALTER TABLE orders ADD COLUMN source TEXT NOT NULL DEFAULT 'customer';
  ALTER TABLE orders ADD COLUMN created_by INTEGER;
  ALTER TABLE order_items ADD COLUMN cancelled_by INTEGER;
  ALTER TABLE order_items ADD COLUMN cancel_reason TEXT NOT NULL DEFAULT '';

  ALTER TABLE menu_items ADD COLUMN unit TEXT NOT NULL DEFAULT 'Phần';
  ALTER TABLE tables ADD COLUMN area TEXT NOT NULL DEFAULT '';

  CREATE TABLE payments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id),
    method     TEXT NOT NULL,
    amount     INTEGER NOT NULL,
    reference  TEXT NOT NULL DEFAULT '',
    staff_id   INTEGER,
    created_at TEXT NOT NULL
  );
  INSERT INTO payments (session_id, method, amount, created_at)
    SELECT id, payment_method, total, closed_at FROM sessions
    WHERE closed_at IS NOT NULL AND payment_method IS NOT NULL;

  CREATE TABLE bank_transactions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_ref     TEXT NOT NULL UNIQUE,
    amount           INTEGER NOT NULL,
    content          TEXT NOT NULL,
    account_number   TEXT NOT NULL DEFAULT '',
    transaction_date TEXT NOT NULL DEFAULT '',
    session_id       INTEGER,
    created_at       TEXT NOT NULL
  );

  CREATE TABLE printers (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL,
    address      TEXT NOT NULL,
    category_ids TEXT NOT NULL DEFAULT '[]',
    active       INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE print_jobs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    printer_id INTEGER NOT NULL REFERENCES printers(id),
    content    TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending',
    attempts   INTEGER NOT NULL DEFAULT 0,
    error      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    printed_at TEXT
  );
  CREATE INDEX print_jobs_status ON print_jobs(status);

  CREATE TABLE invoices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL UNIQUE REFERENCES sessions(id),
    status      TEXT NOT NULL,
    provider    TEXT NOT NULL,
    invoice_no  TEXT,
    lookup_code TEXT,
    lookup_url  TEXT,
    buyer       TEXT,
    payload     TEXT NOT NULL,
    error       TEXT NOT NULL DEFAULT '',
    attempts    INTEGER NOT NULL DEFAULT 0,
    issued_at   TEXT,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE ingredients (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL,
    unit      TEXT NOT NULL,
    stock     REAL NOT NULL DEFAULT 0,
    min_stock REAL NOT NULL DEFAULT 0,
    cost      REAL NOT NULL DEFAULT 0,
    active    INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE recipes (
    menu_item_id  TEXT NOT NULL REFERENCES menu_items(id),
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    quantity      REAL NOT NULL,
    PRIMARY KEY (menu_item_id, ingredient_id)
  );
  CREATE TABLE suppliers (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL,
    phone   TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    note    TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE purchases (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER REFERENCES suppliers(id),
    total       INTEGER NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    staff_id    INTEGER,
    created_at  TEXT NOT NULL
  );
  CREATE TABLE stock_moves (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    qty_change    REAL NOT NULL,
    unit_cost     REAL NOT NULL DEFAULT 0,
    type          TEXT NOT NULL,
    ref_id        INTEGER,
    note          TEXT NOT NULL DEFAULT '',
    staff_id      INTEGER,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX stock_moves_created ON stock_moves(created_at);
  CREATE INDEX stock_moves_ref ON stock_moves(type, ref_id);
  `,

  // 3. Món best seller, hủy hóa đơn, banner quảng cáo
  `
  ALTER TABLE menu_items ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;

  ALTER TABLE sessions ADD COLUMN voided_at TEXT;
  ALTER TABLE sessions ADD COLUMN voided_by INTEGER;
  ALTER TABLE sessions ADD COLUMN void_reason TEXT NOT NULL DEFAULT '';

  CREATE TABLE banners (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    subtitle    TEXT NOT NULL,
    image       TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT 'none',
    target_id   TEXT,
    starts_at   TEXT,
    ends_at     TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    sort        INTEGER NOT NULL DEFAULT 0
  );
  `,

  // 4. Kho: hủy phiếu nhập, làm tròn tồn kho (tránh sai số dấu phẩy động)
  `
  ALTER TABLE purchases ADD COLUMN voided_at TEXT;
  ALTER TABLE purchases ADD COLUMN voided_by INTEGER;
  ALTER TABLE purchases ADD COLUMN void_reason TEXT NOT NULL DEFAULT '';
  UPDATE ingredients SET stock = ROUND(stock, 3);
  CREATE INDEX IF NOT EXISTS stock_moves_ingredient ON stock_moves(ingredient_id, created_at);
  `,

  // 5. Sửa phiếu nhập: lưu các dòng hiện tại của phiếu riêng (lịch sử xuất nhập vẫn giữ nguyên)
  `
  CREATE TABLE purchase_lines (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id   INTEGER NOT NULL REFERENCES purchases(id),
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    quantity      REAL NOT NULL,
    unit_cost     REAL NOT NULL
  );
  CREATE INDEX purchase_lines_purchase ON purchase_lines(purchase_id);
  INSERT INTO purchase_lines (purchase_id, ingredient_id, quantity, unit_cost)
    SELECT ref_id, ingredient_id, qty_change, unit_cost FROM stock_moves WHERE type = 'purchase' ORDER BY id;
  ALTER TABLE purchases ADD COLUMN updated_at TEXT;
  ALTER TABLE purchases ADD COLUMN updated_by INTEGER;
  `,

  // 6. Tự báo hết món khi hết nguyên liệu (đánh dấu món do hệ thống tắt, để tự bật lại khi có hàng)
  `
  ALTER TABLE menu_items ADD COLUMN auto_sold_out INTEGER NOT NULL DEFAULT 0;
  `,
];

function migrate() {
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let i = version; i < migrations.length; i++) {
    transaction(() => {
      db.exec(migrations[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    });
    console.log(`Đã nâng cấp database lên phiên bản ${i + 1}.`);
  }
}

export function transaction<T>(fn: () => T): T {
  if (db.isTransaction) return fn(); // cho phép lồng nhau: dùng chung transaction bên ngoài
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function randomToken(bytes = 6) {
  return randomBytes(bytes).toString('base64url');
}

export const now = () => new Date().toISOString();

migrate();
