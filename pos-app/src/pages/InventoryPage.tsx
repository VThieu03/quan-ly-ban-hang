import { useState } from 'react';
import { formatPrice } from '../../../shared/format.ts';
import type { Ingredient, MenuCategory, MenuItem, Purchase, RecipeLine, StockMoveType, Supplier } from '../../../shared/types.ts';
import { api, errorText, run } from '../api.ts';
import { useApp, useCan, useData } from '../context.ts';
import {
  Badge,
  Button,
  DateRange,
  Empty,
  Field,
  Input,
  Modal,
  MoneyInput,
  PageHeader,
  Select,
  Table,
  Tabs,
  Textarea,
} from '../components/ui.tsx';
import { formatDateTime, formatQty, useDateRange } from '../dates.ts';

type Tab = 'stock' | 'forecast' | 'recipes' | 'purchases' | 'moves' | 'suppliers';

const MOVE_LABELS: Record<StockMoveType, string> = {
  opening: 'Tồn đầu kỳ',
  purchase: 'Nhập hàng',
  purchase_void: 'Hủy phiếu nhập',
  purchase_edit: 'Sửa phiếu nhập',
  sale: 'Bán (trừ theo định lượng)',
  void: 'Hoàn kho (hủy hóa đơn)',
  adjust: 'Điều chỉnh',
  waste: 'Xuất hủy',
  stocktake: 'Cập nhật tồn kho',
  cost_adjust: 'Sửa giá vốn',
};

/** Lượng nguyên liệu mặc định cho 1 phần khi tạo định lượng từ thực đơn (đơn vị kg). */
const DEFAULT_PORTION = '0.15';
const UNIT_SUGGESTIONS = ['kg', 'g', 'lít', 'ml', 'cái', 'quả', 'gói', 'hộp', 'chai', 'lon', 'bó'];
const money = (n: number) => formatPrice(Math.round(n));
/** Đơn vị lớn (kg, lít): định lượng 1 phần thường < 1, nhập lớn hơn 2 thì nhắc kiểm tra. */
const isBulkUnit = (unit: string) => ['kg', 'lít', 'lit', 'l'].includes(unit.trim().toLowerCase());

export function InventoryPage() {
  const [tab, setTab] = useState<Tab>('stock');
  // Bấm "Lịch sử" ở một nguyên liệu → mở tab lịch sử đã lọc sẵn.
  const [historyFor, setHistoryFor] = useState('');

  return (
    <div>
      <PageHeader title="Kho nguyên liệu" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'stock', label: 'Tồn kho' },
          { id: 'forecast', label: 'Dự báo bán' },
          { id: 'recipes', label: 'Định lượng món' },
          { id: 'purchases', label: 'Nhập hàng' },
          { id: 'moves', label: 'Lịch sử xuất nhập' },
          { id: 'suppliers', label: 'Nhà cung cấp' },
        ]}
      />
      {tab === 'stock' && (
        <StockTab
          onHistory={(id) => {
            setHistoryFor(String(id));
            setTab('moves');
          }}
        />
      )}
      {tab === 'forecast' && <ForecastTab />}
      {tab === 'recipes' && <RecipesTab />}
      {tab === 'purchases' && <PurchasesTab />}
      {tab === 'moves' && <MovesTab ingredientId={historyFor} onIngredientChange={setHistoryFor} />}
      {tab === 'suppliers' && <SuppliersTab />}
    </div>
  );
}

// ---------- Tồn kho ----------

function stockStatus(i: Ingredient) {
  if (!i.active) return <Badge>Ngừng dùng</Badge>;
  if (i.stock < 0) return <Badge color="red">Âm kho</Badge>;
  if (i.stock <= i.minStock) return <Badge color="amber">Sắp hết</Badge>;
  return null;
}

function StockTab({ onHistory }: { onHistory: (ingredientId: number) => void }) {
  const [ingredients, reload] = useData(api.ingredients);
  const [forecast] = useData(() => api.forecast());
  const [menu] = useData(api.menu);
  const [recipes, reloadRecipes] = useData(api.recipes);
  const [editing, setEditing] = useState<Ingredient | 'new' | null>(null);
  const [adjusting, setAdjusting] = useState<Ingredient | null>(null);
  const [fromMenu, setFromMenu] = useState(false);
  const [search, setSearch] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);

  // Nguyên liệu → các món dùng nó (từ định lượng).
  const dishNames = new Map<number, string[]>();
  const menuItems = (menu ?? []).flatMap((c) => c.items);
  for (const [menuItemId, lines] of Object.entries(recipes ?? {})) {
    const name = menuItems.find((m) => m.id === menuItemId)?.name.vi;
    if (!name) continue;
    for (const l of lines) dishNames.set(l.ingredientId, [...(dishNames.get(l.ingredientId) ?? []), name]);
  }
  // Số tồn nhập tay trên từng dòng, kèm tồn hệ thống "chụp" lúc bắt đầu sửa dòng đó
  // (trong lúc đếm mà có bán hàng thì phần đã bán không bị tính là chênh lệch).
  const [counts, setCounts] = useState<Record<number, { value: string; expected: number }>>({});
  // Giá vốn sửa tay trên từng dòng (đồng / đơn vị).
  const [costEdits, setCostEdits] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);

  const diffOf = (i: Ingredient) => {
    const c = counts[i.id];
    if (!c || c.value.trim() === '' || Number.isNaN(Number(c.value))) return null;
    return Math.round((Number(c.value) - c.expected) * 1000) / 1000;
  };
  /** Giá vốn mới nếu dòng này đang được sửa giá (null = giữ nguyên). */
  const newCostOf = (i: Ingredient) =>
    costEdits[i.id] !== undefined && costEdits[i.id] !== Math.round(i.cost) ? costEdits[i.id] : null;
  // Giá trị tồn tính lại ngay theo số lượng / giá vốn đang sửa.
  const stockOf = (i: Ingredient) => i.stock + (diffOf(i) ?? 0);
  const costOf = (i: Ingredient) => newCostOf(i) ?? i.cost;
  const valueOf = (i: Ingredient) => Math.max(stockOf(i), 0) * costOf(i);
  const isDirty = (i: Ingredient) => (diffOf(i) ?? 0) !== 0 || newCostOf(i) !== null;

  const changed = (ingredients ?? []).filter(isDirty);
  const changedValue = changed.reduce((sum, i) => sum + valueOf(i) - Math.max(i.stock, 0) * i.cost, 0);

  const setCount = (i: Ingredient, value: string) =>
    setCounts((c) => ({ ...c, [i.id]: { value, expected: c[i.id]?.expected ?? i.stock } }));
  const without = <T,>(record: Record<number, T>, ids: number[]) =>
    Object.fromEntries(Object.entries(record).filter(([id]) => !ids.includes(Number(id)))) as Record<number, T>;
  const discard = (ids: number[]) => {
    setCounts((c) => without(c, ids));
    setCostEdits((c) => without(c, ids));
  };

  /** Lưu các dòng: giá vốn trước (để phần chênh lệch số lượng được tính theo giá mới), rồi số tồn. */
  const saveRows = async (rows: Ingredient[]) => {
    const costLines = rows.filter((i) => newCostOf(i) !== null).map((i) => ({ ingredientId: i.id, cost: newCostOf(i)! }));
    const stockLines = rows
      .filter((i) => {
        const d = diffOf(i);
        return d !== null && d !== 0 && Number(counts[i.id].value) >= 0;
      })
      .map((i) => ({ ingredientId: i.id, actual: Number(counts[i.id].value), expected: counts[i.id].expected }));
    if (costLines.length === 0 && stockLines.length === 0) return;
    setSaving(true);
    try {
      if (costLines.length) await api.setIngredientCosts(costLines);
      if (stockLines.length) await api.stocktake({ note: 'Cập nhật tồn kho', lines: stockLines });
      discard(rows.map((i) => i.id));
      reload();
    } catch (err) {
      alert(errorText(err));
    }
    setSaving(false);
  };

  const active = (ingredients ?? []).filter((i) => i.active);
  const low = active.filter((i) => i.stock <= i.minStock);
  const negative = active.filter((i) => i.stock < 0);
  const noCost = active.filter((i) => !i.cost && i.stock > 0);
  const value = active.reduce((sum, i) => sum + valueOf(i), 0);
  const shown = (ingredients ?? []).filter(
    (i) => i.name.toLowerCase().includes(search.toLowerCase()) && (!onlyLow || (i.active && i.stock <= i.minStock)),
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border rounded-xl p-3">
          <div className="text-sm text-gray-500">Nguyên liệu đang dùng</div>
          <div className="text-xl font-bold">{active.length}</div>
        </div>
        <div className="bg-white border rounded-xl p-3">
          <div className="text-sm text-gray-500">Giá trị tồn kho</div>
          <div className="text-xl font-bold">{money(value)}</div>
        </div>
        <button className="bg-white border rounded-xl p-3 text-left hover:bg-amber-50" onClick={() => setOnlyLow(!onlyLow)}>
          <div className="text-sm text-gray-500">Sắp hết (≤ tồn tối thiểu)</div>
          <div className={`text-xl font-bold ${low.length ? 'text-amber-600' : ''}`}>
            {low.length} {onlyLow && <span className="text-sm font-normal">· đang lọc</span>}
          </div>
        </button>
        <div className="bg-white border rounded-xl p-3">
          <div className="text-sm text-gray-500">Âm kho (cần kiểm tra)</div>
          <div className={`text-xl font-bold ${negative.length ? 'text-red-600' : ''}`}>{negative.length}</div>
        </div>
      </div>
      {noCost.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded-xl p-3 text-sm">
          ⚠ {noCost.length} nguyên liệu đang có hàng nhưng <b>chưa có giá vốn</b> ({noCost.map((i) => i.name).slice(0, 5).join(', ')}
          {noCost.length > 5 ? '…' : ''}) nên giá trị tồn, giá vốn món và lãi gộp chưa chính xác. Gõ giá vào cột <b>Giá vốn</b> rồi bấm
          "Lưu tất cả".
        </div>
      )}
      {forecast && forecast.expectedRevenue > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white border rounded-xl p-3">
            <div className="text-sm text-gray-500">Giá vốn hàng dùng được để bán</div>
            <div className="text-xl font-bold">{money(forecast.stockValue)}</div>
          </div>
          <div className="bg-white border rounded-xl p-3">
            <div className="text-sm text-gray-500">Doanh thu dự kiến nếu bán hết (ước tính)</div>
            <div className="text-xl font-bold text-blue-700">{money(forecast.expectedRevenue)}</div>
          </div>
          <div className="bg-white border rounded-xl p-3">
            <div className="text-sm text-gray-500">Lãi gộp dự kiến</div>
            <div className="text-xl font-bold text-green-700">
              {money(forecast.expectedProfit)}{' '}
              <span className="text-sm font-normal">
                ({forecast.expectedRevenue ? Math.round((forecast.expectedProfit / forecast.expectedRevenue) * 100) : 0}%)
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input className="max-w-xs" placeholder="Tìm nguyên liệu..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setFromMenu(true)}>
            📋 Lấy từ thực đơn
          </Button>
          <Button onClick={() => setEditing('new')}>+ Nguyên liệu</Button>
        </div>
      </div>

      {ingredients && ingredients.length === 0 ? (
        <Empty>
          Chưa có nguyên liệu. Bấm <b>"Lấy từ thực đơn"</b> để tạo nhanh nguyên liệu theo các món đang bán, hoặc "+ Nguyên liệu" để thêm
          từng cái.
        </Empty>
      ) : (
        <Table head={['Nguyên liệu', 'Tồn kho (gõ số để cập nhật)', 'Tối thiểu', 'Giá vốn / ĐV (sửa được)', 'Giá trị tồn', 'Dùng trong', '']}>
          {shown.map((i) => {
            const diff = diffOf(i);
            const dirty = diff !== null && diff !== 0;
            const newCost = newCostOf(i);
            const rowDirty = dirty || newCost !== null;
            return (
            <tr key={i.id} className={`${i.active ? '' : 'opacity-50'} ${rowDirty ? 'bg-amber-50' : ''}`}>
              <td className="px-3 py-2 font-semibold">
                {i.name} {stockStatus(i)}
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="any"
                    min={0}
                    disabled={!i.active || saving}
                    value={counts[i.id]?.value ?? String(i.stock)}
                    onChange={(e) => setCount(i, e.target.value)}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRows([i]);
                      if (e.key === 'Escape') discard([i.id]);
                    }}
                    aria-label={`Tồn kho ${i.name}`}
                    className={`w-28 border rounded-lg px-2 py-1 text-right tabular-nums focus:outline-none focus:border-red-500 ${
                      dirty ? 'border-amber-500 bg-white font-semibold' : i.stock < 0 ? 'text-red-600 font-bold' : ''
                    }`}
                  />
                  <span className="text-sm text-gray-500">{i.unit}</span>
                  {rowDirty && (
                    <Button className="text-xs px-2 py-1" disabled={saving} onClick={() => saveRows([i])}>
                      Lưu
                    </Button>
                  )}
                </div>
                {dirty && (
                  <div className={`text-xs mt-0.5 ${diff! < 0 ? 'text-red-600' : 'text-green-700'}`}>
                    {diff! > 0 ? '+' : ''}
                    {formatQty(diff!)} {i.unit} · Enter để lưu, Esc để bỏ
                  </div>
                )}
              </td>
              <td className="px-3 py-2 tabular-nums">
                {formatQty(i.minStock)} {i.unit}
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1">
                  <MoneyInput
                    className={`w-32 py-1 ${newCost !== null ? 'border-amber-500 font-semibold' : ''}`}
                    disabled={!i.active || saving}
                    value={costEdits[i.id] ?? Math.round(i.cost)}
                    placeholder="Nhập giá vốn"
                    onChange={(cost) => setCostEdits((c) => ({ ...c, [i.id]: cost }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRows([i]);
                      if (e.key === 'Escape') discard([i.id]);
                    }}
                    aria-label={`Giá vốn ${i.name}`}
                  />
                  <span className="text-sm text-gray-500">/{i.unit}</span>
                </div>
                {newCost !== null && (
                  <div className="text-xs mt-0.5 text-amber-700">
                    Trước: {money(i.cost)} · Enter để lưu, Esc để bỏ
                  </div>
                )}
              </td>
              <td className={`px-3 py-2 tabular-nums ${rowDirty ? 'font-semibold text-amber-800' : ''}`}>
                {money(valueOf(i))}
                {rowDirty && (
                  <div className="text-xs font-normal text-gray-500">trước: {money(Math.max(i.stock, 0) * i.cost)}</div>
                )}
              </td>
              <td className="px-3 py-2 text-sm text-gray-600 max-w-56" title={dishNames.get(i.id)?.join(', ')}>
                {dishNames.get(i.id)?.length ? (
                  <span className="line-clamp-2">{dishNames.get(i.id)!.join(', ')}</span>
                ) : (
                  <span className="text-gray-400">Chưa dùng trong món nào</span>
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-right">
                <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => onHistory(i.id)}>
                  Lịch sử
                </Button>
                {i.active && (
                  <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => setAdjusting(i)}>
                    Xuất hủy
                  </Button>
                )}
                <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => setEditing(i)}>
                  Sửa
                </Button>
              </td>
            </tr>
            );
          })}
        </Table>
      )}

      {changed.length > 0 && (
        <div className="sticky bottom-0 z-10 bg-white border-2 border-amber-400 rounded-xl p-3 flex flex-wrap items-center gap-3 shadow-lg">
          <span className="font-semibold">
            Đã sửa {changed.length} nguyên liệu · giá trị tồn thay đổi{' '}
            <span className={changedValue < 0 ? 'text-red-600' : 'text-green-700'}>
              {changedValue > 0 ? '+' : ''}
              {money(changedValue)}
            </span>
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              variant="secondary"
              disabled={saving}
              onClick={() => {
                setCounts({});
                setCostEdits({});
              }}
            >
              Bỏ thay đổi
            </Button>
            <Button disabled={saving} onClick={() => saveRows(changed)}>
              {saving ? 'Đang lưu...' : 'Lưu tất cả'}
            </Button>
          </div>
        </div>
      )}

      <p className="text-sm text-gray-500">
        Gõ số thực tế vào cột <b>Tồn kho</b>, hoặc giá mới vào cột <b>Giá vốn</b>, rồi nhấn Enter (hoặc sửa nhiều dòng rồi bấm "Lưu
        tất cả"); giá trị tồn tự tính lại. Mọi thay đổi được ghi vào Lịch sử xuất nhập. Giá vốn mới chỉ áp dụng cho các lần bán sau
        (hóa đơn cũ giữ nguyên giá vốn lúc bán). Hàng mua về thì dùng tab <b>Nhập hàng</b> (giá vốn tự tính bình quân); hàng hỏng thì
        dùng <b>Xuất hủy</b>. Kho cũng tự trừ khi thanh toán theo <b>Định lượng món</b>.
      </p>

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
      {fromMenu && menu && ingredients && (
        <FromMenuDialog
          menu={menu}
          recipes={recipes ?? {}}
          ingredients={ingredients}
          onClose={() => setFromMenu(false)}
          onSaved={() => {
            setFromMenu(false);
            reload();
            reloadRecipes();
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

type FromMenuRow = {
  menuItemId: string;
  dish: string;
  category: string;
  hasRecipe: boolean;
  checked: boolean;
  name: string;
  unit: string;
  quantity: string;
  openingStock: string;
  cost: number;
};

/**
 * Tạo nguyên liệu nhanh từ danh sách món: mỗi món chọn → một nguyên liệu (mặc định cùng tên món)
 * và tự khai báo định lượng "1 phần món dùng X nguyên liệu". Tên đã có thì chỉ liên kết, không tạo trùng.
 */
function FromMenuDialog({
  menu,
  recipes,
  ingredients,
  onClose,
  onSaved,
}: {
  menu: MenuCategory[];
  recipes: Record<string, RecipeLine[]>;
  ingredients: Ingredient[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<FromMenuRow[]>(() =>
    menu.flatMap((c) =>
      c.items.map((item) => {
        const hasRecipe = (recipes[item.id]?.length ?? 0) > 0;
        return {
          menuItemId: item.id,
          dish: item.name.vi,
          category: c.title.vi,
          hasRecipe,
          checked: !hasRecipe,
          name: item.name.vi,
          unit: 'kg',
          quantity: DEFAULT_PORTION,
          openingStock: '',
          cost: 0,
        };
      }),
    ),
  );
  const [showAll, setShowAll] = useState(false);
  const [bulkUnit, setBulkUnit] = useState('kg');
  const [bulkQty, setBulkQty] = useState(DEFAULT_PORTION);
  const [busy, setBusy] = useState(false);

  const existingOf = (name: string) => ingredients.find((i) => i.name.trim().toLowerCase() === name.trim().toLowerCase());
  const update = (id: string, patch: Partial<FromMenuRow>) => setRows((rs) => rs.map((r) => (r.menuItemId === id ? { ...r, ...patch } : r)));
  const shown = rows.filter((r) => showAll || !r.hasRecipe);
  const selected = rows.filter((r) => r.checked && r.name.trim() && r.unit.trim() && Number(r.quantity) > 0);
  const newCount = new Set(selected.filter((r) => !existingOf(r.name)).map((r) => r.name.trim().toLowerCase())).size;

  const applyBulk = () =>
    setRows((rs) =>
      rs.map((r) => (r.checked ? { ...r, unit: existingOf(r.name)?.unit ?? bulkUnit, quantity: bulkQty } : r)),
    );

  const save = async () => {
    setBusy(true);
    try {
      const result = await api.linkFromMenu(
        selected.map((r) => {
          const existing = existingOf(r.name);
          return {
            menuItemId: r.menuItemId,
            name: r.name.trim(),
            unit: existing?.unit ?? r.unit.trim(),
            quantity: Number(r.quantity),
            openingStock: existing ? 0 : Number(r.openingStock) || 0,
            cost: existing ? 0 : r.cost,
          };
        }),
      );
      alert(`Đã tạo ${result.created} nguyên liệu mới và khai báo định lượng cho ${result.linked} món.`);
      onSaved();
    } catch (err) {
      alert(errorText(err));
    }
    setBusy(false);
  };

  return (
    <Modal
      wide
      title="Lấy nguyên liệu từ thực đơn"
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center text-sm text-gray-600">
            Chọn {selected.length} món · tạo mới {newCount} nguyên liệu
          </span>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={selected.length === 0 || busy} onClick={save}>
            Tạo &amp; liên kết
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-600">
        Mỗi món được chọn sẽ có một nguyên liệu (mặc định cùng tên món, sửa được) và tự khai báo định lượng: <b>1 phần món</b> dùng bao
        nhiêu nguyên liệu. Nhiều món dùng chung một nguyên liệu thì đặt cùng tên, hệ thống chỉ tạo 1 nguyên liệu. Tên đã có trong kho thì
        chỉ liên kết, không tạo trùng.
      </p>

      <div className="flex flex-wrap items-end gap-2 bg-gray-50 rounded-xl p-3">
        <Field label="Đơn vị">
          <Input list="unit-suggestions" className="w-24" value={bulkUnit} onChange={(e) => setBulkUnit(e.target.value)} />
        </Field>
        <Field label="Lượng / 1 phần">
          <Input type="number" step="any" min={0} className="w-28" value={bulkQty} onChange={(e) => setBulkQty(e.target.value)} />
        </Field>
        <Button variant="secondary" onClick={applyBulk}>
          Áp dụng cho các món đã chọn
        </Button>
        <label className="flex items-center gap-2 text-sm ml-auto">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Hiện cả món đã có định lượng
        </label>
      </div>
      <datalist id="unit-suggestions">
        {UNIT_SUGGESTIONS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      {shown.length === 0 ? (
        <Empty>Tất cả món đều đã khai báo định lượng.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-600">
              <tr>
                <th className="py-1 pr-2">
                  <input
                    type="checkbox"
                    checked={shown.every((r) => r.checked)}
                    onChange={(e) => {
                      const ids = new Set(shown.map((r) => r.menuItemId));
                      setRows((rs) => rs.map((r) => (ids.has(r.menuItemId) ? { ...r, checked: e.target.checked } : r)));
                    }}
                    aria-label="Chọn tất cả"
                  />
                </th>
                <th className="py-1 pr-2">Món</th>
                <th className="py-1 pr-2">Tên nguyên liệu</th>
                <th className="py-1 pr-2">Đơn vị</th>
                <th className="py-1 pr-2">Lượng / 1 phần</th>
                <th className="py-1 pr-2">Đang có trong kho</th>
                <th className="py-1">Giá vốn / ĐV</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shown.map((r) => {
                const existing = existingOf(r.name);
                const qty = Number(r.quantity) || 0;
                const unit = existing?.unit ?? r.unit;
                return (
                  <tr key={r.menuItemId} className={r.checked ? '' : 'opacity-50'}>
                    <td className="py-1.5 pr-2">
                      <input
                        type="checkbox"
                        checked={r.checked}
                        onChange={(e) => update(r.menuItemId, { checked: e.target.checked })}
                        aria-label={r.dish}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <div className="font-semibold">{r.dish}</div>
                      <div className="text-xs text-gray-500">
                        {r.category}
                        {r.hasRecipe && ' · đã có định lượng (sẽ thêm / cập nhật dòng này)'}
                      </div>
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input value={r.name} disabled={!r.checked} onChange={(e) => update(r.menuItemId, { name: e.target.value })} />
                      {existing && <div className="text-xs text-blue-700">Đã có trong kho – chỉ liên kết</div>}
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        list="unit-suggestions"
                        className="w-20"
                        disabled={!r.checked || Boolean(existing)}
                        value={unit}
                        onChange={(e) => update(r.menuItemId, { unit: e.target.value })}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input
                        type="number"
                        step="any"
                        min={0}
                        className="w-24"
                        disabled={!r.checked}
                        value={r.quantity}
                        onChange={(e) => update(r.menuItemId, { quantity: e.target.value })}
                      />
                      {isBulkUnit(unit) && qty > 2 && <div className="text-xs text-amber-700">⚠ {qty} {unit}/phần?</div>}
                    </td>
                    <td className="py-1.5 pr-2">
                      {existing ? (
                        <span className="text-gray-500">
                          {formatQty(existing.stock)} {existing.unit}
                        </span>
                      ) : (
                        <Input
                          type="number"
                          step="any"
                          min={0}
                          className="w-24"
                          disabled={!r.checked}
                          placeholder="0"
                          value={r.openingStock}
                          onChange={(e) => update(r.menuItemId, { openingStock: e.target.value })}
                        />
                      )}
                    </td>
                    <td className="py-1.5">
                      {existing ? (
                        <span className="text-gray-500">{money(existing.cost)}</span>
                      ) : (
                        <MoneyInput className="w-32" disabled={!r.checked} value={r.cost} onChange={(cost) => update(r.menuItemId, { cost })} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">
        Số lượng tính theo đơn vị nguyên liệu: nguyên liệu tính bằng kg, mỗi phần 150g thì nhập 0.15. Tồn đang có và giá vốn có thể để
        trống rồi cập nhật sau ở cột Tồn kho hoặc khi Nhập hàng.
      </p>
    </Modal>
  );
}

function IngredientDialog({ ingredient, onClose, onSaved }: { ingredient: Ingredient | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: ingredient?.name ?? '',
    unit: ingredient?.unit ?? 'kg',
    minStock: ingredient ? String(ingredient.minStock) : '',
    active: ingredient?.active ?? true,
    openingStock: '',
    cost: 0,
  });
  const opening = Number(form.openingStock) || 0;

  const save = async () => {
    const body = {
      name: form.name,
      unit: form.unit,
      minStock: Number(form.minStock) || 0,
      active: form.active,
      ...(ingredient ? {} : { openingStock: opening, cost: form.cost }),
    };
    const ok = await run(() => (ingredient ? api.updateIngredient(ingredient.id, body) : api.createIngredient(body)));
    if (ok) onSaved();
  };

  const remove = async () => {
    if (!ingredient || !confirm(`Xóa nguyên liệu "${ingredient.name}"?`)) return;
    if (await run(() => api.deleteIngredient(ingredient.id))) onSaved();
  };

  const unitLocked = Boolean(ingredient?.hasHistory);
  const deletable = ingredient && !ingredient.hasHistory && ingredient.usedInRecipes === 0;

  return (
    <Modal
      title={ingredient ? `Sửa ${ingredient.name}` : 'Thêm nguyên liệu'}
      onClose={onClose}
      footer={
        <>
          {deletable && (
            <Button variant="danger" className="mr-auto" onClick={remove}>
              Xóa
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!form.name.trim() || !form.unit.trim() || (opening > 0 && !form.cost)} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      <Field label="Tên nguyên liệu">
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="VD: Ba chỉ bò Mỹ" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Đơn vị tính"
          hint={unitLocked ? 'Đã có lịch sử xuất nhập nên không đổi được đơn vị.' : 'Đơn vị dùng cho nhập hàng, định lượng và cập nhật tồn kho.'}
        >
          <Input list="unit-suggestions" value={form.unit} disabled={unitLocked} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          <datalist id="unit-suggestions">
            {UNIT_SUGGESTIONS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </Field>
        <Field label={`Tồn tối thiểu (${form.unit || 'đơn vị'})`} hint="Dưới mức này sẽ báo sắp hết.">
          <Input type="number" min={0} step="any" value={form.minStock} onChange={(e) => setForm({ ...form, minStock: e.target.value })} />
        </Field>
      </div>

      {!ingredient && (
        <div className="bg-gray-50 rounded-xl p-3 space-y-2">
          <p className="text-sm font-semibold">Tồn đầu kỳ (không bắt buộc)</p>
          <p className="text-xs text-gray-500">
            Nếu trong kho đang có sẵn hàng khi bắt đầu dùng hệ thống, nhập số lượng và giá vốn tại đây. Hàng mua về sau thì dùng tab
            "Nhập hàng".
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Số lượng đang có (${form.unit || 'đơn vị'})`}>
              <Input
                type="number"
                min={0}
                step="any"
                value={form.openingStock}
                onChange={(e) => setForm({ ...form, openingStock: e.target.value })}
              />
            </Field>
            <Field label={`Giá vốn / ${form.unit || 'đơn vị'}`}>
              <MoneyInput value={form.cost} onChange={(cost) => setForm({ ...form, cost })} />
            </Field>
          </div>
          {opening > 0 && (
            <p className="text-sm">
              Giá trị tồn đầu kỳ: <b>{money(opening * form.cost)}</b>
              {!form.cost && <span className="text-red-600"> · cần nhập giá vốn</span>}
            </p>
          )}
        </div>
      )}

      {ingredient && (
        <>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Đang dùng
          </label>
          {!deletable && (
            <p className="text-xs text-gray-500">
              Nguyên liệu đã có lịch sử hoặc đang dùng trong định lượng nên không xóa được, chỉ có thể ngừng dùng.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

/** Xuất hủy hàng hư hỏng (cần lý do để biết hao hụt vì đâu). Muốn sửa số tồn thì gõ thẳng vào cột Tồn kho. */
function AdjustDialog({ ingredient, onClose, onSaved }: { ingredient: Ingredient; onClose: () => void; onSaved: () => void }) {
  const [change, setChange] = useState('');
  const [note, setNote] = useState('');
  const delta = -Math.abs(Number(change) || 0);
  const after = ingredient.stock + delta;

  const save = async () => {
    const ok = await run(() => api.adjustStock({ ingredientId: ingredient.id, type: 'waste', change: delta, note }));
    if (ok) onSaved();
  };

  return (
    <Modal
      title={`Xuất hủy: ${ingredient.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!delta || !note.trim()} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      <Field label={`Số lượng hủy (${ingredient.unit})`} hint="Hàng hư, hỏng, rơi vỡ... Muốn sửa lại số tồn cho đúng thì gõ thẳng vào cột Tồn kho.">

        <Input type="number" step="any" autoFocus value={change} onChange={(e) => setChange(e.target.value)} />
      </Field>
      <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-1">
        <div className="flex justify-between">
          <span>Tồn hiện tại</span>
          <span className="tabular-nums">
            {formatQty(ingredient.stock)} {ingredient.unit}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Thay đổi</span>
          <span className={`tabular-nums ${delta < 0 ? 'text-red-600' : 'text-green-700'}`}>
            {delta > 0 ? '+' : ''}
            {formatQty(delta)} {ingredient.unit} ({delta < 0 ? '−' : '+'}
            {money(Math.abs(delta) * ingredient.cost)})
          </span>
        </div>
        <div className="flex justify-between font-bold">
          <span>Tồn sau khi lưu</span>
          <span className={`tabular-nums ${after < 0 ? 'text-red-600' : ''}`}>
            {formatQty(after)} {ingredient.unit}
          </span>
        </div>
      </div>
      <Field label="Lý do (bắt buộc)">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: thịt bị hỏng do mất điện tủ đông" />
      </Field>
    </Modal>
  );
}

// ---------- Dự báo bán ----------

function ForecastTab() {
  const { config } = useApp();
  const can = useCan();
  const [days, setDays] = useState(30);
  const [forecast] = useData(() => api.forecast(days), [days]);
  const [autoSoldOut, setAutoSoldOut] = useState<boolean | null>(null);
  const autoOn = autoSoldOut ?? config?.autoSoldOut ?? false;

  const toggleAuto = async (on: boolean) => {
    const message = on
      ? 'Bật tự báo hết món?\nMón có định lượng sẽ tự chuyển "Hết món" khi không còn đủ nguyên liệu cho 1 phần, khách không gọi vượt số phần còn lại, và tự bật lại khi nhập hàng.\nChỉ nên bật khi số liệu kho đã chính xác (đã nhập tồn đầu kỳ / cập nhật số tồn thực tế).'
      : 'Tắt tự báo hết món? Các món đang bị hệ thống tự tắt sẽ được bật lại.';
    if (!confirm(message)) return;
    if (await run(() => api.saveSettings({ inventory: { autoSoldOut: on } }))) setAutoSoldOut(on);
  };

  if (!forecast) return <p className="text-gray-500">Đang tải...</p>;
  const dishes = [...forecast.dishes].sort((a, b) => a.portions - b.portions);
  const margin = forecast.expectedRevenue ? Math.round((forecast.expectedProfit / forecast.expectedRevenue) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white border rounded-xl p-4">
          <div className="text-sm text-gray-500">Giá vốn hàng dùng được để bán</div>
          <div className="text-2xl font-bold">{money(forecast.stockValue)}</div>
          <div className="text-xs text-gray-500">Đã trừ phần món khách gọi nhưng chưa thanh toán</div>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="text-sm text-gray-500">Doanh thu dự kiến nếu bán hết</div>
          <div className="text-2xl font-bold text-blue-700">{money(forecast.expectedRevenue)}</div>
          <div className="text-xs text-gray-500">Ước tính theo tỉ lệ bán {forecast.days} ngày gần nhất, giá chưa trừ giảm giá</div>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="text-sm text-gray-500">Lãi gộp dự kiến</div>
          <div className="text-2xl font-bold text-green-700">
            {money(forecast.expectedProfit)} <span className="text-base font-normal">({margin}%)</span>
          </div>
          {forecast.untrackedValue > 0 && (
            <div className="text-xs text-amber-700">
              Chưa tính {money(forecast.untrackedValue)} hàng tồn chưa dùng trong định lượng món nào
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-600">Ước tính theo số liệu bán:</span>
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`text-sm px-3 py-1.5 rounded-lg border ${days === d ? 'bg-gray-800 text-white border-gray-800' : 'bg-white'}`}
          >
            {d} ngày
          </button>
        ))}
      </div>

      <div className="bg-white border rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">Tự báo "Hết món" khi hết nguyên liệu</div>
          <div className="text-sm text-gray-500">
            Món có định lượng tự chuyển Hết món khi không còn đủ nguyên liệu cho 1 phần, khách không gọi vượt số phần còn lại (thấy
            "Chỉ còn N phần" khi còn ≤ 5), và tự bật lại khi nhập hàng. Món nhân viên tự tắt thì giữ nguyên.
          </div>
        </div>
        {can('settings') ? (
          <Button variant={autoOn ? 'success' : 'secondary'} onClick={() => toggleAuto(!autoOn)}>
            {autoOn ? '✓ Đang bật' : 'Đang tắt · Bật'}
          </Button>
        ) : (
          <Badge color={autoOn ? 'green' : 'gray'}>{autoOn ? 'Đang bật' : 'Đang tắt'}</Badge>
        )}
      </div>

      <div>
        <h2 className="font-bold text-gray-800 mb-1">Theo món: còn làm được bao nhiêu phần</h2>
        <p className="text-sm text-gray-500 mb-2">
          Mỗi món tính riêng. Các món dùng chung một nguyên liệu thì không cộng dồn được (bán món này thì món kia bớt đi).
        </p>
        {dishes.length === 0 ? (
          <Empty>Chưa có món nào khai báo định lượng (tab "Định lượng món").</Empty>
        ) : (
          <Table head={['Món', 'Còn làm được', 'Hết trước tiên', 'Giá vốn / phần', 'Giá bán', 'Tiền bán nếu bán hết', 'Lãi gộp']}>
            {dishes.map((d) => (
              <tr key={d.menuItemId}>
                <td className="px-3 py-2 font-semibold">{d.name}</td>
                <td className="px-3 py-2 tabular-nums">
                  {d.portions === 0 ? <Badge color="red">Hết</Badge> : d.portions <= 5 ? <Badge color="amber">{d.portions} phần</Badge> : `${d.portions} phần`}
                </td>
                <td className="px-3 py-2 text-sm text-gray-600">{d.limitingIngredient ?? '—'}</td>
                <td className="px-3 py-2 tabular-nums">{money(d.cost)}</td>
                <td className="px-3 py-2 tabular-nums">{money(d.price)}</td>
                <td className="px-3 py-2 tabular-nums">{money(d.revenue)}</td>
                <td className="px-3 py-2 tabular-nums text-green-700">{money(d.profit)}</td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      <div>
        <h2 className="font-bold text-gray-800 mb-2">Theo nguyên liệu</h2>
        {forecast.ingredients.length === 0 ? (
          <Empty>Chưa có nguyên liệu nào được dùng trong định lượng.</Empty>
        ) : (
          <Table head={['Nguyên liệu', 'Tồn dùng được', 'Giá vốn', 'Doanh thu / đơn vị', 'Doanh thu dự kiến', 'Cách tính']}>
            {forecast.ingredients.map((i) => (
              <tr key={i.ingredientId}>
                <td className="px-3 py-2 font-semibold">{i.name}</td>
                <td className="px-3 py-2 tabular-nums">
                  {formatQty(i.available)} {i.unit}
                </td>
                <td className="px-3 py-2 tabular-nums">{money(i.stockValue)}</td>
                <td className="px-3 py-2 tabular-nums">
                  {money(i.revenuePerUnit)}/{i.unit}
                </td>
                <td className="px-3 py-2 tabular-nums text-blue-700">{money(i.expectedRevenue)}</td>
                <td className="px-3 py-2 text-sm text-gray-600">
                  {i.basis === 'sales' ? `Theo bán ${forecast.days} ngày` : 'Theo giá menu (chưa có số liệu bán)'}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>
    </div>
  );
}

// ---------- Định lượng ----------

function RecipesTab() {
  const [menu] = useData(api.menu);
  const [ingredients] = useData(api.ingredients);
  const [recipes, reload] = useData(api.recipes);
  const [costs, reloadCosts] = useData(api.menuCosts);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const ingredientOf = (id: number) => ingredients?.find((i) => i.id === id);

  const items = (menu ?? []).flatMap((c) => c.items.map((item) => ({ item, category: c.title.vi })));
  const missing = items.filter(({ item }) => !(recipes?.[item.id]?.length));
  const shown = onlyMissing ? missing : items;

  return (
    <div className="space-y-3">
      <p className="text-gray-600">
        Khai báo <b>mỗi 1 phần</b> món dùng bao nhiêu nguyên liệu. Khi thanh toán, kho được trừ tự động và báo cáo tính được giá vốn,
        lãi gộp. Món chưa khai báo sẽ không trừ kho.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
        Chỉ hiện món chưa khai báo ({missing.length}/{items.length})
      </label>
      <Table head={['Món', 'Danh mục', 'Định lượng / 1 phần', 'Giá vốn', 'Giá bán', 'Lãi gộp', 'Còn làm được', '']}>
        {shown.map(({ item, category }) => {
          const lines = recipes?.[item.id] ?? [];
          const cost = costs?.[item.id];
          const margin = cost !== undefined && item.price ? Math.round(((item.price - cost) / item.price) * 100) : null;
          return (
            <tr key={item.id}>
              <td className="px-3 py-2 font-semibold">{item.name.vi}</td>
              <td className="px-3 py-2 text-sm text-gray-500">{category}</td>
              <td className="px-3 py-2 text-sm">
                {lines.length === 0 ? (
                  <span className="text-gray-400">Chưa khai báo</span>
                ) : (
                  lines
                    .map((l) => `${formatQty(l.quantity)} ${ingredientOf(l.ingredientId)?.unit ?? ''} ${ingredientOf(l.ingredientId)?.name ?? '?'}`)
                    .join(' + ')
                )}
              </td>
              <td className="px-3 py-2 tabular-nums">{cost !== undefined ? money(cost) : '—'}</td>
              <td className="px-3 py-2 tabular-nums">{money(item.price)}</td>
              <td className={`px-3 py-2 tabular-nums ${margin !== null && margin < 30 ? 'text-red-600 font-semibold' : ''}`}>
                {margin !== null ? `${margin}%` : '—'}
              </td>
              <td className="px-3 py-2 tabular-nums">
                {item.remaining === null ? '—' : item.remaining === 0 ? <Badge color="red">Hết</Badge> : `${item.remaining} phần`}
              </td>
              <td className="px-3 py-2">
                <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => setEditing(item)}>
                  {lines.length ? 'Sửa' : 'Khai báo'}
                </Button>
              </td>
            </tr>
          );
        })}
      </Table>
      {editing && ingredients && (
        <RecipeDialog
          item={editing}
          lines={recipes?.[editing.id] ?? []}
          ingredients={ingredients}
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

export function RecipeDialog({
  item,
  lines: initial,
  ingredients,
  onClose,
  onSaved,
}: {
  item: MenuItem;
  lines: RecipeLine[];
  ingredients: Ingredient[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [lines, setLines] = useState<{ ingredientId: number; quantity: string }[]>(
    initial.length ? initial.map((l) => ({ ingredientId: l.ingredientId, quantity: String(l.quantity) })) : [{ ingredientId: 0, quantity: '' }],
  );
  const byId = (id: number) => ingredients.find((i) => i.id === id);
  const valid = lines.filter((l) => l.ingredientId && Number(l.quantity) > 0);
  const cost = valid.reduce((sum, l) => sum + Number(l.quantity) * (byId(l.ingredientId)?.cost ?? 0), 0);
  const margin = item.price ? Math.round(((item.price - cost) / item.price) * 100) : 0;
  const update = (i: number, patch: Partial<(typeof lines)[number]>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  // Nguyên liệu đang ngừng dùng chỉ hiện nếu công thức cũ đã có.
  const selectable = ingredients.filter((i) => i.active || lines.some((l) => l.ingredientId === i.id));

  const save = async () => {
    const ok = await run(() => api.setRecipe(item.id, valid.map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity) }))));
    if (ok) onSaved();
  };

  return (
    <Modal
      wide
      title={`Định lượng 1 phần: ${item.name.vi}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={save}>{valid.length ? 'Lưu' : 'Lưu (xóa định lượng)'}</Button>
        </>
      }
    >
      {ingredients.length === 0 && <p className="text-amber-700">Chưa có nguyên liệu. Thêm ở tab Tồn kho trước.</p>}
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_9rem_8rem_2rem] gap-2 text-sm font-semibold text-gray-600">
          <span>Nguyên liệu</span>
          <span>Lượng / 1 phần</span>
          <span className="text-right">Thành tiền</span>
          <span />
        </div>
        {lines.map((line, i) => {
          const ing = byId(line.ingredientId);
          const qty = Number(line.quantity) || 0;
          const suspicious = ing && isBulkUnit(ing.unit) && qty > 2;
          return (
            <div key={i}>
              <div className="grid grid-cols-[1fr_9rem_8rem_2rem] gap-2 items-center">
                <Select value={line.ingredientId || ''} onChange={(e) => update(i, { ingredientId: Number(e.target.value) })}>
                  <option value="">— Chọn nguyên liệu —</option>
                  {selectable.map((x) => (
                    <option key={x.id} value={x.id} disabled={x.id !== line.ingredientId && lines.some((l) => l.ingredientId === x.id)}>
                      {x.name} ({x.unit})
                    </option>
                  ))}
                </Select>
                <div className="flex items-center gap-1">
                  <Input type="number" step="any" min={0} value={line.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
                  <span className="text-sm text-gray-500 w-8">{ing?.unit}</span>
                </div>
                <span className="text-right tabular-nums">{ing ? money(qty * ing.cost) : ''}</span>
                <button className="text-red-600 text-xl" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Xóa dòng">
                  ×
                </button>
              </div>
              {suspicious && (
                <p className="text-xs text-amber-700 mt-1">
                  ⚠ 1 phần dùng {formatQty(qty)} {ing.unit}? Nếu ý là {formatQty(qty)} gram/ml thì nhập {formatQty(qty / 1000)}.
                </p>
              )}
            </div>
          );
        })}
        <Button variant="secondary" onClick={() => setLines([...lines, { ingredientId: 0, quantity: '' }])}>
          + Thêm nguyên liệu
        </Button>
      </div>
      <p className="text-xs text-gray-500">
        Số lượng tính theo đơn vị của nguyên liệu. VD nguyên liệu tính bằng kg, mỗi phần 150g thì nhập <b>0.15</b>.
      </p>
      <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-3 text-center">
        <div>
          <div className="text-sm text-gray-500">Giá vốn / phần</div>
          <div className="font-bold">{money(cost)}</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Giá bán</div>
          <div className="font-bold">{money(item.price)}</div>
        </div>
        <div>
          <div className="text-sm text-gray-500">Lãi gộp</div>
          <div className={`font-bold ${margin < 30 ? 'text-red-600' : 'text-green-700'}`}>
            {money(item.price - cost)} ({margin}%)
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Nhập hàng ----------

function PurchasesTab() {
  const [range, setRange] = useDateRange(30);
  const [purchases, reload] = useData(() => api.purchases(range.from, range.to), [range.from, range.to]);
  const [editing, setEditing] = useState<Purchase | 'new' | null>(null);
  const valid = (purchases ?? []).filter((p) => !p.voided);
  const total = valid.reduce((sum, p) => sum + p.total, 0);

  const voidPurchase = async (p: Purchase) => {
    const reason = prompt(`Hủy phiếu nhập #${p.id} (${money(p.total)})?\nHàng sẽ bị trừ lại khỏi kho. Nhập lý do:`, 'Nhập sai số lượng / giá');
    if (reason === null) return;
    if (await run(() => api.voidPurchase(p.id, reason))) reload();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DateRange value={range} onChange={setRange} />
        <Button onClick={() => setEditing('new')}>+ Phiếu nhập</Button>
      </div>
      <p className="text-gray-600">
        {valid.length} phiếu nhập · tổng <b>{money(total)}</b>
      </p>
      {purchases && purchases.length === 0 && <Empty>Chưa có phiếu nhập trong khoảng thời gian này.</Empty>}
      <div className="space-y-3">
        {purchases?.map((p) => (
          <div key={p.id} className={`bg-white border rounded-xl p-3 ${p.voided ? 'opacity-60' : ''}`}>
            <div className="flex justify-between flex-wrap gap-2">
              <span className="font-bold">
                Phiếu #{p.id} · {formatDateTime(p.createdAt)} · {p.supplierName ?? 'Không rõ NCC'}{' '}
                {p.voided && <Badge color="red">Đã hủy</Badge>}
              </span>
              <span className={`font-bold ${p.voided ? 'line-through' : 'text-red-600'}`}>{money(p.total)}</span>
            </div>
            <table className="w-full text-sm mt-2">
              <tbody>
                {p.lines.map((l, i) => (
                  <tr key={i} className="text-gray-700">
                    <td className="py-0.5">{l.ingredientName}</td>
                    <td className="py-0.5 text-right tabular-nums">
                      {formatQty(l.quantity)} {l.unit} × {money(l.unitCost)}
                    </td>
                    <td className="py-0.5 text-right tabular-nums w-32">{money(l.quantity * l.unitCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-between items-end mt-1">
              <div className="text-xs text-gray-500">
                {p.staffName && `Người nhập: ${p.staffName}`} {p.note && `· ${p.note}`}
                {p.edited && !p.voided && (
                  <div className="text-amber-700">
                    Đã sửa lúc {formatDateTime(p.edited.at)} {p.edited.by && `bởi ${p.edited.by}`} (xem chi tiết ở Lịch sử xuất nhập)
                  </div>
                )}
                {p.voided && (
                  <div className="text-red-600">
                    Hủy lúc {formatDateTime(p.voided.at)} {p.voided.by && `bởi ${p.voided.by}`} · {p.voided.reason}
                  </div>
                )}
              </div>
              {!p.voided && (
                <div className="flex gap-1 shrink-0">
                  <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => setEditing(p)}>
                    Sửa phiếu
                  </Button>
                  <Button variant="ghost" className="text-sm px-2 py-1 text-red-600" onClick={() => voidPurchase(p)}>
                    Hủy phiếu
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <PurchaseDialog
          purchase={editing === 'new' ? null : editing}
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

type PurchaseLine = { ingredientId: number; quantity: string; unitCost: number };

function PurchaseDialog({ purchase, onClose, onSaved }: { purchase: Purchase | null; onClose: () => void; onSaved: () => void }) {
  const [ingredients] = useData(api.ingredients);
  const [suppliers] = useData(api.suppliers);
  const [supplierId, setSupplierId] = useState(purchase?.supplierId ? String(purchase.supplierId) : '');
  const [note, setNote] = useState(purchase?.note ?? '');
  const [lines, setLines] = useState<PurchaseLine[]>(
    purchase
      ? purchase.lines.map((l) => ({ ingredientId: l.ingredientId, quantity: String(l.quantity), unitCost: l.unitCost }))
      : [{ ingredientId: 0, quantity: '', unitCost: 0 }],
  );
  // Nguyên liệu đã ngừng dùng nhưng vốn có trong phiếu đang sửa thì vẫn chọn được.
  const inPurchase = new Set(purchase?.lines.map((l) => l.ingredientId) ?? []);
  const [busy, setBusy] = useState(false);
  const byId = (id: number) => ingredients?.find((x) => x.id === id);
  const valid = lines.filter((l) => l.ingredientId && Number(l.quantity) > 0);
  const total = valid.reduce((sum, l) => sum + Number(l.quantity) * l.unitCost, 0);
  const update = (i: number, patch: Partial<PurchaseLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async () => {
    const zero = valid.filter((l) => !l.unitCost);
    if (zero.length && !confirm(`Có ${zero.length} dòng đơn giá 0đ (hàng tặng?). Vẫn lưu?`)) return;
    if (purchase && !confirm(`Lưu thay đổi phiếu nhập #${purchase.id}? Tồn kho và giá vốn sẽ được tính lại theo số mới.`)) return;
    setBusy(true);
    try {
      const body = {
        supplierId: supplierId ? Number(supplierId) : null,
        note,
        lines: valid.map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity), unitCost: l.unitCost })),
      };
      await (purchase ? api.updatePurchase(purchase.id, body) : api.createPurchase(body));
      onSaved();
    } catch (err) {
      alert(errorText(err));
    }
    setBusy(false);
  };

  return (
    <Modal
      wide
      title={purchase ? `Sửa phiếu nhập #${purchase.id} (${formatDateTime(purchase.createdAt)})` : 'Phiếu nhập hàng'}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center font-bold text-lg">Tổng: {money(total)}</span>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={valid.length === 0 || busy} onClick={save}>
            {purchase ? 'Lưu thay đổi' : 'Lưu phiếu nhập'}
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
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Số hóa đơn của NCC..." />
        </Field>
      </div>
      <div className="space-y-2">
        <p className="text-xs text-gray-500">
          Nhập <b>đơn giá</b> (giá của 1 đơn vị) hoặc <b>thành tiền</b> của cả dòng theo hóa đơn nhà cung cấp, ô còn lại tự tính.
        </p>
        <div className="grid grid-cols-[1fr_8rem_9rem_9rem_2rem] gap-2 text-sm font-semibold text-gray-600">
          <span>Nguyên liệu</span>
          <span>Số lượng</span>
          <span>Đơn giá / ĐV</span>
          <span>Thành tiền</span>
          <span />
        </div>
        {lines.map((line, i) => {
          const ing = byId(line.ingredientId);
          const qty = Number(line.quantity) || 0;
          // Giá lệch nhiều so với giá vốn hiện tại thường là gõ nhầm (thừa/thiếu số 0, nhầm giá cả lô với đơn giá).
          const off = ing && ing.cost > 0 && line.unitCost > 0 && (line.unitCost > ing.cost * 2 || line.unitCost < ing.cost / 2);
          return (
            <div key={i}>
              <div className="grid grid-cols-[1fr_8rem_9rem_9rem_2rem] gap-2 items-center">
                <Select
                  value={line.ingredientId || ''}
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    // Gợi ý sẵn đơn giá bằng giá vốn hiện tại.
                    update(i, { ingredientId: id, unitCost: line.unitCost || Math.round(byId(id)?.cost ?? 0) });
                  }}
                >
                  <option value="">— Chọn —</option>
                  {ingredients
                    ?.filter((x) => x.active || inPurchase.has(x.id))
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} ({x.unit})
                      </option>
                    ))}
                </Select>
                <div className="flex items-center gap-1">
                  <Input type="number" step="any" min={0} value={line.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
                  <span className="text-sm text-gray-500 w-8">{ing?.unit}</span>
                </div>
                <MoneyInput value={line.unitCost} onChange={(unitCost) => update(i, { unitCost })} />
                <MoneyInput
                  value={Math.round(qty * line.unitCost)}
                  disabled={!qty}
                  title={qty ? undefined : 'Nhập số lượng trước'}
                  onChange={(lineTotal) => update(i, { unitCost: qty ? Math.round((lineTotal / qty) * 100) / 100 : 0 })}
                />
                <button className="text-red-600 text-xl" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Xóa dòng">
                  ×
                </button>
              </div>
              {ing && (
                <p className={`text-xs mt-1 ${off ? 'text-amber-700' : 'text-gray-500'}`}>
                  Tồn {formatQty(ing.stock)} {ing.unit} · giá vốn hiện tại {money(ing.cost)}/{ing.unit}
                  {off && ' · ⚠ đơn giá chênh lệch nhiều, kiểm tra lại (đơn giá là giá của 1 ' + ing.unit + ')'}
                </p>
              )}
            </div>
          );
        })}
        <Button variant="secondary" onClick={() => setLines([...lines, { ingredientId: 0, quantity: '', unitCost: 0 }])}>
          + Dòng
        </Button>
      </div>
    </Modal>
  );
}

// ---------- Lịch sử xuất nhập ----------

function MovesTab({ ingredientId, onIngredientChange }: { ingredientId: string; onIngredientChange: (id: string) => void }) {
  const [range, setRange] = useDateRange(30);
  const [type, setType] = useState('');
  const [ingredients] = useData(api.ingredients);
  const [moves] = useData(() => api.stockMoves(range.from, range.to, ingredientId, type), [range.from, range.to, ingredientId, type]);
  const selected = ingredients?.find((i) => String(i.id) === ingredientId);
  const totalIn = (moves ?? []).filter((m) => m.change > 0).reduce((s, m) => s + m.change, 0);
  const totalOut = (moves ?? []).filter((m) => m.change < 0).reduce((s, m) => s + m.change, 0);
  const totalValue = (moves ?? []).reduce((s, m) => s + m.change * m.unitCost, 0);

  return (
    <div className="space-y-3">
      <DateRange value={range} onChange={setRange} />
      <div className="flex flex-wrap gap-2">
        <Select className="max-w-xs" value={ingredientId} onChange={(e) => onIngredientChange(e.target.value)}>
          <option value="">Tất cả nguyên liệu</option>
          {ingredients?.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </Select>
        <Select className="max-w-xs" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Tất cả loại</option>
          {(Object.keys(MOVE_LABELS) as StockMoveType[]).map((t) => (
            <option key={t} value={t}>
              {MOVE_LABELS[t]}
            </option>
          ))}
        </Select>
      </div>
      {selected && moves && (
        <p className="text-gray-600">
          {selected.name}: nhập <b className="text-green-700">+{formatQty(totalIn)}</b> · xuất{' '}
          <b className="text-red-600">{formatQty(totalOut)}</b> {selected.unit} trong khoảng này · tồn hiện tại{' '}
          <b>
            {formatQty(selected.stock)} {selected.unit}
          </b>
        </p>
      )}
      {moves && moves.length === 0 ? (
        <Empty>Không có dòng nào.</Empty>
      ) : (
        <Table head={['Thời gian', 'Nguyên liệu', 'Loại', 'Thay đổi', 'Đơn giá', 'Giá trị', 'Người làm', 'Ghi chú']}>
          {moves?.map((m) => (
            <tr key={m.id}>
              <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(m.createdAt)}</td>
              <td className="px-3 py-2">{m.ingredientName}</td>
              <td className="px-3 py-2">{MOVE_LABELS[m.type]}</td>
              <td className={`px-3 py-2 font-semibold tabular-nums ${m.change < 0 ? 'text-red-600' : 'text-green-700'}`}>
                {m.type === 'cost_adjust' ? (
                  <span className="text-gray-400">—</span>
                ) : (
                  <>
                    {m.change > 0 ? '+' : ''}
                    {formatQty(m.change)} {m.unit}
                  </>
                )}
              </td>
              <td className="px-3 py-2 tabular-nums">{money(m.unitCost)}</td>
              <td className="px-3 py-2 tabular-nums">{m.type === 'cost_adjust' ? '—' : money(m.change * m.unitCost)}</td>
              <td className="px-3 py-2">{m.staffName ?? (m.type === 'sale' ? 'Tự động' : '')}</td>
              <td className="px-3 py-2 text-gray-600">{m.note}</td>
            </tr>
          ))}
        </Table>
      )}
      {moves && moves.length > 0 && (
        <p className="text-sm text-gray-500">
          {moves.length} dòng · tổng giá trị thay đổi {money(totalValue)}
          {moves.length >= 1000 && ' · chỉ hiện 1000 dòng mới nhất, hãy thu hẹp khoảng ngày hoặc lọc theo nguyên liệu'}
        </p>
      )}
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
      {suppliers && suppliers.length === 0 ? (
        <Empty>Chưa có nhà cung cấp.</Empty>
      ) : (
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
      )}
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
  const remove = async () => {
    if (!supplier || !confirm(`Xóa nhà cung cấp ${supplier.name}? Phiếu nhập cũ sẽ hiện "Không rõ NCC".`)) return;
    if (await run(() => api.deleteSupplier(supplier.id))) onSaved();
  };
  return (
    <Modal
      title={supplier ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'}
      onClose={onClose}
      footer={
        <>
          {supplier && (
            <Button variant="danger" className="mr-auto" onClick={remove}>
              Xóa
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!form.name.trim()} onClick={save}>
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
