import { db, now, transaction } from '../db.ts';
import { bad, HttpError, int, num, oneOf, str } from '../http.ts';
import { availableStock, portionsByItem } from './availability.ts';
import { findMenuItem } from './menu.ts';
import { getSettings } from '../settings.ts';
import type {
  DishForecast,
  Ingredient,
  IngredientForecast,
  InventoryForecast,
  Purchase,
  RecipeLine,
  StockMove,
  StockMoveType,
  Supplier,
} from '../../../shared/types.ts';

// Quy ước: số lượng làm tròn 3 chữ số thập phân (đủ tới gram / ml khi đơn vị là kg / lít),
// giá vốn làm tròn 2 chữ số. Tồn kho được cập nhật cùng lúc với việc ghi lịch sử (stock_moves).

const MAX_QTY = 1e7;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------- Nguyên liệu ----------

type IngredientRow = {
  id: number;
  name: string;
  unit: string;
  stock: number;
  min_stock: number;
  cost: number;
  active: number;
  has_history: number;
  used_in_recipes: number;
};

const toIngredient = (r: IngredientRow): Ingredient => ({
  id: r.id,
  name: r.name,
  unit: r.unit,
  stock: r.stock,
  minStock: r.min_stock,
  cost: r.cost,
  active: r.active === 1,
  hasHistory: r.has_history === 1,
  usedInRecipes: r.used_in_recipes,
});

const INGREDIENT_SELECT = `
  SELECT i.*,
    EXISTS (SELECT 1 FROM stock_moves m WHERE m.ingredient_id = i.id) AS has_history,
    (SELECT COUNT(*) FROM recipes r WHERE r.ingredient_id = i.id) AS used_in_recipes
  FROM ingredients i`;

export function listIngredients(): Ingredient[] {
  return (db.prepare(`${INGREDIENT_SELECT} ORDER BY i.active DESC, i.name`).all() as IngredientRow[]).map(toIngredient);
}

function requireIngredient(id: number) {
  const row = db.prepare(`${INGREDIENT_SELECT} WHERE i.id = ?`).get(id) as IngredientRow | undefined;
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}

function ensureUniqueName(name: string, exceptId: number | null) {
  const clash = db
    .prepare('SELECT id FROM ingredients WHERE LOWER(name) = LOWER(?) AND id IS NOT ?')
    .get(name, exceptId);
  if (clash) throw new HttpError(409, 'name_taken');
}

/** Ghi một dòng xuất nhập và cập nhật tồn kho. Luôn gọi bên trong transaction. */
function addMove(
  ingredientId: number,
  change: number,
  unitCost: number,
  type: StockMoveType,
  refId: number | null,
  note: string,
  staffId: number | null,
) {
  const qty = round3(change);
  if (qty === 0) return;
  db.prepare(
    'INSERT INTO stock_moves (ingredient_id, qty_change, unit_cost, type, ref_id, note, staff_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(ingredientId, qty, round2(unitCost), type, refId, note, staffId, now());
  db.prepare('UPDATE ingredients SET stock = ROUND(stock + ?, 3) WHERE id = ?').run(qty, ingredientId);
}

/**
 * Tạo nguyên liệu. Có thể khai báo luôn tồn đầu kỳ (hàng đang có sẵn khi bắt đầu dùng hệ thống)
 * kèm giá vốn, ghi thành dòng "Tồn đầu kỳ" thay vì phải giả làm phiếu nhập.
 */
export function createIngredient(body: Record<string, unknown>, staffId: number) {
  const name = str(body.name, 'invalid_name', { max: 80 });
  const unit = str(body.unit, 'invalid_unit', { max: 20 });
  const minStock = body.minStock !== undefined ? round3(num(body.minStock, 'invalid_min_stock', { max: MAX_QTY })) : 0;
  const openingStock = body.openingStock ? round3(num(body.openingStock, 'invalid_opening_stock', { max: MAX_QTY })) : 0;
  const cost = body.cost ? round2(num(body.cost, 'invalid_cost')) : 0;
  ensureUniqueName(name, null);
  transaction(() => {
    const result = db
      .prepare('INSERT INTO ingredients (name, unit, min_stock, cost) VALUES (?, ?, ?, ?)')
      .run(name, unit, minStock, cost);
    if (openingStock > 0) addMove(Number(result.lastInsertRowid), openingStock, cost, 'opening', null, 'Tồn đầu kỳ', staffId);
  });
}

export function updateIngredient(id: number, body: Record<string, unknown>) {
  const row = requireIngredient(id);
  const name = body.name !== undefined ? str(body.name, 'invalid_name', { max: 80 }) : row.name;
  const unit = body.unit !== undefined ? str(body.unit, 'invalid_unit', { max: 20 }) : row.unit;
  ensureUniqueName(name, id);
  // Đổi đơn vị khi đã có lịch sử (vd kg → g) sẽ làm sai toàn bộ số liệu cũ và định lượng.
  if (unit !== row.unit && row.has_history === 1) throw new HttpError(409, 'unit_locked');
  db.prepare('UPDATE ingredients SET name = ?, unit = ?, min_stock = ?, active = ? WHERE id = ?').run(
    name,
    unit,
    body.minStock !== undefined ? round3(num(body.minStock, 'invalid_min_stock', { max: MAX_QTY })) : row.min_stock,
    body.active !== undefined ? (body.active ? 1 : 0) : row.active,
    id,
  );
}

/**
 * Sửa giá vốn bằng tay (khi giá bình quân sai, hoặc nhập tồn đầu kỳ chưa có giá). Ghi một dòng lịch sử
 * "Sửa giá vốn" (số lượng 0) để biết ai sửa, từ bao nhiêu thành bao nhiêu. Chỉ ảnh hưởng các lần bán sau.
 */
export function setIngredientCosts(body: Record<string, unknown>, staffId: number) {
  if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 500) throw bad('invalid_lines');
  const lines = (body.lines as Record<string, unknown>[]).map((l) => ({
    ingredient: requireIngredient(int(l?.ingredientId, 'invalid_lines')),
    cost: round2(num(l.cost, 'invalid_cost', { max: 1e10 })),
  }));
  transaction(() => {
    for (const { ingredient, cost } of lines) {
      if (cost === ingredient.cost) continue;
      db.prepare('UPDATE ingredients SET cost = ? WHERE id = ?').run(cost, ingredient.id);
      db.prepare(
        "INSERT INTO stock_moves (ingredient_id, qty_change, unit_cost, type, ref_id, note, staff_id, created_at) VALUES (?, 0, ?, 'cost_adjust', NULL, ?, ?, ?)",
      ).run(
        ingredient.id,
        cost,
        `Sửa giá vốn: ${Math.round(ingredient.cost).toLocaleString('vi-VN')} → ${Math.round(cost).toLocaleString('vi-VN')} (tồn ${ingredient.stock} ${ingredient.unit})`,
        staffId,
        now(),
      );
    }
  });
}

/** Chỉ xóa được nguyên liệu tạo nhầm (chưa có lịch sử, chưa dùng trong định lượng); còn lại thì ngừng dùng. */
export function deleteIngredient(id: number) {
  const row = requireIngredient(id);
  if (row.has_history === 1 || row.used_in_recipes > 0) throw new HttpError(409, 'ingredient_in_use');
  db.prepare('DELETE FROM ingredients WHERE id = ?').run(id);
}

// ---------- Định lượng ----------

export function getRecipes(): Record<string, RecipeLine[]> {
  const rows = db.prepare('SELECT menu_item_id, ingredient_id, quantity FROM recipes').all() as {
    menu_item_id: string;
    ingredient_id: number;
    quantity: number;
  }[];
  const result: Record<string, RecipeLine[]> = {};
  for (const r of rows) (result[r.menu_item_id] ??= []).push({ ingredientId: r.ingredient_id, quantity: r.quantity });
  return result;
}

export function setRecipe(menuItemId: string, lines: unknown) {
  if (!findMenuItem(menuItemId)) throw new HttpError(404, 'not_found');
  if (!Array.isArray(lines)) throw bad('invalid_recipe');
  // Cùng một nguyên liệu khai báo nhiều dòng thì cộng dồn.
  const merged = new Map<number, number>();
  for (const l of lines as { ingredientId?: unknown; quantity?: unknown }[]) {
    const ingredientId = int(l?.ingredientId, 'invalid_recipe');
    requireIngredient(ingredientId);
    const quantity = num(l.quantity, 'invalid_recipe', { min: 0.001, max: 1000 });
    merged.set(ingredientId, (merged.get(ingredientId) ?? 0) + quantity);
  }
  transaction(() => {
    db.prepare('DELETE FROM recipes WHERE menu_item_id = ?').run(menuItemId);
    const insert = db.prepare('INSERT INTO recipes (menu_item_id, ingredient_id, quantity) VALUES (?, ?, ?)');
    for (const [ingredientId, quantity] of merged) insert.run(menuItemId, ingredientId, round3(quantity));
  });
}

/**
 * Lấy nguyên liệu từ thực đơn: mỗi dòng gắn một món với một nguyên liệu (tạo mới nếu chưa có tên đó,
 * có thể kèm tồn hiện có + giá vốn), đồng thời khai báo định lượng món = `quantity` nguyên liệu / 1 phần.
 */
export function linkFromMenu(body: Record<string, unknown>, staffId: number) {
  if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 300) throw bad('invalid_lines');
  const lines = (body.lines as Record<string, unknown>[]).map((l) => {
    const menuItemId = str(l?.menuItemId, 'invalid_lines', { max: 40 });
    if (!findMenuItem(menuItemId)) throw bad('invalid_lines');
    return {
      menuItemId,
      name: str(l.name, 'invalid_name', { max: 80 }),
      unit: str(l.unit, 'invalid_unit', { max: 20 }),
      quantity: round3(num(l.quantity, 'invalid_recipe', { min: 0.001, max: 1000 })),
      openingStock: l.openingStock ? round3(num(l.openingStock, 'invalid_opening_stock', { max: MAX_QTY })) : 0,
      cost: l.cost ? round2(num(l.cost, 'invalid_cost')) : 0,
      minStock: l.minStock ? round3(num(l.minStock, 'invalid_min_stock', { max: MAX_QTY })) : 0,
    };
  });

  let created = 0;
  transaction(() => {
    const findByName = db.prepare('SELECT id FROM ingredients WHERE LOWER(name) = LOWER(?)');
    const upsertRecipe = db.prepare(
      `INSERT INTO recipes (menu_item_id, ingredient_id, quantity) VALUES (?, ?, ?)
       ON CONFLICT(menu_item_id, ingredient_id) DO UPDATE SET quantity = excluded.quantity`,
    );
    for (const l of lines) {
      // Trùng tên (kể cả 2 món cùng dùng một nguyên liệu trong lần này) thì chỉ liên kết, không tạo trùng.
      let ingredient = findByName.get(l.name) as { id: number } | undefined;
      if (!ingredient) {
        const result = db
          .prepare('INSERT INTO ingredients (name, unit, min_stock, cost) VALUES (?, ?, ?, ?)')
          .run(l.name, l.unit, l.minStock, l.cost);
        ingredient = { id: Number(result.lastInsertRowid) };
        if (l.openingStock > 0) addMove(ingredient.id, l.openingStock, l.cost, 'opening', null, 'Tồn đầu kỳ', staffId);
        created++;
      }
      upsertRecipe.run(l.menuItemId, ingredient.id, l.quantity);
    }
  });
  return { created, linked: lines.length };
}

/** Giá vốn một phần của từng món theo định lượng và giá nhập bình quân. */
export function menuCosts(): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT r.menu_item_id, SUM(r.quantity * i.cost) AS cost
       FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id GROUP BY r.menu_item_id`,
    )
    .all() as { menu_item_id: string; cost: number }[];
  return Object.fromEntries(rows.map((r) => [r.menu_item_id, Math.round(r.cost)]));
}

/** Trừ kho theo các món đã bán của một lượt ngồi (giá vốn = giá bình quân lúc bán). Gọi trong transaction thanh toán. */
export function deductForSession(sessionId: number, staffId: number | null) {
  // Gộp theo nguyên liệu để mỗi nguyên liệu chỉ có một dòng xuất cho một hóa đơn.
  const usage = db
    .prepare(
      `SELECT r.ingredient_id, SUM(r.quantity * i.quantity) AS quantity, ing.cost
       FROM order_items i
       JOIN orders o ON o.id = i.order_id
       JOIN recipes r ON r.menu_item_id = i.menu_item_id
       JOIN ingredients ing ON ing.id = r.ingredient_id
       WHERE o.session_id = ? AND o.status != 'cancelled' AND i.cancelled = 0
       GROUP BY r.ingredient_id`,
    )
    .all(sessionId) as { ingredient_id: number; quantity: number; cost: number }[];
  for (const u of usage) addMove(u.ingredient_id, -u.quantity, u.cost, 'sale', sessionId, '', staffId);
}

/** Hoàn kho khi hủy hóa đơn: cộng lại đúng lượng và giá vốn đã trừ lúc bán. */
export function restoreForSession(sessionId: number, staffId: number) {
  const moves = db
    .prepare("SELECT ingredient_id, qty_change, unit_cost FROM stock_moves WHERE type = 'sale' AND ref_id = ?")
    .all(sessionId) as { ingredient_id: number; qty_change: number; unit_cost: number }[];
  for (const m of moves) addMove(m.ingredient_id, -m.qty_change, m.unit_cost, 'void', sessionId, 'Hủy hóa đơn', staffId);
}

// ---------- Dự báo: số phần còn làm được, doanh thu dự kiến từ tồn kho ----------

/**
 * Dự báo từ tồn kho khả dụng:
 *  - Từng món: số phần còn làm được, tiền bán / lãi gộp nếu bán hết số phần đó (mỗi món tính riêng).
 *  - Toàn kho: mỗi đơn vị nguyên liệu trung bình mang lại bao nhiêu doanh thu, theo tỉ lệ bán thực tế
 *    `days` ngày gần nhất (doanh thu món chia cho các nguyên liệu theo tỉ trọng giá vốn). Nguyên liệu
 *    chưa bán lần nào thì tạm tính theo giá bán các món dùng nó.
 */
export function getForecast(days = getSettings().system.forecastDays): InventoryForecast {
  const stock = availableStock();
  const portions = portionsByItem(stock);
  const costs = menuCosts();
  const menu = db.prepare('SELECT id, name, price FROM menu_items ORDER BY sort').all() as { id: string; name: string; price: number }[];
  const recipeRows = db.prepare('SELECT menu_item_id, ingredient_id, quantity FROM recipes').all() as {
    menu_item_id: string;
    ingredient_id: number;
    quantity: number;
  }[];
  const recipeOf = new Map<string, { ingredientId: number; quantity: number }[]>();
  for (const r of recipeRows) {
    const list = recipeOf.get(r.menu_item_id) ?? [];
    list.push({ ingredientId: r.ingredient_id, quantity: r.quantity });
    recipeOf.set(r.menu_item_id, list);
  }
  /** Tỉ trọng giá vốn của từng nguyên liệu trong 1 phần món (chia đều nếu chưa có giá vốn). */
  const sharesOf = (menuItemId: string) => {
    const lines = recipeOf.get(menuItemId) ?? [];
    const total = lines.reduce((s, l) => s + l.quantity * (stock.get(l.ingredientId)?.cost ?? 0), 0);
    return lines.map((l) => ({
      ...l,
      share: total > 0 ? (l.quantity * (stock.get(l.ingredientId)?.cost ?? 0)) / total : 1 / lines.length,
    }));
  };

  const dishes: DishForecast[] = menu
    .filter((m) => portions.has(m.id))
    .map((m) => {
      const p = portions.get(m.id)!;
      const cost = costs[m.id] ?? 0;
      return {
        menuItemId: m.id,
        name: JSON.parse(m.name).vi,
        price: m.price,
        cost,
        portions: p.portions,
        limitingIngredient: p.limitingIngredientId ? (stock.get(p.limitingIngredientId)?.name ?? null) : null,
        revenue: p.portions * m.price,
        profit: p.portions * (m.price - cost),
      };
    });

  // Doanh thu theo nguyên liệu từ số liệu bán thực tế.
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const sold = db
    .prepare(
      `SELECT i.menu_item_id, SUM(i.quantity) AS qty, SUM(i.quantity * i.price) AS revenue
       FROM order_items i JOIN orders o ON o.id = i.order_id JOIN sessions s ON s.id = o.session_id
       WHERE s.closed_at >= ? AND s.merged_into IS NULL AND s.voided_at IS NULL AND o.status != 'cancelled' AND i.cancelled = 0
       GROUP BY i.menu_item_id`,
    )
    .all(since) as { menu_item_id: string; qty: number; revenue: number }[];
  const attributed = new Map<number, { revenue: number; used: number }>();
  for (const s of sold) {
    for (const l of sharesOf(s.menu_item_id)) {
      const a = attributed.get(l.ingredientId) ?? { revenue: 0, used: 0 };
      a.revenue += s.revenue * l.share;
      a.used += l.quantity * s.qty;
      attributed.set(l.ingredientId, a);
    }
  }
  // Dự phòng khi chưa có số liệu bán: bình quân theo giá bán các món dùng nguyên liệu.
  const fromMenu = new Map<number, number[]>();
  for (const m of menu) {
    for (const l of sharesOf(m.id)) {
      const list = fromMenu.get(l.ingredientId) ?? [];
      list.push((m.price * l.share) / l.quantity);
      fromMenu.set(l.ingredientId, list);
    }
  }

  const ingredients: IngredientForecast[] = [];
  let untrackedValue = 0;
  for (const [id, s] of stock) {
    const available = Math.max(s.available, 0);
    const a = attributed.get(id);
    const menuRates = fromMenu.get(id);
    const basis: IngredientForecast['basis'] = a && a.used > 0 ? 'sales' : menuRates ? 'menu' : 'none';
    if (basis === 'none') {
      untrackedValue += Math.max(s.stock, 0) * s.cost;
      continue;
    }
    const revenuePerUnit =
      basis === 'sales' ? a!.revenue / a!.used : menuRates!.reduce((x, y) => x + y, 0) / menuRates!.length;
    ingredients.push({
      ingredientId: id,
      name: s.name,
      unit: s.unit,
      available: round3(available),
      stockValue: Math.round(available * s.cost),
      revenuePerUnit: Math.round(revenuePerUnit),
      expectedRevenue: Math.round(available * revenuePerUnit),
      basis,
    });
  }
  const stockValue = ingredients.reduce((s, i) => s + i.stockValue, 0);
  const expectedRevenue = ingredients.reduce((s, i) => s + i.expectedRevenue, 0);
  return {
    days,
    stockValue,
    expectedRevenue,
    expectedProfit: expectedRevenue - stockValue,
    untrackedValue: Math.round(untrackedValue),
    dishes,
    ingredients: ingredients.sort((x, y) => y.expectedRevenue - x.expectedRevenue),
  };
}

// ---------- Nhà cung cấp ----------

export function listSuppliers(): Supplier[] {
  return db.prepare('SELECT * FROM suppliers ORDER BY name').all() as Supplier[];
}

function supplierInput(body: Record<string, unknown>) {
  return [
    str(body.name, 'invalid_name', { max: 100 }),
    str(body.phone, 'invalid_phone', { max: 20, required: false }),
    str(body.address, 'invalid_address', { max: 200, required: false }),
    str(body.note, 'invalid_note', { max: 300, required: false }),
  ] as const;
}

export function createSupplier(body: Record<string, unknown>) {
  db.prepare('INSERT INTO suppliers (name, phone, address, note) VALUES (?, ?, ?, ?)').run(...supplierInput(body));
}

export function updateSupplier(id: number, body: Record<string, unknown>) {
  const result = db
    .prepare('UPDATE suppliers SET name = ?, phone = ?, address = ?, note = ? WHERE id = ?')
    .run(...supplierInput(body), id);
  if (result.changes === 0) throw new HttpError(404, 'not_found');
}

/** Xóa nhà cung cấp; phiếu nhập cũ chuyển thành "không rõ NCC". */
export function deleteSupplier(id: number) {
  transaction(() => {
    db.prepare('UPDATE purchases SET supplier_id = NULL WHERE supplier_id = ?').run(id);
    db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
  });
}

// ---------- Nhập hàng ----------

/**
 * Giá vốn bình quân gia quyền sau khi nhập thêm `qty` với giá `unitCost`.
 * Tồn âm (bán quá số ghi nhận) không có giá trị nên không đưa vào bình quân.
 */
function averageAfterIn(stock: number, cost: number, qty: number, unitCost: number) {
  const base = Math.max(stock, 0);
  return round2((base * cost + qty * unitCost) / (base + qty));
}

/** Giá vốn sau khi bỏ ra `qty` đã nhập với giá `unitCost` (hủy phiếu nhập). */
function averageAfterOut(stock: number, cost: number, qty: number, unitCost: number) {
  const remaining = stock - qty;
  if (remaining <= 0) return cost;
  return round2(Math.max(0, (stock * cost - qty * unitCost) / remaining));
}

type PurchaseLineInput = { ingredientId: number; quantity: number; unitCost: number };

/** Kiểm tra dữ liệu phiếu nhập gửi lên (dùng chung cho tạo mới và sửa). */
function parsePurchase(body: Record<string, unknown>, allowInactive: Set<number> = new Set()) {
  const supplierId = body.supplierId === null || body.supplierId === undefined ? null : int(body.supplierId, 'invalid_supplier');
  if (supplierId !== null && !db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(supplierId)) throw bad('invalid_supplier');
  if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 100) throw bad('invalid_lines');
  const lines: PurchaseLineInput[] = body.lines.map((l: { ingredientId?: unknown; quantity?: unknown; unitCost?: unknown }) => {
    const ingredient = requireIngredient(int(l?.ingredientId, 'invalid_lines'));
    // Khi sửa phiếu, nguyên liệu đã ngừng dùng nhưng vốn có trong phiếu thì vẫn giữ được.
    if (ingredient.active !== 1 && !allowInactive.has(ingredient.id)) throw new HttpError(409, 'ingredient_inactive');
    return {
      ingredientId: ingredient.id,
      quantity: round3(num(l.quantity, 'invalid_lines', { min: 0.001, max: MAX_QTY })),
      unitCost: round2(num(l.unitCost, 'invalid_lines', { max: 1e10 })),
    };
  });
  return {
    supplierId,
    note: str(body.note, 'invalid_note', { max: 300, required: false }),
    lines,
    total: Math.round(lines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0)),
  };
}

/** Ghi các dòng nhập vào kho, cập nhật giá vốn bình quân. Gọi trong transaction. */
function stockIn(purchaseId: number, lines: PurchaseLineInput[], type: StockMoveType, note: string, staffId: number) {
  for (const l of lines) {
    // Đọc lại mỗi dòng vì phiếu có thể có cùng một nguyên liệu nhiều lần.
    const current = requireIngredient(l.ingredientId);
    db.prepare('UPDATE ingredients SET cost = ? WHERE id = ?').run(
      averageAfterIn(current.stock, current.cost, l.quantity, l.unitCost),
      l.ingredientId,
    );
    addMove(l.ingredientId, l.quantity, l.unitCost, type, purchaseId, note, staffId);
  }
}

/** Trả lại các dòng đã nhập ra khỏi kho (theo thứ tự ngược), tính lại giá vốn. Gọi trong transaction. */
function stockOut(purchaseId: number, lines: PurchaseLineInput[], type: StockMoveType, note: string, staffId: number) {
  for (const l of [...lines].reverse()) {
    const current = requireIngredient(l.ingredientId);
    db.prepare('UPDATE ingredients SET cost = ? WHERE id = ?').run(
      averageAfterOut(current.stock, current.cost, l.quantity, l.unitCost),
      l.ingredientId,
    );
    addMove(l.ingredientId, -l.quantity, l.unitCost, type, purchaseId, note, staffId);
  }
}

function currentLines(purchaseId: number): PurchaseLineInput[] {
  return (
    db
      .prepare('SELECT ingredient_id, quantity, unit_cost FROM purchase_lines WHERE purchase_id = ? ORDER BY id')
      .all(purchaseId) as { ingredient_id: number; quantity: number; unit_cost: number }[]
  ).map((l) => ({ ingredientId: l.ingredient_id, quantity: l.quantity, unitCost: l.unit_cost }));
}

function saveLines(purchaseId: number, lines: PurchaseLineInput[]) {
  db.prepare('DELETE FROM purchase_lines WHERE purchase_id = ?').run(purchaseId);
  const insert = db.prepare('INSERT INTO purchase_lines (purchase_id, ingredient_id, quantity, unit_cost) VALUES (?, ?, ?, ?)');
  for (const l of lines) insert.run(purchaseId, l.ingredientId, l.quantity, l.unitCost);
}

function requireOpenPurchase(id: number) {
  const purchase = db.prepare('SELECT id, voided_at FROM purchases WHERE id = ?').get(id) as
    | { id: number; voided_at: string | null }
    | undefined;
  if (!purchase) throw new HttpError(404, 'not_found');
  if (purchase.voided_at) throw new HttpError(409, 'purchase_voided');
}

export function createPurchase(body: Record<string, unknown>, staffId: number) {
  const p = parsePurchase(body);
  transaction(() => {
    const result = db
      .prepare('INSERT INTO purchases (supplier_id, total, note, staff_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(p.supplierId, p.total, p.note, staffId, now());
    const purchaseId = Number(result.lastInsertRowid);
    saveLines(purchaseId, p.lines);
    stockIn(purchaseId, p.lines, 'purchase', '', staffId);
  });
}

/**
 * Sửa phiếu nhập nhập sai: trả lại các dòng cũ rồi ghi các dòng mới (đều ghi loại "Sửa phiếu nhập"
 * trong lịch sử, không xóa dữ liệu cũ), tính lại giá vốn bình quân. Ngày nhập giữ nguyên.
 */
export function updatePurchase(id: number, body: Record<string, unknown>, staffId: number) {
  requireOpenPurchase(id);
  const old = currentLines(id);
  const p = parsePurchase(body, new Set(old.map((l) => l.ingredientId)));
  const note = `Sửa phiếu nhập #${id}`;
  transaction(() => {
    stockOut(id, old, 'purchase_edit', note, staffId);
    stockIn(id, p.lines, 'purchase_edit', note, staffId);
    saveLines(id, p.lines);
    db.prepare('UPDATE purchases SET supplier_id = ?, note = ?, total = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(
      p.supplierId,
      p.note,
      p.total,
      now(),
      staffId,
      id,
    );
  });
}

/** Hủy phiếu nhập nhầm: trừ lại số lượng đang ghi trên phiếu và tính lại giá vốn bình quân. */
export function voidPurchase(id: number, reasonInput: unknown, staffId: number) {
  const reason = str(reasonInput, 'invalid_reason', { max: 200 });
  requireOpenPurchase(id);
  transaction(() => {
    stockOut(id, currentLines(id), 'purchase_void', `Hủy phiếu nhập #${id}: ${reason}`, staffId);
    db.prepare('UPDATE purchases SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?').run(now(), staffId, reason, id);
  });
}

export function listPurchases(startIso: string, endIso: string): Purchase[] {
  const rows = db
    .prepare(
      `SELECT p.*, s.name AS supplier_name, st.name AS staff_name, vb.name AS voided_by_name, ub.name AS updated_by_name
       FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN staff st ON st.id = p.staff_id
       LEFT JOIN staff vb ON vb.id = p.voided_by
       LEFT JOIN staff ub ON ub.id = p.updated_by
       WHERE p.created_at >= ? AND p.created_at < ? ORDER BY p.id DESC`,
    )
    .all(startIso, endIso) as {
    id: number;
    supplier_id: number | null;
    supplier_name: string | null;
    total: number;
    note: string;
    staff_name: string | null;
    created_at: string;
    voided_at: string | null;
    voided_by_name: string | null;
    void_reason: string;
    updated_at: string | null;
    updated_by_name: string | null;
  }[];
  const linesOf = db.prepare(
    `SELECT l.ingredient_id, i.name, i.unit, l.quantity, l.unit_cost FROM purchase_lines l
     JOIN ingredients i ON i.id = l.ingredient_id WHERE l.purchase_id = ? ORDER BY l.id`,
  );
  return rows.map((r) => ({
    id: r.id,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    total: r.total,
    note: r.note,
    staffName: r.staff_name,
    createdAt: r.created_at,
    lines: (
      linesOf.all(r.id) as { ingredient_id: number; name: string; unit: string; quantity: number; unit_cost: number }[]
    ).map((l) => ({
      ingredientId: l.ingredient_id,
      ingredientName: l.name,
      unit: l.unit,
      quantity: l.quantity,
      unitCost: l.unit_cost,
    })),
    voided: r.voided_at ? { at: r.voided_at, by: r.voided_by_name, reason: r.void_reason } : null,
    edited: r.updated_at ? { at: r.updated_at, by: r.updated_by_name } : null,
  }));
}

// ---------- Xuất hủy / điều chỉnh / kiểm kho ----------

export function adjustStock(body: Record<string, unknown>, staffId: number) {
  const ingredient = requireIngredient(int(body.ingredientId, 'invalid_ingredient'));
  const type = oneOf(body.type, ['adjust', 'waste'] as const, 'invalid_type');
  let change = round3(num(body.change, 'invalid_change', { min: -MAX_QTY, max: MAX_QTY }));
  if (type === 'waste') change = -Math.abs(change);
  if (change === 0) throw bad('invalid_change');
  const note = str(body.note, 'invalid_note', { max: 300, required: type === 'waste' });
  transaction(() => addMove(ingredient.id, change, ingredient.cost, type, null, note, staffId));
}

/**
 * Kiểm kho: nhập số lượng đếm thực tế, hệ thống ghi phần chênh lệch theo giá vốn hiện tại.
 * `expected` là tồn trên hệ thống lúc bắt đầu đếm: nếu trong lúc đếm có bán hàng thì vẫn tính đúng phần lệch.
 */
export function stocktake(body: Record<string, unknown>, staffId: number) {
  if (!Array.isArray(body.lines) || body.lines.length === 0) throw bad('invalid_lines');
  const note = str(body.note, 'invalid_note', { max: 300, required: false }) || 'Kiểm kho';
  transaction(() => {
    for (const l of body.lines as { ingredientId?: unknown; actual?: unknown; expected?: unknown }[]) {
      const ingredient = requireIngredient(int(l?.ingredientId, 'invalid_lines'));
      const actual = round3(num(l.actual, 'invalid_lines', { max: MAX_QTY }));
      const expected = l.expected === undefined ? ingredient.stock : round3(num(l.expected, 'invalid_lines', { min: -MAX_QTY, max: MAX_QTY }));
      addMove(ingredient.id, actual - expected, ingredient.cost, 'stocktake', null, note, staffId);
    }
  });
}

export function listMoves(startIso: string, endIso: string, filter: { ingredientId?: unknown; type?: unknown } = {}): StockMove[] {
  const where = ['m.created_at >= ?', 'm.created_at < ?'];
  const params: (string | number)[] = [startIso, endIso];
  if (filter.ingredientId !== undefined && filter.ingredientId !== '') {
    where.push('m.ingredient_id = ?');
    params.push(Number(filter.ingredientId));
  }
  if (typeof filter.type === 'string' && filter.type) {
    where.push('m.type = ?');
    params.push(filter.type);
  }
  const rows = db
    .prepare(
      `SELECT m.*, i.name AS ingredient_name, i.unit, s.name AS staff_name FROM stock_moves m
       JOIN ingredients i ON i.id = m.ingredient_id LEFT JOIN staff s ON s.id = m.staff_id
       WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT 1000`,
    )
    .all(...params) as {
    id: number;
    ingredient_id: number;
    ingredient_name: string;
    unit: string;
    qty_change: number;
    unit_cost: number;
    type: StockMoveType;
    note: string;
    staff_name: string | null;
    created_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    ingredientId: r.ingredient_id,
    ingredientName: r.ingredient_name,
    unit: r.unit,
    change: r.qty_change,
    unitCost: r.unit_cost,
    type: r.type,
    note: r.note,
    staffName: r.staff_name,
    createdAt: r.created_at,
  }));
}
