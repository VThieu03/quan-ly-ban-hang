import { useState } from 'react';
import type { Reservation, ReservationStatus } from '../../../shared/types.ts';
import { api, run } from '../api.ts';
import { useData } from '../context.ts';
import { Badge, Button, DateRange, Empty, Field, Input, Modal, NumberInput, PageHeader, Select, Table, Textarea } from '../components/ui.tsx';
import { shiftDate, today, useDateRange } from '../dates.ts';

const STATUS: Record<ReservationStatus, { label: string; color: 'blue' | 'green' | 'gray' | 'red' }> = {
  booked: { label: 'Đã đặt', color: 'blue' },
  seated: { label: 'Đã đến', color: 'green' },
  cancelled: { label: 'Đã hủy', color: 'gray' },
  no_show: { label: 'Không đến', color: 'red' },
};

function toLocalInput(iso: string) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function ReservationsPage() {
  const [range, setRange] = useDateRange();
  const next7 = { from: today(), to: shiftDate(6) };
  const [list, reload] = useData(() => api.reservations(range.from, range.to), [range.from, range.to]);
  const [editing, setEditing] = useState<Reservation | 'new' | null>(null);

  const setStatus = (r: Reservation, status: ReservationStatus) => run(() => api.updateReservation(r.id, { status })).then(reload);

  return (
    <div>
      <PageHeader title="Đặt bàn">
        <Button onClick={() => setEditing('new')}>+ Thêm lịch đặt</Button>
      </PageHeader>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <DateRange value={range} onChange={setRange} />
        <button
          className={`text-sm px-3 py-1.5 rounded-lg border ${
            range.from === next7.from && range.to === next7.to ? 'bg-gray-800 text-white' : 'bg-white'
          }`}
          onClick={() => setRange(next7)}
        >
          7 ngày tới
        </button>
      </div>
      {list && list.length === 0 ? (
        <Empty>Không có lịch đặt nào.</Empty>
      ) : (
        <Table head={['Thời gian', 'Khách', 'SĐT', 'Số người', 'Bàn', 'Ghi chú', 'Trạng thái', '']}>
          {list?.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2 whitespace-nowrap font-semibold">
                {new Date(r.reservedAt).toLocaleString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </td>
              <td className="px-3 py-2">{r.customerName}</td>
              <td className="px-3 py-2">{r.phone}</td>
              <td className="px-3 py-2">{r.partySize}</td>
              <td className="px-3 py-2">{r.tableName ?? '—'}</td>
              <td className="px-3 py-2 text-gray-600">{r.note}</td>
              <td className="px-3 py-2">
                <Badge color={STATUS[r.status].color}>{STATUS[r.status].label}</Badge>
              </td>
              <td className="px-3 py-2 whitespace-nowrap space-x-1">
                {r.status === 'booked' && (
                  <>
                    <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => setEditing(r)}>
                      Sửa
                    </Button>
                    <Button variant="ghost" className="text-sm px-2 py-1" onClick={() => setStatus(r, 'no_show')}>
                      Không đến
                    </Button>
                    <Button variant="ghost" className="text-sm px-2 py-1 text-red-600" onClick={() => setStatus(r, 'cancelled')}>
                      Hủy
                    </Button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <p className="text-sm text-gray-500 mt-3">
        Lịch đặt có gán bàn sẽ hiện trên Sơ đồ bàn trong vòng 3 tiếng trước giờ đến. Khi khách tới, mở bàn và chọn lịch đặt để
        đánh dấu "Đã đến".
      </p>
      {editing && (
        <ReservationDialog
          reservation={editing === 'new' ? null : editing}
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

function ReservationDialog({
  reservation,
  onClose,
  onSaved,
}: {
  reservation: Reservation | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tables] = useData(api.tables);
  const [form, setForm] = useState(() => ({
    customerName: reservation?.customerName ?? '',
    phone: reservation?.phone ?? '',
    partySize: reservation?.partySize ?? 2,
    reservedAt: toLocalInput(reservation?.reservedAt ?? new Date(Date.now() + 3600e3).toISOString()),
    tableId: reservation?.tableId ?? null,
    note: reservation?.note ?? '',
  }));

  const save = async () => {
    const body = { ...form, reservedAt: new Date(form.reservedAt).toISOString() };
    const ok = await run(() => (reservation ? api.updateReservation(reservation.id, body) : api.createReservation(body)));
    if (ok) onSaved();
  };

  return (
    <Modal
      title={reservation ? 'Sửa lịch đặt' : 'Thêm lịch đặt'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={!form.customerName || !form.reservedAt} onClick={save}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tên khách">
          <Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
        </Field>
        <Field label="Số điện thoại">
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
        </Field>
        <Field label="Thời gian">
          <Input type="datetime-local" value={form.reservedAt} onChange={(e) => setForm({ ...form, reservedAt: e.target.value })} />
        </Field>
        <Field label="Số người">
          <NumberInput value={form.partySize} onChange={(n) => setForm({ ...form, partySize: n })} />
        </Field>
      </div>
      <Field label="Giữ bàn (không bắt buộc)">
        <Select value={form.tableId ?? ''} onChange={(e) => setForm({ ...form, tableId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">— Chưa xếp bàn —</option>
          {tables?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.area ? ` (${t.area})` : ''}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Ghi chú">
        <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Sinh nhật, cần ghế em bé..." />
      </Field>
    </Modal>
  );
}
