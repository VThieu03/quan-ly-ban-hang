import { useState } from 'react';
import { formatPrice } from '../../../shared/format.ts';
import { LANGS } from '../../../shared/types.ts';
import type { Ingredient, Lang, LocalizedText, MenuCategory, MenuItem, RecipeLine } from '../../../shared/types.ts';
import { api, errorText, run } from '../api.ts';
import { useCan, useData } from '../context.ts';
import { Button, Card, Field, Input, Modal, MoneyInput, PageHeader, Select } from '../components/ui.tsx';
import { formatQty } from '../dates.ts';
import { moveItem, resizeImage } from '../images.ts';
import { RecipeDialog } from './InventoryPage.tsx';

const LANG_LABELS: Record<Lang, string> = { vi: 'Tiếng Việt', en: 'English', ko: '한국어', zh: '中文', ja: '日本語' };
const emptyText = (): LocalizedText => ({ vi: '', en: '', ko: '', zh: '', ja: '' });

/** Hai nút ▲▼ để đổi thứ tự. */
function OrderButtons({ onUp, onDown }: { onUp: (() => void) | null; onDown: (() => void) | null }) {
  const cls = 'w-7 h-7 rounded border text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <span className="flex gap-1 shrink-0">
      <button className={cls} disabled={!onUp} onClick={onUp ?? undefined} title="Lên trên" aria-label="Lên trên">
        ▲
      </button>
      <button className={cls} disabled={!onDown} onClick={onDown ?? undefined} title="Xuống dưới" aria-label="Xuống dưới">
        ▼
      </button>
    </span>
  );
}

export function MenuPage() {
  const can = useCan();
  const [menu, reload] = useData(api.menu);
  const [costs, reloadCosts] = useData(() =>
    can('inventory') || can('menu') ? api.menuCosts() : Promise.resolve({} as Record<string, number>),
  );
  // Liên kết món ↔ nguyên liệu (chỉ người có quyền Kho mới xem / sửa định lượng).
  const canStock = can('inventory');
  const [recipes, reloadRecipes] = useData(() => (canStock ? api.recipes() : Promise.resolve({} as Record<string, RecipeLine[]>)));
  const [ingredients] = useData(() => (canStock ? api.ingredients() : Promise.resolve([] as Ingredient[])));
  const [recipeFor, setRecipeFor] = useState<MenuItem | null>(null);
  const [editingItem, setEditingItem] = useState<{ item: MenuItem | null; categoryId: string } | null>(null);
  const [editingCategory, setEditingCategory] = useState<MenuCategory | 'new' | null>(null);

  const reorder = (ids: string[] | null, categoryId?: string) => {
    if (ids) run(() => api.reorderMenu(ids, categoryId)).then(reload);
  };
  const featuredCount = menu?.flatMap((c) => c.items).filter((i) => i.featured).length ?? 0;

  return (
    <div className="max-w-5xl">
      <PageHeader title="Thực đơn">
        <Button variant="secondary" onClick={() => setEditingCategory('new')}>
          + Danh mục
        </Button>
      </PageHeader>
      <p className="text-gray-500 mb-4">
        Bấm công tắc để báo <b>hết món</b> — khách sẽ không gọi được. Bấm <b>⭐</b> để đưa món vào mục <b>Best seller</b> ở đầu
        menu của khách ({featuredCount} món). Dùng ▲▼ để đổi thứ tự hiển thị. Giá vốn lấy từ định lượng trong mục Kho.
      </p>
      <div className="space-y-6">
        {menu?.map((category, ci) => (
          <Card key={category.id}>
            <div className="flex items-center justify-between mb-3 gap-2">
              <div className="flex items-center gap-3">
                <OrderButtons
                  onUp={ci > 0 ? () => reorder(moveItem(menu.map((c) => c.id), ci, -1)) : null}
                  onDown={ci < menu.length - 1 ? () => reorder(moveItem(menu.map((c) => c.id), ci, 1)) : null}
                />
                <h2 className="text-xl font-bold">{category.title.vi}</h2>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" className="text-sm" onClick={() => setEditingCategory(category)}>
                  Sửa danh mục
                </Button>
                <Button className="text-sm" onClick={() => setEditingItem({ item: null, categoryId: category.id })}>
                  + Món
                </Button>
              </div>
            </div>
            <ul className="divide-y">
              {category.items.map((item, ii) => {
                const cost = costs?.[item.id];
                const ids = category.items.map((i) => i.id);
                return (
                  <li key={item.id} className="flex items-center gap-3 py-2">
                    <OrderButtons
                      onUp={ii > 0 ? () => reorder(moveItem(ids, ii, -1), category.id) : null}
                      onDown={ii < ids.length - 1 ? () => reorder(moveItem(ids, ii, 1), category.id) : null}
                    />
                    <img src={item.image || undefined} alt="" className="w-14 h-14 rounded-lg object-cover bg-gray-200 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className={`font-semibold ${item.available ? '' : 'text-gray-400 line-through'}`}>{item.name.vi}</div>
                      <div className="text-sm text-gray-500 truncate">
                        {item.name.en} · {item.unit}
                      </div>
                      {canStock && (
                        <div className="text-xs truncate">
                          {recipes?.[item.id]?.length ? (
                            <span className="text-gray-600">
                              🥩{' '}
                              {recipes[item.id]
                                .map((l) => {
                                  const ing = ingredients?.find((x) => x.id === l.ingredientId);
                                  return `${formatQty(l.quantity)} ${ing?.unit ?? ''} ${ing?.name ?? '?'}`;
                                })
                                .join(' + ')}
                            </span>
                          ) : (
                            <span className="text-amber-700">Chưa liên kết nguyên liệu</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-red-600">{formatPrice(item.price)}</div>
                      {cost !== undefined && (
                        <div className="text-xs text-gray-500">
                          Vốn {formatPrice(cost)} · lãi {item.price ? Math.round(((item.price - cost) / item.price) * 100) : 0}%
                        </div>
                      )}
                      {item.remaining !== null && (
                        <div className={`text-xs ${item.remaining === 0 ? 'text-red-600 font-semibold' : item.remaining <= 5 ? 'text-amber-700' : 'text-gray-500'}`}>
                          {item.remaining === 0 ? 'Hết nguyên liệu' : `Còn làm được ${item.remaining} phần`}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => run(() => api.updateMenuItem(item.id, { featured: !item.featured })).then(reload)}
                      title={item.featured ? 'Bỏ khỏi Best seller' : 'Đưa vào Best seller'}
                      className={`text-2xl leading-none px-1 ${item.featured ? '' : 'grayscale opacity-30 hover:opacity-70'}`}
                    >
                      ⭐
                    </button>
                    <label className="flex items-center gap-2 cursor-pointer select-none w-24 justify-end">
                      <span className={`text-sm ${item.available ? 'text-green-700' : 'text-red-600'}`}>
                        {item.available ? 'Còn' : 'Hết'}
                      </span>
                      <input
                        type="checkbox"
                        checked={item.available}
                        onChange={(e) => run(() => api.updateMenuItem(item.id, { available: e.target.checked }))}
                        className="w-5 h-5 accent-green-600"
                      />
                    </label>
                    {canStock && (
                      <Button variant="ghost" className="text-sm px-2" onClick={() => setRecipeFor(item)}>
                        Nguyên liệu
                      </Button>
                    )}
                    <Button variant="ghost" className="text-sm px-2" onClick={() => setEditingItem({ item, categoryId: category.id })}>
                      Sửa
                    </Button>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
      {editingItem && menu && (
        <ItemDialog
          item={editingItem.item}
          categoryId={editingItem.categoryId}
          categories={menu}
          onClose={() => setEditingItem(null)}
          onSaved={() => {
            setEditingItem(null);
            reload();
          }}
        />
      )}
      {recipeFor && ingredients && (
        <RecipeDialog
          item={recipeFor}
          lines={recipes?.[recipeFor.id] ?? []}
          ingredients={ingredients}
          onClose={() => setRecipeFor(null)}
          onSaved={() => {
            setRecipeFor(null);
            reloadRecipes();
            reloadCosts();
            reload();
          }}
        />
      )}
      {editingCategory && (
        <CategoryDialog
          category={editingCategory === 'new' ? null : editingCategory}
          onClose={() => setEditingCategory(null)}
          onSaved={() => {
            setEditingCategory(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function NamesInput({ value, onChange }: { value: LocalizedText; onChange: (v: LocalizedText) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {LANGS.map((lang) => (
        <Field key={lang} label={LANG_LABELS[lang]}>
          <Input
            value={value[lang]}
            onChange={(e) => onChange({ ...value, [lang]: e.target.value })}
            placeholder={lang === 'vi' ? 'Bắt buộc' : 'Để trống = dùng tiếng Việt'}
          />
        </Field>
      ))}
    </div>
  );
}

function ItemDialog({
  item,
  categoryId,
  categories,
  onClose,
  onSaved,
}: {
  item: MenuItem | null;
  categoryId: string;
  categories: MenuCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    categoryId: item?.categoryId ?? categoryId,
    name: item?.name ?? emptyText(),
    price: item?.price ?? 0,
    unit: item?.unit ?? 'Phần',
    image: item?.image ?? '',
    available: item?.available ?? true,
    featured: item?.featured ?? false,
  });
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await api.uploadImage(await resizeImage(file));
      setForm((f) => ({ ...f, image: url }));
    } catch (err) {
      alert(errorText(err));
    }
    setUploading(false);
  };

  const save = async () => {
    const ok = await run(() => (item ? api.updateMenuItem(item.id, form) : api.createMenuItem(form)));
    if (ok) onSaved();
  };

  const remove = async () => {
    if (!item || !confirm(`Xóa món "${item.name.vi}"? (Đơn cũ vẫn giữ tên món)`)) return;
    if (await run(() => api.deleteMenuItem(item.id))) onSaved();
  };

  return (
    <Modal
      wide
      title={item ? `Sửa món: ${item.name.vi}` : 'Thêm món'}
      onClose={onClose}
      footer={
        <>
          {item && (
            <Button variant="danger" className="mr-auto" onClick={remove}>
              Xóa món
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!form.name.vi || uploading} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid md:grid-cols-[1fr_12rem] gap-4">
        <div className="space-y-3">
          <NamesInput value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <div className="grid grid-cols-3 gap-2">
            <Field label="Danh mục">
              <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title.vi}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Giá bán (đã gồm VAT)">
              <MoneyInput value={form.price} onChange={(price) => setForm({ ...form, price })} />
            </Field>
            <Field label="Đơn vị tính">
              <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            </Field>
          </div>
          <label className="flex items-center gap-2 font-semibold">
            <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} />
            ⭐ Best seller (hiện trong mục Best seller đầu menu của khách)
          </label>
        </div>
        <div className="space-y-2">
          <div className="aspect-4/3 bg-gray-100 rounded-xl overflow-hidden">
            {form.image && <img src={form.image} alt="" className="w-full h-full object-cover" />}
          </div>
          <label className="block">
            <span className="block text-center bg-gray-100 hover:bg-gray-200 rounded-lg py-2 cursor-pointer font-semibold">
              {uploading ? 'Đang tải lên...' : '📷 Chọn ảnh'}
            </span>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        </div>
      </div>
    </Modal>
  );
}

function CategoryDialog({ category, onClose, onSaved }: { category: MenuCategory | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(category?.title ?? emptyText());

  const save = async () => {
    const ok = await run(() => (category ? api.updateCategory(category.id, title) : api.createCategory(title)));
    if (ok) onSaved();
  };

  const remove = async () => {
    if (!category || !confirm(`Xóa danh mục "${category.title.vi}"?`)) return;
    if (await run(() => api.deleteCategory(category.id))) onSaved();
  };

  return (
    <Modal
      title={category ? 'Sửa danh mục' : 'Thêm danh mục'}
      onClose={onClose}
      footer={
        <>
          {category && (
            <Button variant="danger" className="mr-auto" onClick={remove}>
              Xóa
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!title.vi} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      <NamesInput value={title} onChange={setTitle} />
    </Modal>
  );
}
