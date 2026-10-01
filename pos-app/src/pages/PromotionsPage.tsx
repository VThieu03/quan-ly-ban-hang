import { useState } from 'react';
import { formatPrice } from '../../../shared/format.ts';
import type { Promotion } from '../../../shared/types.ts';
import { api, run } from '../api.ts';
import { useData } from '../context.ts';
import { Badge, Button, Field, Input, Modal, MoneyInput, NumberInput, PageHeader, Select, Table } from '../components/ui.tsx';

function status(p: Promotion): { label: string; color: 'green' | 'gray' | 'amber' | 'red' } {
  const now = new Date().toISOString();
  if (!p.active) return { label: 'Tắt', color: 'gray' };
  if (p.startsAt && now < p.startsAt) return { label: 'Chưa bắt đầu', color: 'amber' };
  if (p.endsAt && now > p.endsAt) return { label: 'Hết hạn', color: 'red' };
  if (p.usageLimit !== null && p.usedCount >= p.usageLimit) return { label: 'Hết lượt', color: 'red' };
  return { label: 'Đang chạy', color: 'green' };
}

export function PromotionsPage() {
  const [promotions, reload] = useData(api.promotions);
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);

  return (
    <div>
      <PageHeader title="Mã khuyến mãi">
        <Button onClick={() => setEditing('new')}>+ Tạo mã</Button>
      </PageHeader>
      <Table head={['Mã', 'Tên', 'Giảm', 'Điều kiện', 'Thời gian', 'Đã dùng', 'Trạng thái', '']}>
        {promotions?.map((p) => {
          const s = status(p);
          return (
            <tr key={p.id}>
              <td className="px-3 py-2 font-mono font-bold">{p.code}</td>
              <td className="px-3 py-2">{p.name}</td>
              <td className="px-3 py-2">
                {p.type === 'percent' ? `${p.value}%` : formatPrice(p.value)}
                {p.maxDiscount ? ` (tối đa ${formatPrice(p.maxDiscount)})` : ''}
              </td>
              <td className="px-3 py-2">{p.minSubtotal ? `Từ ${formatPrice(p.minSubtotal)}` : '—'}</td>
              <td className="px-3 py-2 text-sm whitespace-nowrap">
                {p.startsAt ? new Date(p.startsAt).toLocaleDateString('vi-VN') : '…'} →{' '}
                {p.endsAt ? new Date(p.endsAt).toLocaleDateString('vi-VN') : '…'}
              </td>
              <td className="px-3 py-2">
                {p.usedCount}
                {p.usageLimit !== null ? `/${p.usageLimit}` : ''}
              </td>
              <td className="px-3 py-2">
                <Badge color={s.color}>{s.label}</Badge>
              </td>
              <td className="px-3 py-2">
                <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => setEditing(p)}>
                  Sửa
                </Button>
              </td>
            </tr>
          );
        })}
      </Table>
      {editing && (
        <PromotionDialog
          promotion={editing === 'new' ? null : editing}
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

const dateInput = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('sv-SE') : '');

function PromotionDialog({ promotion, onClose, onSaved }: { promotion: Promotion | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    code: promotion?.code ?? '',
    name: promotion?.name ?? '',
    type: promotion?.type ?? ('percent' as 'percent' | 'amount'),
    value: promotion?.value ?? 10,
    minSubtotal: promotion?.minSubtotal ?? 0,
    maxDiscount: promotion?.maxDiscount ?? 0,
    startsAt: dateInput(promotion?.startsAt ?? null),
    endsAt: dateInput(promotion?.endsAt ?? null),
    usageLimit: promotion?.usageLimit ?? 0,
    active: promotion?.active ?? true,
  });

  const save = async () => {
    const body = {
      ...form,
      maxDiscount: form.maxDiscount || null,
      usageLimit: form.usageLimit || null,
      startsAt: form.startsAt ? new Date(`${form.startsAt}T00:00:00`).toISOString() : null,
      endsAt: form.endsAt ? new Date(`${form.endsAt}T23:59:59`).toISOString() : null,
    };
    const ok = await run(() => (promotion ? api.updatePromotion(promotion.id, body) : api.createPromotion(body)));
    if (ok) onSaved();
  };

  const remove = async () => {
    if (!promotion || !confirm(`Xóa mã ${promotion.code}? Hóa đơn đã dùng mã vẫn giữ nguyên.`)) return;
    if (await run(() => api.deletePromotion(promotion.id))) onSaved();
  };

  return (
    <Modal
      title={promotion ? `Sửa mã ${promotion.code}` : 'Tạo mã khuyến mãi'}
      onClose={onClose}
      footer={
        <>
          {promotion && (
            <Button variant="danger" className="mr-auto" onClick={remove}>
              Xóa
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!form.code || !form.name || !form.value} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mã (khách đọc cho thu ngân)">
          <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/\s/g, '') })} />
        </Field>
        <Field label="Tên chương trình">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Kiểu giảm">
          <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'percent' | 'amount' })}>
            <option value="percent">Theo %</option>
            <option value="amount">Số tiền cố định</option>
          </Select>
        </Field>
        <Field label={form.type === 'percent' ? 'Giảm (%)' : 'Giảm (đ)'}>
          {form.type === 'percent' ? (
            <NumberInput value={form.value} onChange={(n) => setForm({ ...form, value: Math.min(100, n) })} />
          ) : (
            <MoneyInput value={form.value} onChange={(value) => setForm({ ...form, value })} />
          )}
        </Field>
        <Field label="Hóa đơn tối thiểu">
          <MoneyInput value={form.minSubtotal} onChange={(minSubtotal) => setForm({ ...form, minSubtotal })} placeholder="Không" />
        </Field>
        <Field label="Giảm tối đa">
          <MoneyInput value={form.maxDiscount} onChange={(maxDiscount) => setForm({ ...form, maxDiscount })} placeholder="Không giới hạn" />
        </Field>
        <Field label="Từ ngày">
          <Input type="date" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
        </Field>
        <Field label="Đến ngày">
          <Input type="date" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
        </Field>
        <Field label="Số lượt dùng tối đa">
          <NumberInput
            value={form.usageLimit}
            placeholder="Không giới hạn"
            onChange={(n) => setForm({ ...form, usageLimit: n })}
          />
        </Field>
        <label className="flex items-center gap-2 mt-6">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Đang bật
        </label>
      </div>
    </Modal>
  );
}
