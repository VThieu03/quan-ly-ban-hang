import { useState } from 'react';
import { formatPrice } from '../../../shared/format.ts';
import type { Customer } from '../../../shared/types.ts';
import { api, run } from '../api.ts';
import { useApp, useData } from '../context.ts';
import { Button, Field, Input, Modal, PageHeader, Table, Textarea } from '../components/ui.tsx';

export function CustomersPage() {
  const { config } = useApp();
  const [search, setSearch] = useState('');
  const [customers, reload] = useData(() => api.customers(search), [search]);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);

  return (
    <div>
      <PageHeader title="Khách hàng thành viên">
        <Button onClick={() => setEditing('new')}>+ Thêm khách</Button>
      </PageHeader>
      <Input className="max-w-sm mb-4" placeholder="Tìm theo SĐT hoặc tên..." value={search} onChange={(e) => setSearch(e.target.value)} />
      {config?.loyalty.enabled && (
        <p className="text-sm text-gray-500 mb-3">
          Tích điểm: mỗi {formatPrice(config.loyalty.spendPerPoint)} được 1 điểm · 1 điểm = {formatPrice(config.loyalty.pointValue)} khi
          thanh toán.
        </p>
      )}
      <Table head={['SĐT', 'Tên', 'Điểm', 'Tổng chi', 'Số lần', 'Ghi chú', '']}>
        {customers?.map((c) => (
          <tr key={c.id}>
            <td className="px-3 py-2 font-mono">{c.phone}</td>
            <td className="px-3 py-2">{c.name}</td>
            <td className="px-3 py-2 font-semibold">{c.points}</td>
            <td className="px-3 py-2">{formatPrice(c.totalSpent)}</td>
            <td className="px-3 py-2">{c.visits}</td>
            <td className="px-3 py-2 text-gray-600">{c.note}</td>
            <td className="px-3 py-2">
              <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => setEditing(c)}>
                Sửa
              </Button>
            </td>
          </tr>
        ))}
      </Table>
      {editing && (
        <CustomerDialog
          customer={editing === 'new' ? null : editing}
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

function CustomerDialog({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: () => void }) {
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [name, setName] = useState(customer?.name ?? '');
  const [note, setNote] = useState(customer?.note ?? '');
  const [points, setPoints] = useState(customer?.points ?? 0);

  const save = async () => {
    const ok = await run(() =>
      customer ? api.updateCustomer(customer.id, { name, note, points }) : api.createCustomer({ phone, name, note }),
    );
    if (ok) onSaved();
  };

  return (
    <Modal
      title={customer ? `Khách ${customer.phone}` : 'Thêm khách hàng'}
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
      {!customer && (
        <Field label="Số điện thoại">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        </Field>
      )}
      <Field label="Tên">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {customer && (
        <Field label="Điểm" hint="Chỉ chỉnh tay khi cần bù/trừ điểm đặc biệt.">
          <Input type="number" min={0} value={points} onChange={(e) => setPoints(Math.max(0, Number(e.target.value) || 0))} />
        </Field>
      )}
      <Field label="Ghi chú">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Dị ứng, sở thích, ngày sinh..." />
      </Field>
    </Modal>
  );
}
