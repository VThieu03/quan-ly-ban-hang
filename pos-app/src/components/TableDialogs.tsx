import { useState } from 'react';
import { formatPrice, formatTime } from '../../../shared/format.ts';
import type { MenuCategory, OrderItem, StaffTable } from '../../../shared/types.ts';
import { api, run } from '../api.ts';
import { useData } from '../context.ts';
import { Button, Field, Input, Modal, Select, Textarea } from './ui.tsx';

// ---------- Mở bàn ----------

export function OpenTableDialog({ table, onClose }: { table: StaffTable; onClose: () => void }) {
  const reservation = table.nextReservation;
  const [guests, setGuests] = useState(reservation ? String(reservation.partySize) : '');
  const [useReservation, setUseReservation] = useState(Boolean(reservation));
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const ok = await run(() =>
      api.openTable(table.id, {
        guestCount: guests ? Number(guests) : null,
        reservationId: useReservation && reservation ? reservation.id : null,
      }),
    );
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal
      title={`Mở ${table.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button variant="success" disabled={busy} onClick={submit}>
            Mở bàn
          </Button>
        </>
      }
    >
      <Field label="Số khách">
        <div className="flex gap-2 flex-wrap">
          {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
            <button
              key={n}
              onClick={() => setGuests(String(n))}
              className={`w-12 h-12 rounded-lg border-2 font-bold ${guests === String(n) ? 'border-red-600 bg-red-50' : ''}`}
            >
              {n}
            </button>
          ))}
          <Input
            type="number"
            min={1}
            value={guests}
            onChange={(e) => setGuests(e.target.value)}
            className="w-24"
            placeholder="Khác"
          />
        </div>
      </Field>
      {reservation && (
        <label className="flex items-start gap-2 bg-blue-50 rounded-lg p-3">
          <input type="checkbox" checked={useReservation} onChange={(e) => setUseReservation(e.target.checked)} className="mt-1" />
          <span>
            Khách đặt trước: <b>{reservation.customerName}</b> ({reservation.partySize} người, {formatTime(reservation.reservedAt)})
            {reservation.note && <span className="block text-sm text-gray-600">{reservation.note}</span>}
          </span>
        </label>
      )}
    </Modal>
  );
}

// ---------- Nhân viên gọi món thay khách ----------

export function OrderDialog({ table, onClose }: { table: StaffTable; onClose: () => void }) {
  const [menu] = useData<MenuCategory[]>(api.menu);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const items = (menu ?? []).flatMap((c) => c.items);
  const category = menu?.find((c) => c.id === categoryId) ?? menu?.[0];
  const lines = Object.entries(cart).filter(([, q]) => q > 0);
  const total = lines.reduce((sum, [id, q]) => sum + (items.find((i) => i.id === id)?.price ?? 0) * q, 0);
  const change = (id: string, delta: number) => setCart((c) => ({ ...c, [id]: Math.max(0, (c[id] ?? 0) + delta) }));

  const submit = async () => {
    setBusy(true);
    const ok = await run(() =>
      api.staffOrder(table.id, { items: lines.map(([menuItemId, quantity]) => ({ menuItemId, quantity })), note }),
    );
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal
      wide
      title={`Gọi món – ${table.name}`}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto self-center font-bold text-red-600 text-lg">{formatPrice(total)}</span>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={busy || lines.length === 0} onClick={submit}>
            Gửi bếp ({lines.reduce((s, [, q]) => s + q, 0)} món)
          </Button>
        </>
      }
    >
      <div className="flex gap-2 overflow-x-auto">
        {menu?.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategoryId(c.id)}
            className={`px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap ${
              category?.id === c.id ? 'bg-gray-800 text-white' : 'bg-gray-100'
            }`}
          >
            {c.title.vi}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {category?.items.map((item) => (
          <button
            key={item.id}
            disabled={!item.available}
            onClick={() => change(item.id, 1)}
            className="relative text-left border rounded-xl p-2 hover:bg-gray-50 disabled:opacity-40"
          >
            <div className="font-semibold leading-tight">{item.name.vi}</div>
            <div className="text-sm text-red-600">{item.available ? formatPrice(item.price) : 'Hết món'}</div>
            {cart[item.id] > 0 && (
              <span className="absolute top-1 right-1 bg-red-600 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
                {cart[item.id]}
              </span>
            )}
          </button>
        ))}
      </div>
      {lines.length > 0 && (
        <div className="border rounded-xl divide-y">
          {lines.map(([id, q]) => {
            const item = items.find((i) => i.id === id);
            return (
              <div key={id} className="flex items-center justify-between px-3 py-2">
                <span>{item?.name.vi}</span>
                <div className="flex items-center gap-2">
                  <button className="w-8 h-8 rounded bg-gray-100 font-bold" onClick={() => change(id, -1)}>
                    −
                  </button>
                  <span className="w-6 text-center font-bold">{q}</span>
                  <button className="w-8 h-8 rounded bg-red-100 text-red-600 font-bold" onClick={() => change(id, 1)}>
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Textarea placeholder="Ghi chú cho bếp" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
    </Modal>
  );
}

// ---------- Hủy món ----------

const CANCEL_REASONS = ['Khách đổi ý', 'Hết món', 'Nhầm món', 'Lên chậm'];

export function CancelItemDialog({ item, onClose }: { item: OrderItem; onClose: () => void }) {
  const [quantity, setQuantity] = useState(item.quantity);
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    const ok = await run(() => api.cancelOrderItem(item.id, quantity, reason));
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal
      title={`Hủy món: ${item.name.vi}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Không
          </Button>
          <Button disabled={busy || !reason.trim()} onClick={submit}>
            Hủy {quantity} phần
          </Button>
        </>
      }
    >
      <Field label="Số lượng hủy">
        <div className="flex gap-2 flex-wrap">
          {Array.from({ length: item.quantity }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={() => setQuantity(n)}
              className={`w-11 h-11 rounded-lg border-2 font-bold ${quantity === n ? 'border-red-600 bg-red-50' : ''}`}
            >
              {n}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Lý do">
        <div className="flex gap-2 flex-wrap mb-2">
          {CANCEL_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={`px-3 py-1.5 rounded-lg border ${reason === r ? 'border-red-600 bg-red-50 text-red-700' : ''}`}
            >
              {r}
            </button>
          ))}
        </div>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={100} />
      </Field>
    </Modal>
  );
}

// ---------- Chuyển / gộp / tách bàn ----------

type MoveMode = 'move' | 'merge' | 'split';

export function MoveDialog({ table, tables, onClose }: { table: StaffTable; tables: StaffTable[]; onClose: () => void }) {
  const [mode, setMode] = useState<MoveMode>('move');
  const [targetId, setTargetId] = useState('');
  const [split, setSplit] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);

  const others = tables.filter((t) => t.id !== table.id);
  const targets = mode === 'move' ? others.filter((t) => !t.session) : mode === 'merge' ? others.filter((t) => t.session) : others;
  const items = (table.session?.orders ?? [])
    .filter((o) => o.status !== 'cancelled')
    .flatMap((o) => o.items.filter((i) => !i.cancelled));
  const splitLines = Object.entries(split)
    .filter(([, q]) => q > 0)
    .map(([id, quantity]) => ({ orderItemId: Number(id), quantity }));

  const submit = async () => {
    const to = Number(targetId);
    setBusy(true);
    const ok = await run(() =>
      mode === 'move'
        ? api.moveTable(table.id, to)
        : mode === 'merge'
          ? api.mergeTable(table.id, to)
          : api.splitTable(table.id, to, splitLines),
    );
    setBusy(false);
    if (ok) onClose();
  };

  const descriptions: Record<MoveMode, string> = {
    move: 'Chuyển toàn bộ khách và món sang một bàn trống.',
    merge: `Gộp toàn bộ món của ${table.name} vào một bàn đang có khách, ${table.name} sẽ được đóng.`,
    split: 'Chọn món cần tách sang bàn khác (để tính tiền riêng hoặc đổi chỗ một phần). Bàn trống sẽ được mở tự động.',
  };

  return (
    <Modal
      title={`${table.name}: chuyển / gộp / tách`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={busy || !targetId || (mode === 'split' && splitLines.length === 0)} onClick={submit}>
            Xác nhận
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        {(['move', 'merge', 'split'] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              setTargetId('');
            }}
            className={`py-2 rounded-lg font-semibold border-2 ${mode === m ? 'border-red-600 bg-red-50 text-red-700' : ''}`}
          >
            {{ move: 'Chuyển bàn', merge: 'Gộp bàn', split: 'Tách món' }[m]}
          </button>
        ))}
      </div>
      <p className="text-sm text-gray-600">{descriptions[mode]}</p>
      <Field label="Bàn đích">
        <Select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          <option value="">— Chọn bàn —</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.area ? ` (${t.area})` : ''}
              {t.session ? ` · đang có khách · ${formatPrice(t.session.total)}` : ' · trống'}
            </option>
          ))}
        </Select>
      </Field>
      {mode === 'split' && (
        <div className="border rounded-xl divide-y">
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between px-3 py-2 gap-2">
              <span>
                {item.name.vi} <span className="text-gray-500">(có {item.quantity})</span>
              </span>
              <Select
                className="w-24"
                value={split[item.id] ?? 0}
                onChange={(e) => setSplit((s) => ({ ...s, [item.id]: Number(e.target.value) }))}
              >
                {Array.from({ length: item.quantity + 1 }, (_, i) => (
                  <option key={i} value={i}>
                    {i === 0 ? 'Không' : `Tách ${i}`}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
