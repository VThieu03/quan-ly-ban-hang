import { db, now, transaction } from '../db.ts';
import { bad, HttpError, int, oneOf, str } from '../http.ts';
import { getSettings } from '../settings.ts';
import { MAX_NOTE_LENGTH, MAX_ORDER_LINES as MAX_LINES, MAX_QUANTITY_PER_ITEM as MAX_QUANTITY } from '../../../shared/config.ts';
import { portionsByItem } from './availability.ts';
import { findMenuItem } from './menu.ts';
import { enqueueKitchenTickets } from './printing.ts';
import type { NewOrderRequest, Order, OrderStatus } from '../../../shared/types.ts';

const ORDER_STATUSES: OrderStatus[] = ['new', 'preparing', 'served', 'cancelled'];

type OrderRow = {
  id: number;
  session_id: number;
  status: OrderStatus;
  note: string;
  source: 'customer' | 'staff';
  created_at: string;
  table_id: number;
  table_name: string;
};

type OrderItemRow = {
  id: number;
  order_id: number;
  menu_item_id: string;
  name: string;
  price: number;
  quantity: number;
  cancelled: number;
  cancel_reason: string;
};

/** Lấy đơn kèm món theo điều kiện WHERE (trên bảng orders o / sessions s). */
export function queryOrders(where: string, ...params: (string | number)[]): Order[] {
  const rows = db
    .prepare(
      `SELECT o.id, o.session_id, o.status, o.note, o.source, o.created_at, t.id AS table_id, t.name AS table_name
       FROM orders o
       JOIN sessions s ON s.id = o.session_id
       JOIN tables t ON t.id = s.table_id
       WHERE ${where}
       ORDER BY o.id`,
    )
    .all(...params) as OrderRow[];
  if (rows.length === 0) return [];

  const placeholders = rows.map(() => '?').join(',');
  const itemRows = db
    .prepare(`SELECT * FROM order_items WHERE order_id IN (${placeholders}) ORDER BY id`)
    .all(...rows.map((r) => r.id)) as OrderItemRow[];

  return rows.map((row) => {
    const items = itemRows
      .filter((i) => i.order_id === row.id)
      .map((i) => ({
        id: i.id,
        menuItemId: i.menu_item_id,
        name: JSON.parse(i.name),
        price: i.price,
        quantity: i.quantity,
        cancelled: i.cancelled === 1,
        cancelReason: i.cancel_reason,
      }));
    const total =
      row.status === 'cancelled'
        ? 0
        : items.filter((i) => !i.cancelled).reduce((sum, i) => sum + i.price * i.quantity, 0);
    return {
      id: row.id,
      sessionId: row.session_id,
      tableId: row.table_id,
      tableName: row.table_name,
      status: row.status,
      note: row.note,
      source: row.source,
      createdAt: row.created_at,
      items,
      total,
    };
  });
}

/** Các đơn bếp cần làm (mới + đang chuẩn bị) của những bàn đang mở. */
export function getKitchenOrders(): Order[] {
  return queryOrders("o.status IN ('new', 'preparing') AND s.closed_at IS NULL");
}

function openSessionOf(tableId: number) {
  return db.prepare('SELECT id FROM sessions WHERE table_id = ? AND closed_at IS NULL').get(tableId) as
    | { id: number }
    | undefined;
}

/** Đơn thay đổi thì mã QR chuyển khoản đang hiện (nếu có) không còn đúng số tiền. */
export function clearPendingPayment(sessionId: number) {
  db.prepare('UPDATE sessions SET pending_payment = NULL WHERE id = ?').run(sessionId);
}

export function createOrder(
  tableId: number,
  body: NewOrderRequest,
  by: { source: 'customer' | 'staff'; staffId?: number } = { source: 'customer' },
): Order {
  const session = openSessionOf(tableId);
  if (!session) throw new HttpError(409, 'table_closed');

  if (!Array.isArray(body?.items) || body.items.length === 0 || body.items.length > MAX_LINES) {
    throw bad('invalid_items');
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE_LENGTH) : '';

  // Gộp các dòng trùng món, giá luôn lấy từ database chứ không tin client.
  const quantities = new Map<string, number>();
  for (const line of body.items) {
    if (typeof line?.menuItemId !== 'string' || !Number.isInteger(line.quantity) || line.quantity < 1) {
      throw bad('invalid_items');
    }
    quantities.set(line.menuItemId, (quantities.get(line.menuItemId) ?? 0) + line.quantity);
  }

  // Đang bật tự báo hết món: không cho gọi quá số phần nguyên liệu còn làm được.
  const portions = getSettings().inventory.autoSoldOut ? portionsByItem() : null;
  const lines = [...quantities].map(([id, quantity]) => {
    const row = findMenuItem(id);
    if (!row) throw new HttpError(400, 'invalid_items', id);
    if (row.available !== 1) throw new HttpError(409, 'item_unavailable', id);
    if (quantity > MAX_QUANTITY) throw new HttpError(400, 'invalid_items', id);
    const left = portions?.get(id);
    if (left && quantity > left.portions) throw new HttpError(409, left.portions > 0 ? 'insufficient_stock' : 'item_unavailable', id);
    return { row, quantity };
  });

  const orderId = transaction(() => {
    const result = db
      .prepare('INSERT INTO orders (session_id, note, source, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(session.id, note, by.source, by.staffId ?? null, now());
    const id = Number(result.lastInsertRowid);
    const insertItem = db.prepare(
      'INSERT INTO order_items (order_id, menu_item_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)',
    );
    for (const { row, quantity } of lines) insertItem.run(id, row.id, row.name, row.price, quantity);
    clearPendingPayment(session.id);
    return id;
  });

  const order = queryOrders('o.id = ?', orderId)[0];
  enqueueKitchenTickets(order);
  return order;
}

/** Đổi trạng thái đơn, trả về id bàn để báo cập nhật. */
export function updateOrderStatus(orderId: number, status: unknown): number {
  const next = oneOf(status, ORDER_STATUSES, 'invalid_status');
  const order = queryOrders('o.id = ? AND s.closed_at IS NULL', orderId)[0];
  if (!order) throw new HttpError(404, 'not_found');
  transaction(() => {
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(next, orderId);
    if (next === 'cancelled' || order.status === 'cancelled') clearPendingPayment(order.sessionId);
  });
  return order.tableId;
}

type ItemContext = OrderItemRow & { session_id: number; table_id: number; status: OrderStatus };

function openItem(itemId: number): ItemContext {
  const row = db
    .prepare(
      `SELECT i.*, o.session_id, o.status, s.table_id FROM order_items i
       JOIN orders o ON o.id = i.order_id
       JOIN sessions s ON s.id = o.session_id
       WHERE i.id = ? AND s.closed_at IS NULL`,
    )
    .get(itemId) as ItemContext | undefined;
  if (!row || row.cancelled === 1 || row.status === 'cancelled') throw new HttpError(404, 'not_found');
  return row;
}

/** Tách `quantity` phần ra khỏi một dòng món; trả về id dòng mới chứa phần tách ra. */
function splitItem(item: OrderItemRow, quantity: number, targetOrderId = item.order_id) {
  db.prepare('UPDATE order_items SET quantity = quantity - ? WHERE id = ?').run(quantity, item.id);
  const result = db
    .prepare('INSERT INTO order_items (order_id, menu_item_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)')
    .run(targetOrderId, item.menu_item_id, item.name, item.price, quantity);
  return Number(result.lastInsertRowid);
}

/** Hủy món (có thể hủy một phần số lượng), trả về id bàn. */
export function cancelOrderItem(itemId: number, input: { quantity?: unknown; reason?: unknown }, staffId: number) {
  const item = openItem(itemId);
  const quantity =
    input.quantity === undefined ? item.quantity : int(input.quantity, 'invalid_quantity', { min: 1, max: item.quantity });
  const reason = str(input.reason, 'invalid_reason', { max: 100, required: false });
  transaction(() => {
    const target = quantity < item.quantity ? splitItem(item, quantity) : item.id;
    db.prepare('UPDATE order_items SET cancelled = 1, cancelled_by = ?, cancel_reason = ? WHERE id = ?').run(
      staffId,
      reason,
      target,
    );
    clearPendingPayment(item.session_id);
  });
  return item.table_id;
}

/**
 * Tách món sang bàn khác (khách muốn tính riêng hoặc đổi chỗ một phần).
 * Bàn đích chưa mở sẽ được mở tự động.
 */
export function moveItems(
  fromTableId: number,
  toTableId: number,
  lines: unknown,
  staffId: number,
  openTable: (tableId: number) => void,
) {
  if (fromTableId === toTableId) throw bad('same_table');
  if (!Array.isArray(lines) || lines.length === 0) throw bad('invalid_items');
  const source = openSessionOf(fromTableId);
  if (!source) throw new HttpError(409, 'table_closed');

  transaction(() => {
    if (!openSessionOf(toTableId)) openTable(toTableId);
    const target = openSessionOf(toTableId)!;
    const newOrders = new Map<number, number>(); // đơn gốc → đơn mới ở bàn đích

    for (const line of lines as { orderItemId?: unknown; quantity?: unknown }[]) {
      const item = openItem(int(line?.orderItemId, 'invalid_items'));
      if (item.session_id !== source.id) throw bad('invalid_items');
      const quantity = int(line.quantity, 'invalid_quantity', { min: 1, max: item.quantity });

      let orderId = newOrders.get(item.order_id);
      if (!orderId) {
        const origin = db.prepare('SELECT status, note, source, created_at FROM orders WHERE id = ?').get(item.order_id) as {
          status: OrderStatus;
          note: string;
          source: string;
          created_at: string;
        };
        const result = db
          .prepare(
            'INSERT INTO orders (session_id, status, note, source, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(target.id, origin.status, origin.note, origin.source, staffId, origin.created_at);
        orderId = Number(result.lastInsertRowid);
        newOrders.set(item.order_id, orderId);
      }
      if (quantity < item.quantity) splitItem(item, quantity, orderId);
      else db.prepare('UPDATE order_items SET order_id = ? WHERE id = ?').run(orderId, item.id);
    }
    // Đơn gốc không còn món nào thì xóa cho gọn.
    db.prepare(
      'DELETE FROM orders WHERE session_id = ? AND NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = orders.id)',
    ).run(source.id);
    clearPendingPayment(source.id);
    clearPendingPayment(target.id);
  });
}
