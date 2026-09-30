import { useState } from 'react';
import { formatPrice } from '../../../shared/format.ts';
import type { Ingredient, RecipeLine, StockMoveType, Supplier } from '../../../shared/types.ts';
import { api, run } from '../api.ts';
import { useData } from '../context.ts';
import { Badge, Button, DateRange, Empty, Field, Input, Modal, MoneyInput, PageHeader, Select, Table, Tabs, Textarea } from '../components/ui.tsx';
import { formatDateTime, formatQty, useDateRange } from '../dates.ts';

type Tab = 'stock' | 'recipes' | 'purchases' | 'moves' | 'stocktake' | 'suppliers';

const MOVE_LABELS: Record<StockMoveType, string> = {
  purchase: 'Nhập hàng',
  sale: 'Bán',
  adjust: 'Điều chỉnh',
  waste: 'Xuất hủy',
  stocktake: 'Kiểm kho',
};

export function InventoryPage() {
  const [tab, setTab] = useState<Tab>('stock');
  return (
    <div>
      <PageHeader title="Kho nguyên liệu" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'stock', label: 'Tồn kho' },
          { id: 'recipes', label: 'Định lượng món' },
          { id: 'purchases', label: 'Nhập hàng' },
          { id: 'moves', label: 'Lịch sử xuất nhập' },
          { id: 'stocktake', label: 'Kiểm kho' },
          { id: 'suppliers', label: 'Nhà cung cấp' },
        ]}
      />
      {tab === 'stock' && <StockTab />}
      {tab === 'recipes' && <RecipesTab />}
      {tab === 'purchases' && <PurchasesTab />}
      {tab === 'moves' && <MovesTab />}
      {tab === 'stocktake' && <StocktakeTab />}
      {tab === 'suppliers' && <SuppliersTab />}
    </div>
  );
}

// ---------- Tồn kho ----------

function StockTab() {
  const [ingredients, reload] = useData(api.ingredients);
  const [editing, setEditing] = useState<Ingredient | 'new' | null>(null);
  const [adjusting, setAdjusting] = useState<Ingredient | null>(null);
  const low = (ingredients ?? []).filter((i) => i.active && i.stock <= i.minStock);
  const value = (ingredients ?? []).reduce((sum, i) => sum + Math.max(i.stock, 0) * i.cost, 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-gray-600">
          Giá trị tồn kho: <b>{formatPrice(Math.round(value))}</b>
          {low.length > 0 && <span className="text-red-600"> · {low.length} nguyên liệu sắp hết</span>}
        </p>
        <Button onClick={() => setEditing('new')}>+ Nguyên liệu</Button>
      </div>
      <Table head={['Nguyên liệu', 'Tồn', 'Tối thiểu', 'Giá vốn / ĐV', 'Giá trị', '']}>
        {ingredients?.map((i) => (
          <tr key={i.id} className={i.active ? '' : 'opacity-50'}>
            <td className="px-3 py-2 font-semibold">
              {i.name} {i.active && i.stock <= i.minStock && <Badge color="red">Sắp hết</Badge>}
            </td>
            <td className={`px-3 py-2 ${i.stock < 0 ? 'text-red-600 font-bold' : ''}`}>
              {formatQty(i.stock)} {i.unit}
            </td>
            <td className="px-3 py-2">
              {formatQty(i.minStock)} {i.unit}
            </td>
            <td className="px-3 py-2">{formatPrice(Math.round(i.cost))}</td>
            <td className="px-3 py-2">{formatPrice(Math.round(Math.max(i.stock, 0) * i.cost))}</td>
            <td className="px-3 py-2 whitespace-nowrap">
              <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => setAdjusting(i)}>
                Xuất hủy / chỉnh
              </Button>
              <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => setEditing(i)}>
                Sửa
              </Button>
            </td>
          </tr>
        ))}
      </Table>
      {editing && (
        <IngredientDialog
          ingredient={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {adjusting && (
        <AdjustDialog
          ingredient={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={() => {
            setAdjusting(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function IngredientDialog({ ingredient, onClose, onSaved }: { ingredient: Ingredient | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: ingredient?.name ?? '',
    unit: ingredient?.unit ?? 'kg',
    minStock: ingredient?.minStock ?? 0,
    active: ingredient?.active ?? true,
  });
  const save = async () => {
    const ok = await run(() => (ingredient ? api.updateIngredient(ingredient.id, form) : api.createIngredient(form)));
    if (ok) onSaved();
  };
  return (
    <Modal
      title={ingredient ? `Sửa ${ingredient.name}` : 'Thêm nguyên liệu'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!form.name || !form.unit} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      <Field label="Tên">
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Đơn vị (kg, lít, gói...)">
          <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        </Field>
        <Field label="Tồn tối thiểu (cảnh báo)">
          <Input type="number" min={0} step="any" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: Number(e.target.value) })} />
        </Field>
      </div>
      {ingredient && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Đang dùng
        </label>
      )}
      {!ingredient && <p className="text-sm text-gray-500">Tồn kho và giá vốn sẽ được cập nhật khi nhập hàng.</p>}
    </Modal>
  );
}

function AdjustDialog({ ingredient, onClose, onSaved }: { ingredient: Ingredient; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<'waste' | 'adjust'>('waste');
  const [change, setChange] = useState('');
  const [note, setNote] = useState('');
  const save = async () => {
    const ok = await run(() => api.adjustStock({ ingredientId: ingredient.id, type, change: Number(change), note }));
    if (ok) onSaved();
  };
  return (
    <Modal
      title={`${ingredient.name} · tồn ${formatQty(ingredient.stock)} ${ingredient.unit}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!Number(change)} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        {(['waste', 'adjust'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`py-2 rounded-lg border-2 font-semibold ${type === t ? 'border-red-600 bg-red-50 text-red-700' : ''}`}
          >
            {t === 'waste' ? 'Xuất hủy (hư, hỏng)' : 'Điều chỉnh (+/−)'}
          </button>
        ))}
      </div>
      <Field label={type === 'waste' ? `Số lượng hủy (${ingredient.unit})` : `Số lượng thay đổi, âm để giảm (${ingredient.unit})`}>
        <Input type="number" step="any" value={change} onChange={(e) => setChange(e.target.value)} />
      </Field>
      <Field label="Lý do">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

// ---------- Định lượng ----------

function RecipesTab() {
  const [menu] = useData(api.menu);
  const [ingredients] = useData(api.ingredients);
  const [recipes, reload] = useData(api.recipes);
  const [costs, reloadCosts] = useData(api.menuCosts);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const nameOf = (id: number) => ingredients?.find((i) => i.id === id);

  return (
    <div>
      <p className="text-gray-600 mb-3">
        Khai báo mỗi phần món dùng bao nhiêu nguyên liệu. Khi thanh toán, kho được trừ tự động và báo cáo tính được lợi nhuận.
      </p>
      <Table head={['Món', 'Định lượng / 1 phần', 'Giá vốn', 'Giá bán', 'Lãi gộp', '']}>
        {menu?.flatMap((c) =>
          c.items.map((item) => {
            const lines = recipes?.[item.id] ?? [];
            const cost = costs?.[item.id];
            return (
              <tr key={item.id}>
                <td className="px-3 py-2 font-semibold">{item.name.vi}</td>
                <td className="px-3 py-2 text-sm">
                  {lines.length === 0 ? (
                    <span className="text-gray-400">Chưa khai báo</span>
                  ) : (
                    lines.map((l) => `${formatQty(l.quantity)} ${nameOf(l.ingredientId)?.unit ?? ''} ${nameOf(l.ingredientId)?.name ?? '?'}`).join(', ')
                  )}
                </td>
                <td className="px-3 py-2">{cost !== undefined ? formatPrice(cost) : '—'}</td>
                <td className="px-3 py-2">{formatPrice(item.price)}</td>
                <td className="px-3 py-2">{cost !== undefined && item.price ? `${Math.round(((item.price - cost) / item.price) * 100)}%` : '—'}</td>
                <td className="px-3 py-2">
                  <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => setEditing({ id: item.id, name: item.name.vi })}>
                    Sửa
                  </Button>
                </td>
              </tr>
            );
          }),
        )}
      </Table>
      {editing && ingredients && (
        <RecipeDialog
          item={editing}
          lines={recipes?.[editing.id] ?? []}
          ingredients={ingredients.filter((i) => i.active)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
            reloadCosts();
          }}
        />
      )}
    </div>
  );
}

function RecipeDialog({
  item,
  lines: initial,
  ingredients,
  onClose,
  onSaved,
}: {
  item: { id: string; name: string };
  lines: RecipeLine[];
  ingredients: Ingredient[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [lines, setLines] = useState<RecipeLine[]>(initial.length ? initial : [{ ingredientId: 0, quantity: 0 }]);
  const valid = lines.filter((l) => l.ingredientId && l.quantity > 0);
  const save = async () => {
    if (await run(() => api.setRecipe(item.id, valid))) onSaved();
  };
  return (
    <Modal
      title={`Định lượng: ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={save}>Lưu</Button>
        </>
      }
    >
      {ingredients.length === 0 && <p className="text-amber-700">Chưa có nguyên liệu. Thêm ở tab Tồn kho trước.</p>}
      {lines.map((line, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Select
            value={line.ingredientId || ''}
            onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, ingredientId: Number(e.target.value) } : l)))}
          >
            <option value="">— Nguyên liệu —</option>
            {ingredients.map((ing) => (
              <option key={ing.id} value={ing.id}>
                {ing.name} ({ing.unit})
              </option>
            ))}
          </Select>
          <Input
            type="number"
            step="any"
            min={0}
            className="w-28"
            value={line.quantity || ''}
            placeholder="SL"
            onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, quantity: Number(e.target.value) } : l)))}
          />
          <button className="text-red-600 text-xl px-2" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <Button variant="secondary" onClick={() => setLines([...lines, { ingredientId: 0, quantity: 0 }])}>
        + Thêm nguyên liệu
      </Button>
    </Modal>
  );
}

// ---------- Nhập hàng ----------

function PurchasesTab() {
  const [range, setRange] = useDateRange(30);
  const [purchases, reload] = useData(() => api.purchases(range.from, range.to), [range.from, range.to]);
  const [creating, setCreating] = useState(false);
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <DateRange value={range} onChange={setRange} />
        <Button onClick={() => setCreating(true)}>+ Phiếu nhập</Button>
      </div>
      {purchases && purchases.length === 0 && <Empty>Chưa có phiếu nhập.</Empty>}
      <div className="space-y-3">
        {purchases?.map((p) => (
          <div key={p.id} className="bg-white border rounded-xl p-3">
            <div className="flex justify-between flex-wrap gap-2">
              <span className="font-bold">
                Phiếu #{p.id} · {formatDateTime(p.createdAt)} · {p.supplierName ?? 'Không rõ NCC'}
              </span>
              <span className="font-bold text-red-600">{formatPrice(p.total)}</span>
            </div>
            <div className="text-sm text-gray-600">
              {p.lines.map((l) => `${formatQty(l.quantity)} ${l.unit} ${l.ingredientName} × ${formatPrice(Math.round(l.unitCost))}`).join(' · ')}
            </div>
            {(p.note || p.staffName) && (
              <div className="text-xs text-gray-500">
                {p.staffName} {p.note && `· ${p.note}`}
              </div>
            )}
          </div>
        ))}
      </div>
      {creating && (
        <PurchaseDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

function PurchaseDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [ingredients] = useData(api.ingredients);
  const [suppliers] = useData(api.suppliers);
  const [supplierId, setSupplierId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([{ ingredientId: 0, quantity: 0, unitCost: 0 }]);
  const valid = lines.filter((l) => l.ingredientId && l.quantity > 0);
  const total = valid.reduce((sum, l) => sum + l.quantity * l.unitCost, 0);
  const update = (i: number, patch: Partial<(typeof lines)[number]>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async () => {
    const ok = await run(() => api.createPurchase({ supplierId: supplierId ? Number(supplierId) : null, note, lines: valid }));
    if (ok) onSaved();
  };

  return (
    <Modal
      wide
      title="Phiếu nhập hàng"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center font-bold text-lg">Tổng: {formatPrice(Math.round(total))}</span>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={valid.length === 0} onClick={save}>
            Lưu phiếu nhập
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nhà cung cấp">
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">— Không chọn —</option>
            {suppliers?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ghi chú">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Số hóa đơn NCC..." />
        </Field>
      </div>
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_7rem_9rem_8rem_2rem] gap-2 text-sm font-semibold text-gray-600">
          <span>Nguyên liệu</span>
          <span>Số lượng</span>
          <span>Đơn giá</span>
          <span className="text-right">Thành tiền</span>
          <span />
        </div>
        {lines.map((line, i) => {
          const ing = ingredients?.find((x) => x.id === line.ingredientId);
          return (
            <div key={i} className="grid grid-cols-[1fr_7rem_9rem_8rem_2rem] gap-2 items-center">
              <Select value={line.ingredientId || ''} onChange={(e) => update(i, { ingredientId: Number(e.target.value) })}>
                <option value="">— Chọn —</option>
                {ingredients
                  ?.filter((x) => x.active)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} ({x.unit})
                    </option>
                  ))}
              </Select>
              <Input
                type="number"
                step="any"
                min={0}
                value={line.quantity || ''}
                placeholder={ing?.unit}
                onChange={(e) => update(i, { quantity: Number(e.target.value) })}
              />
              <MoneyInput value={line.unitCost} onChange={(unitCost) => update(i, { unitCost })} />
              <span className="text-right">{formatPrice(Math.round(line.quantity * line.unitCost))}</span>
              <button className="text-red-600 text-xl" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          );
        })}
        <Button variant="secondary" onClick={() => setLines([...lines, { ingredientId: 0, quantity: 0, unitCost: 0 }])}>
          + Dòng
        </Button>
      </div>
    </Modal>
  );
}

// ---------- Lịch sử ----------

function MovesTab() {
  const [range, setRange] = useDateRange(7);
  const [moves] = useData(() => api.stockMoves(range.from, range.to), [range.from, range.to]);
  return (
    <div>
      <div className="mb-3">
        <DateRange value={range} onChange={setRange} />
      </div>
      <Table head={['Thời gian', 'Nguyên liệu', 'Loại', 'Thay đổi', 'Đơn giá', 'Người làm', 'Ghi chú']}>
        {moves?.map((m) => (
          <tr key={m.id}>
            <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(m.createdAt)}</td>
            <td className="px-3 py-2">{m.ingredientName}</td>
            <td className="px-3 py-2">{MOVE_LABELS[m.type]}</td>
            <td className={`px-3 py-2 font-semibold ${m.change < 0 ? 'text-red-600' : 'text-green-700'}`}>
              {m.change > 0 ? '+' : ''}
              {formatQty(m.change)} {m.unit}
            </td>
            <td className="px-3 py-2">{formatPrice(Math.round(m.unitCost))}</td>
            <td className="px-3 py-2">{m.staffName ?? ''}</td>
            <td className="px-3 py-2 text-gray-600">{m.note}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ---------- Kiểm kho ----------

function StocktakeTab() {
  const [ingredients, reload] = useData(api.ingredients);
  const [actual, setActual] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');
  const changed = Object.entries(actual).filter(([, v]) => v !== '');

  const save = async () => {
    const ok = await run(() =>
      api.stocktake({ note, lines: changed.map(([id, v]) => ({ ingredientId: Number(id), actual: Number(v) })) }),
    );
    if (ok) {
      setActual({});
      setNote('');
      reload();
      alert('Đã lưu kết quả kiểm kho.');
    }
  };

  return (
    <div className="max-w-3xl">
      <p className="text-gray-600 mb-3">Nhập số lượng đếm thực tế. Để trống những dòng không kiểm.</p>
      <Table head={['Nguyên liệu', 'Trên hệ thống', 'Thực tế', 'Chênh lệch']}>
        {ingredients
          ?.filter((i) => i.active)
          .map((i) => {
            const value = actual[i.id] ?? '';
            const diff = value === '' ? null : Number(value) - i.stock;
            return (
              <tr key={i.id}>
                <td className="px-3 py-2">{i.name}</td>
                <td className="px-3 py-2">
                  {formatQty(i.stock)} {i.unit}
                </td>
                <td className="px-3 py-2">
                  <Input
                    type="number"
                    step="any"
                    min={0}
                    className="w-32"
                    value={value}
                    onChange={(e) => setActual({ ...actual, [i.id]: e.target.value })}
                  />
                </td>
                <td className={`px-3 py-2 ${diff === null ? '' : diff < 0 ? 'text-red-600' : 'text-green-700'}`}>
                  {diff === null ? '' : `${diff > 0 ? '+' : ''}${formatQty(diff)} ${i.unit}`}
                </td>
              </tr>
            );
          })}
      </Table>
      <div className="flex gap-2 mt-3 items-center">
        <Input placeholder="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button disabled={changed.length === 0} onClick={save}>
          Lưu kiểm kho ({changed.length})
        </Button>
      </div>
    </div>
  );
}

// ---------- Nhà cung cấp ----------

function SuppliersTab() {
  const [suppliers, reload] = useData(api.suppliers);
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  return (
    <div>
      <div className="flex justify-end mb-3">
        <Button onClick={() => setEditing('new')}>+ Nhà cung cấp</Button>
      </div>
      <Table head={['Tên', 'SĐT', 'Địa chỉ', 'Ghi chú', '']}>
        {suppliers?.map((s) => (
          <tr key={s.id}>
            <td className="px-3 py-2 font-semibold">{s.name}</td>
            <td className="px-3 py-2">{s.phone}</td>
            <td className="px-3 py-2">{s.address}</td>
            <td className="px-3 py-2 text-gray-600">{s.note}</td>
            <td className="px-3 py-2">
              <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => setEditing(s)}>
                Sửa
              </Button>
            </td>
          </tr>
        ))}
      </Table>
      {editing && (
        <SupplierDialog
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function SupplierDialog({ supplier, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: supplier?.name ?? '',
    phone: supplier?.phone ?? '',
    address: supplier?.address ?? '',
    note: supplier?.note ?? '',
  });
  const save = async () => {
    const ok = await run(() => (supplier ? api.updateSupplier(supplier.id, form) : api.createSupplier(form)));
    if (ok) onSaved();
  };
  return (
    <Modal
      title={supplier ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!form.name} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      {(['name', 'phone', 'address', 'note'] as const).map((key) => (
        <Field key={key} label={{ name: 'Tên', phone: 'SĐT', address: 'Địa chỉ', note: 'Ghi chú' }[key]}>
          <Input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
        </Field>
      ))}
    </Modal>
  );
}
