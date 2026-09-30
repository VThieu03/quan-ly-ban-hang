import { useState } from 'react';
import { formatPrice } from '../../../shared/format.ts';
import { LANGS } from '../../../shared/types.ts';
import type { Lang, LocalizedText, MenuCategory, MenuItem } from '../../../shared/types.ts';
import { api, errorText, run } from '../api.ts';
import { useCan, useData } from '../context.ts';
import { Button, Card, Field, Input, Modal, MoneyInput, PageHeader, Select } from '../components/ui.tsx';

const LANG_LABELS: Record<Lang, string> = { vi: 'Tiếng Việt', en: 'English', ko: '한국어', zh: '中文', ja: '日本語' };
const emptyText = (): LocalizedText => ({ vi: '', en: '', ko: '', zh: '', ja: '' });

/** Thu nhỏ ảnh còn tối đa 800px, nén JPEG để tải nhanh trên điện thoại khách. */
async function resizeImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 800 / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

export function MenuPage() {
  const can = useCan();
  const [menu, reload] = useData(api.menu);
  const [costs] = useData(() => (can('inventory') || can('menu') ? api.menuCosts() : Promise.resolve({} as Record<string, number>)));
  const [editingItem, setEditingItem] = useState<{ item: MenuItem | null; categoryId: string } | null>(null);
  const [editingCategory, setEditingCategory] = useState<MenuCategory | 'new' | null>(null);

  return (
    <div className="max-w-5xl">
      <PageHeader title="Thực đơn">
        <Button variant="secondary" onClick={() => setEditingCategory('new')}>
          + Danh mục
        </Button>
      </PageHeader>
      <p className="text-gray-500 mb-4">
        Bấm công tắc để báo <b>hết món</b> — khách sẽ không gọi được. Giá vốn lấy từ định lượng trong mục Kho.
      </p>
      <div className="space-y-6">
        {menu?.map((category) => (
          <Card key={category.id}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold">{category.title.vi}</h2>
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
              {category.items.map((item) => {
                const cost = costs?.[item.id];
                return (
                  <li key={item.id} className="flex items-center gap-3 py-2">
                    <img src={item.image || undefined} alt="" className="w-14 h-14 rounded-lg object-cover bg-gray-200 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className={`font-semibold ${item.available ? '' : 'text-gray-400 line-through'}`}>{item.name.vi}</div>
                      <div className="text-sm text-gray-500 truncate">
                        {item.name.en} · {item.unit}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-red-600">{formatPrice(item.price)}</div>
                      {cost !== undefined && (
                        <div className="text-xs text-gray-500">
                          Vốn {formatPrice(cost)} · lãi {item.price ? Math.round(((item.price - cost) / item.price) * 100) : 0}%
                        </div>
                      )}
                    </div>
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
