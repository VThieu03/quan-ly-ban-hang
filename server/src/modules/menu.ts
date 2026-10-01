import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dataDir, db, randomToken, transaction } from '../db.ts';
import { bad, HttpError, int, str } from '../http.ts';
import { portionsByItem } from './availability.ts';
import { MAX_IMAGE_BYTES } from '../../../shared/config.ts';
import { LANGS } from '../../../shared/types.ts';
import type { LocalizedText, MenuCategory, MenuItem } from '../../../shared/types.ts';

export const uploadsDir = `${dataDir}uploads/`;
mkdirSync(uploadsDir, { recursive: true });

type MenuItemRow = {
  id: string;
  category_id: string;
  name: string;
  price: number;
  unit: string;
  image: string;
  available: number;
  featured: number;
};

export function toMenuItem(row: MenuItemRow, remaining: number | null = null): MenuItem {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: JSON.parse(row.name),
    price: row.price,
    unit: row.unit,
    image: row.image,
    available: row.available === 1,
    featured: row.featured === 1,
    remaining,
  };
}

export function findMenuItem(id: string) {
  return db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id) as MenuItemRow | undefined;
}

export function getMenu(): MenuCategory[] {
  const categories = db.prepare('SELECT id, title FROM categories ORDER BY sort').all() as {
    id: string;
    title: string;
  }[];
  const portions = portionsByItem();
  const items = (db.prepare('SELECT * FROM menu_items ORDER BY sort').all() as MenuItemRow[]).map((row) =>
    toMenuItem(row, portions.get(row.id)?.portions ?? null),
  );
  return categories.map((c) => ({
    id: c.id,
    title: JSON.parse(c.title),
    items: items.filter((i) => i.categoryId === c.id),
  }));
}

/** Tên đủ 5 ngôn ngữ; ngôn ngữ nào bỏ trống thì dùng tiếng Việt. */
function localized(value: unknown, code: string): LocalizedText {
  const input = (value ?? {}) as Partial<Record<string, unknown>>;
  const vi = str(input.vi, code, { max: 100 });
  return Object.fromEntries(
    LANGS.map((lang) => [lang, lang === 'vi' ? vi : str(input[lang], code, { max: 100, required: false }) || vi]),
  ) as LocalizedText;
}

function requireCategory(id: unknown) {
  const categoryId = str(id, 'invalid_category');
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(categoryId)) throw bad('invalid_category');
  return categoryId;
}

export function createCategory(input: { title?: unknown }) {
  const id = `c-${randomToken(4)}`;
  const { sort } = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS sort FROM categories').get() as { sort: number };
  db.prepare('INSERT INTO categories (id, title, sort) VALUES (?, ?, ?)').run(
    id,
    JSON.stringify(localized(input.title, 'invalid_title')),
    sort,
  );
  return id;
}

export function updateCategory(id: string, input: { title?: unknown }) {
  const result = db
    .prepare('UPDATE categories SET title = ? WHERE id = ?')
    .run(JSON.stringify(localized(input.title, 'invalid_title')), id);
  if (result.changes === 0) throw new HttpError(404, 'not_found');
}

export function deleteCategory(id: string) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM menu_items WHERE category_id = ?').get(id) as {
    count: number;
  };
  if (count > 0) throw new HttpError(409, 'category_not_empty');
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}

export function createMenuItem(input: Record<string, unknown>) {
  const id = `m-${randomToken(4)}`;
  const categoryId = requireCategory(input.categoryId);
  const { sort } = db
    .prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS sort FROM menu_items WHERE category_id = ?')
    .get(categoryId) as { sort: number };
  db.prepare(
    'INSERT INTO menu_items (id, category_id, name, price, unit, image, available, featured, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    categoryId,
    JSON.stringify(localized(input.name, 'invalid_name')),
    int(input.price, 'invalid_price'),
    str(input.unit, 'invalid_unit', { max: 20, required: false }) || 'Phần',
    str(input.image, 'invalid_image', { max: 300, required: false }),
    input.available === false ? 0 : 1,
    input.featured ? 1 : 0,
    sort,
  );
  return id;
}

export function updateMenuItem(id: string, patch: Record<string, unknown>) {
  const row = findMenuItem(id);
  if (!row) throw new HttpError(404, 'not_found');
  db.prepare(
    'UPDATE menu_items SET category_id = ?, name = ?, price = ?, unit = ?, image = ?, available = ?, featured = ? WHERE id = ?',
  ).run(
    patch.categoryId !== undefined ? requireCategory(patch.categoryId) : row.category_id,
    patch.name !== undefined ? JSON.stringify(localized(patch.name, 'invalid_name')) : row.name,
    patch.price !== undefined ? int(patch.price, 'invalid_price') : row.price,
    patch.unit !== undefined ? str(patch.unit, 'invalid_unit', { max: 20 }) : row.unit,
    patch.image !== undefined ? str(patch.image, 'invalid_image', { max: 300, required: false }) : row.image,
    patch.available !== undefined ? (patch.available ? 1 : 0) : row.available,
    patch.featured !== undefined ? (patch.featured ? 1 : 0) : row.featured,
    id,
  );
  // Nhân viên tự bật/tắt món thì món không còn do hệ thống quản lý "hết món" nữa.
  if (patch.available !== undefined) db.prepare('UPDATE menu_items SET auto_sold_out = 0 WHERE id = ?').run(id);
}

/** Sắp xếp lại danh mục (ids theo thứ tự mới). */
export function reorderCategories(ids: unknown) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw bad('invalid_order');
  const update = db.prepare('UPDATE categories SET sort = ? WHERE id = ?');
  transaction(() => (ids as string[]).forEach((id, i) => update.run(i, id)));
}

/** Sắp xếp lại các món trong một danh mục (ids theo thứ tự mới). */
export function reorderItems(categoryId: unknown, ids: unknown) {
  const category = requireCategory(categoryId);
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw bad('invalid_order');
  const update = db.prepare('UPDATE menu_items SET sort = ? WHERE id = ? AND category_id = ?');
  transaction(() => (ids as string[]).forEach((id, i) => update.run(i, id, category)));
}

export function deleteMenuItem(id: string) {
  transaction(() => {
    db.prepare('DELETE FROM recipes WHERE menu_item_id = ?').run(id);
    const result = db.prepare('DELETE FROM menu_items WHERE id = ?').run(id);
    if (result.changes === 0) throw new HttpError(404, 'not_found');
  });
}

const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Nhận ảnh dạng data URL (base64), lưu vào thư mục uploads, trả về đường dẫn công khai. */
export function saveImage(dataUrl: unknown): string {
  const match = typeof dataUrl === 'string' ? /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl) : null;
  const ext = match && IMAGE_TYPES[match[1]];
  if (!match || !ext) throw bad('invalid_image');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw bad('image_too_large');
  const file = `${randomToken(9)}.${ext}`;
  writeFileSync(`${uploadsDir}${file}`, bytes);
  return `/uploads/${file}`;
}

type SeedCategory = {
  id: string;
  title: LocalizedText;
  items: { id: string; name: LocalizedText; price: number; image: string }[];
};

export function seedMenu() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM categories').get() as { count: number };
  if (count > 0) return;
  const menu = JSON.parse(readFileSync(new URL('../../seed/menu.json', import.meta.url), 'utf8')) as SeedCategory[];
  const insertCategory = db.prepare('INSERT INTO categories (id, title, sort) VALUES (?, ?, ?)');
  const insertItem = db.prepare(
    'INSERT INTO menu_items (id, category_id, name, price, image, sort) VALUES (?, ?, ?, ?, ?, ?)',
  );
  transaction(() => {
    menu.forEach((category, i) => {
      insertCategory.run(category.id, JSON.stringify(category.title), i);
      category.items.forEach((item, j) => {
        insertItem.run(item.id, category.id, JSON.stringify(item.name), item.price, item.image, j);
      });
    });
  });
  console.log(`Đã tạo thực đơn mẫu (${menu.length} danh mục).`);
}
