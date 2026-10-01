import { db, transaction } from '../db.ts';
import { broadcast } from '../events.ts';
import { getSettings } from '../settings.ts';

// Số phần còn làm được của từng món theo tồn kho, và tự báo "Hết món" khi hết nguyên liệu.
// Kho chỉ bị trừ lúc thanh toán, nên lượng nguyên liệu của các món đã gọi ở bàn đang mở
// (chưa thanh toán) được coi là đã "giữ chỗ" và trừ ra trước khi tính.

export type StockInfo = { name: string; unit: string; stock: number; cost: number; reserved: number; available: number };

/** Tồn khả dụng của từng nguyên liệu = tồn kho − lượng đã gọi chưa thanh toán. */
export function availableStock(): Map<number, StockInfo> {
  const ingredients = db.prepare('SELECT id, name, unit, stock, cost FROM ingredients').all() as {
    id: number;
    name: string;
    unit: string;
    stock: number;
    cost: number;
  }[];
  const reserved = db
    .prepare(
      `SELECT r.ingredient_id, SUM(r.quantity * i.quantity) AS qty
       FROM order_items i
       JOIN orders o ON o.id = i.order_id
       JOIN sessions s ON s.id = o.session_id AND s.closed_at IS NULL
       JOIN recipes r ON r.menu_item_id = i.menu_item_id
       WHERE o.status != 'cancelled' AND i.cancelled = 0
       GROUP BY r.ingredient_id`,
    )
    .all() as { ingredient_id: number; qty: number }[];
  const reservedOf = new Map(reserved.map((r) => [r.ingredient_id, r.qty]));
  return new Map(
    ingredients.map((i) => {
      const held = reservedOf.get(i.id) ?? 0;
      return [i.id, { name: i.name, unit: i.unit, stock: i.stock, cost: i.cost, reserved: held, available: i.stock - held }];
    }),
  );
}

export type Portions = { portions: number; limitingIngredientId: number | null };

/** Số phần còn làm được của các món có khai báo định lượng (món không có định lượng thì không có trong kết quả). */
export function portionsByItem(stock = availableStock()): Map<string, Portions> {
  const lines = db.prepare('SELECT menu_item_id, ingredient_id, quantity FROM recipes').all() as {
    menu_item_id: string;
    ingredient_id: number;
    quantity: number;
  }[];
  const result = new Map<string, Portions>();
  for (const line of lines) {
    const available = stock.get(line.ingredient_id)?.available ?? 0;
    // +1e-9 để 1.0 / 0.2 không bị làm tròn thành 4.
    const portions = Math.max(0, Math.floor(available / line.quantity + 1e-9));
    const current = result.get(line.menu_item_id);
    if (!current || portions < current.portions) {
      result.set(line.menu_item_id, { portions, limitingIngredientId: line.ingredient_id });
    }
  }
  return result;
}

/**
 * Đồng bộ trạng thái "Hết món" theo tồn kho (khi bật tự báo hết món).
 * Chỉ bật lại những món do hệ thống tự tắt; món nhân viên tắt bằng tay thì giữ nguyên.
 * Trả về true nếu có món thay đổi.
 */
export function refreshAutoSoldOut(): boolean {
  const auto = getSettings().inventory.autoSoldOut;
  const items = db.prepare('SELECT id, available, auto_sold_out FROM menu_items').all() as {
    id: string;
    available: number;
    auto_sold_out: number;
  }[];
  const portions = auto ? portionsByItem() : new Map<string, Portions>();
  const disable = db.prepare('UPDATE menu_items SET available = 0, auto_sold_out = 1 WHERE id = ?');
  const enable = db.prepare('UPDATE menu_items SET available = 1, auto_sold_out = 0 WHERE id = ?');
  let changed = false;
  transaction(() => {
    for (const item of items) {
      const p = portions.get(item.id);
      if (auto && p && p.portions <= 0 && item.available === 1) {
        disable.run(item.id);
        changed = true;
      } else if (item.auto_sold_out === 1 && (!auto || !p || p.portions > 0)) {
        // Có hàng lại, tắt tính năng, hoặc món không còn định lượng → bật lại món đã tự tắt.
        enable.run(item.id);
        changed = true;
      }
    }
  });
  return changed;
}

/** Gọi sau mọi thao tác làm thay đổi tồn kho / lượng đã gọi; báo app khách tải lại thực đơn nếu có món đổi trạng thái. */
export function afterStockChange() {
  if (refreshAutoSoldOut()) broadcast({ type: 'menu' });
}
