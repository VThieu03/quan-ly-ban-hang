import { db, now, transaction } from '../db.ts';
import { bad, HttpError, int, num, oneOf, str } from '../http.ts';
import { findMenuItem } from './menu.ts';
import type {
  Ingredient,
  Purchase,
  RecipeLine,
  StockMove,
  StockMoveType,
  Supplier,
} from '../../../shared/types.ts';

// ---------- Nguyên liệu ----------

type IngredientRow = { id: number; name: string; unit: string; stock: number; min_stock: number; cost: number; active: number };

const toIngredient = (r: IngredientRow): Ingredient => ({
  id: r.id,
  name: r.name,
  unit: r.unit,
  stock: r.stock,
  minStock: r.min_stock,
  cost: r.cost,
  active: r.active === 1,
});

export function listIngredients(): Ingredient[] {
  return (db.prepare('SELECT * FROM ingredients ORDER BY active DESC, name').all() as IngredientRow[]).map(toIngredient);
}

function requireIngredient(id: number) {
  const row = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id) as IngredientRow | undefined;
  if (!row) throw new HttpError(404, 'not_found');
  return row;
}

export function createIngredient(body: Record<string, unknown>) {
  db.prepare('INSERT INTO ingredients (name, unit, min_stock, cost) VALUES (?, ?, ?, ?)').run(
    str(body.name, 'invalid_name', { max: 80 }),
    str(body.unit, 'invalid_unit', { max: 20 }),
    body.minStock !== undefined ? num(body.minStock, 'invalid_min_stock') : 0,
    body.cost !== undefined ? num(body.cost, 'invalid_cost') : 0,
  );
}

export function updateIngredient(id: number, body: Record<string, unknown>) {
  const row = requireIngredient(id);
  db.prepare('UPDATE ingredients SET name = ?, unit = ?, min_stock = ?, active = ? WHERE id = ?').run(
    body.name !== undefined ? str(body.name, 'invalid_name', { max: 80 }) : row.name,
    body.unit !== undefined ? str(body.unit, 'invalid_unit', { max: 20 }) : row.unit,
    body.minStock !== undefined ? num(body.minStock, 'invalid_min_stock') : row.min_stock,
    body.active !== undefined ? (body.active ? 1 : 0) : row.active,
    id,
  );
}

function addMove(
  ingredientId: number,
  change: number,
  unitCost: number,
  type: StockMoveType,
  refId: number | null,
  note: string,
  staffId: number | null,
) {
  db.prepare(
    'INSERT INTO stock_moves (ingredient_id, qty_change, unit_cost, type, ref_id, note, staff_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(ingredientId, change, unitCost, type, refId, note, staffId, now());
  db.prepare('UPDATE ingredients SET stock = stock + ? WHERE id = ?').run(change, ingredientId);
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
  const parsed = lines.map((l: { ingredientId?: unknown; quantity?: unknown }) => {
    const ingredientId = int(l?.ingredientId, 'invalid_recipe');
    requireIngredient(ingredientId);
    return { ingredientId, quantity: num(l.quantity, 'invalid_recipe', { min: 0.0001 }) };
  });
  transaction(() => {
    db.prepare('DELETE FROM recipes WHERE menu_item_id = ?').run(menuItemId);
    const insert = db.prepare('INSERT INTO recipes (menu_item_id, ingredient_id, quantity) VALUES (?, ?, ?)');
    for (const l of parsed) insert.run(menuItemId, l.ingredientId, l.quantity);
  });
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

/** Trừ kho theo các món đã bán của một lượt ngồi. Gọi trong transaction thanh toán. */
export function deductForSession(sessionId: number, staffId: number | null) {
  const sold = db
    .prepare(
      `SELECT i.menu_item_id, SUM(i.quantity) AS quantity FROM order_items i
       JOIN orders o ON o.id = i.order_id
       WHERE o.session_id = ? AND o.status != 'cancelled' AND i.cancelled = 0
       GROUP BY i.menu_item_id`,
    )
    .all(sessionId) as { menu_item_id: string; quantity: number }[];
  const recipeOf = db.prepare(
    'SELECT r.ingredient_id, r.quantity, i.cost FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id WHERE r.menu_item_id = ?',
  );
  for (const item of sold) {
    for (const line of recipeOf.all(item.menu_item_id) as { ingredient_id: number; quantity: number; cost: number }[]) {
      addMove(line.ingredient_id, -line.quantity * item.quantity, line.cost, 'sale', sessionId, '', staffId);
    }
  }
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

// ---------- Nhập hàng ----------

export function createPurchase(body: Record<string, unknown>, staffId: number) {
  const supplierId = body.supplierId === null || body.supplierId === undefined ? null : int(body.supplierId, 'invalid_supplier');
  if (supplierId !== null && !db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(supplierId)) throw bad('invalid_supplier');
  if (!Array.isArray(body.lines) || body.lines.length === 0) throw bad('invalid_lines');
  const lines = body.lines.map((l: { ingredientId?: unknown; quantity?: unknown; unitCost?: unknown }) => ({
    ingredient: requireIngredient(int(l?.ingredientId, 'invalid_lines')),
    quantity: num(l.quantity, 'invalid_lines', { min: 0.0001 }),
    unitCost: num(l.unitCost, 'invalid_lines'),
  }));
  const total = Math.round(lines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0));

  transaction(() => {
    const result = db
      .prepare('INSERT INTO purchases (supplier_id, total, note, staff_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(supplierId, total, str(body.note, 'invalid_note', { max: 300, required: false }), staffId, now());
    const purchaseId = Number(result.lastInsertRowid);
    for (const l of lines) {
      const current = requireIngredient(l.ingredient.id);
      // Giá vốn bình quân gia quyền; tồn âm/0 thì lấy luôn giá nhập mới.
      const stock = Math.max(current.stock, 0);
      const cost = (stock * current.cost + l.quantity * l.unitCost) / (stock + l.quantity);
      db.prepare('UPDATE ingredients SET cost = ? WHERE id = ?').run(cost, l.ingredient.id);
      addMove(l.ingredient.id, l.quantity, l.unitCost, 'purchase', purchaseId, '', staffId);
    }
  });
}

export function listPurchases(startIso: string, endIso: string): Purchase[] {
  const rows = db
    .prepare(
      `SELECT p.*, s.name AS supplier_name, st.name AS staff_name FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN staff st ON st.id = p.staff_id
       WHERE p.created_at >= ? AND p.created_at < ? ORDER BY p.id DESC`,
    )
    .all(startIso, endIso) as {
    id: number;
    supplier_name: string | null;
    total: number;
    note: string;
    staff_name: string | null;
    created_at: string;
  }[];
  const linesOf = db.prepare(
    `SELECT i.name, i.unit, m.qty_change, m.unit_cost FROM stock_moves m JOIN ingredients i ON i.id = m.ingredient_id
     WHERE m.type = 'purchase' AND m.ref_id = ?`,
  );
  return rows.map((r) => ({
    id: r.id,
    supplierName: r.supplier_name,
    total: r.total,
    note: r.note,
    staffName: r.staff_name,
    createdAt: r.created_at,
    lines: (linesOf.all(r.id) as { name: string; unit: string; qty_change: number; unit_cost: number }[]).map((l) => ({
      ingredientName: l.name,
      unit: l.unit,
      quantity: l.qty_change,
      unitCost: l.unit_cost,
    })),
  }));
}

// ---------- Xuất hủy / điều chỉnh / kiểm kho ----------

export function adjustStock(body: Record<string, unknown>, staffId: number) {
  const ingredient = requireIngredient(int(body.ingredientId, 'invalid_ingredient'));
  const type = oneOf(body.type, ['adjust', 'waste'] as const, 'invalid_type');
  let change = num(body.change, 'invalid_change', { min: -1e9, max: 1e9 });
  if (type === 'waste') change = -Math.abs(change);
  if (change === 0) throw bad('invalid_change');
  addMove(ingredient.id, change, ingredient.cost, type, null, str(body.note, 'invalid_note', { max: 300, required: false }), staffId);
}

/** Kiểm kho: nhập số lượng thực tế, hệ thống ghi phần chênh lệch. */
export function stocktake(body: Record<string, unknown>, staffId: number) {
  if (!Array.isArray(body.lines) || body.lines.length === 0) throw bad('invalid_lines');
  const note = str(body.note, 'invalid_note', { max: 300, required: false });
  transaction(() => {
    for (const l of body.lines as { ingredientId?: unknown; actual?: unknown }[]) {
      const ingredient = requireIngredient(int(l?.ingredientId, 'invalid_lines'));
      const actual = num(l.actual, 'invalid_lines');
      const change = actual - ingredient.stock;
      if (Math.abs(change) > 1e-9) addMove(ingredient.id, change, ingredient.cost, 'stocktake', null, note, staffId);
    }
  });
}

export function listMoves(startIso: string, endIso: string): StockMove[] {
  const rows = db
    .prepare(
      `SELECT m.*, i.name AS ingredient_name, i.unit, s.name AS staff_name FROM stock_moves m
       JOIN ingredients i ON i.id = m.ingredient_id LEFT JOIN staff s ON s.id = m.staff_id
       WHERE m.created_at >= ? AND m.created_at < ? ORDER BY m.id DESC LIMIT 500`,
    )
    .all(startIso, endIso) as {
    id: number;
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
