import { useState } from 'react';
import { formatPrice } from '../../../shared/format.ts';
import { api, errorText } from '../api.ts';
import { useData } from '../context.ts';
import { Button, Card, Field, MoneyInput, PageHeader, Table, Textarea } from '../components/ui.tsx';
import { formatDateTime } from '../dates.ts';

export function CashShiftPage() {
  const [data, reload] = useData(api.cashShifts);
  const [openingCash, setOpeningCash] = useState(0);
  const [counted, setCounted] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      reload();
    } catch (err) {
      alert(errorText(err));
    }
    setBusy(false);
  };

  const current = data?.current;
  const diff = current ? counted - current.expectedCash : 0;

  return (
    <div className="max-w-4xl">
      <PageHeader title="Ca thu ngân" />
      <Card className="mb-6">
        {!current ? (
          <div className="space-y-3 max-w-sm">
            <p className="text-gray-600">Chưa có ca nào đang mở. Đếm tiền đầu ca trong két rồi mở ca.</p>
            <Field label="Tiền đầu ca">
              <MoneyInput value={openingCash} onChange={setOpeningCash} />
            </Field>
            <Button disabled={busy} onClick={() => act(() => api.openShift(openingCash))}>
              Mở ca
            </Button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <p>
                Ca của <b>{current.staffName}</b> · mở lúc {formatDateTime(current.openedAt)}
              </p>
              <p>Tiền đầu ca: {formatPrice(current.openingCash)}</p>
              <p>Thu tiền mặt trong ca: {formatPrice(current.cashSales)}</p>
              <p className="text-xl">
                Tiền mặt phải có: <b>{formatPrice(current.expectedCash)}</b>
              </p>
              <p className="text-sm text-gray-500">Chuyển khoản và thẻ không tính vào két.</p>
            </div>
            <div className="space-y-3">
              <Field label="Tiền mặt đếm được">
                <MoneyInput value={counted} onChange={setCounted} />
              </Field>
              {counted > 0 && (
                <p className={diff === 0 ? 'text-green-700' : 'text-red-600'}>
                  {diff === 0 ? 'Khớp.' : diff > 0 ? `Thừa ${formatPrice(diff)}` : `Thiếu ${formatPrice(-diff)}`}
                </p>
              )}
              <Textarea placeholder="Ghi chú (lý do chênh lệch...)" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button
                disabled={busy}
                onClick={() => {
                  if (confirm(`Chốt ca với ${formatPrice(counted)} tiền mặt?`)) act(() => api.closeShift(counted, note));
                }}
              >
                Chốt ca
              </Button>
            </div>
          </div>
        )}
      </Card>

      <h2 className="font-bold text-gray-700 mb-2">Lịch sử ca</h2>
      <Table head={['Mở ca', 'Người mở', 'Đầu ca', 'Thu TM', 'Phải có', 'Đếm được', 'Chênh lệch', 'Chốt bởi', 'Ghi chú']}>
        {data?.history.map((s) => (
          <tr key={s.id}>
            <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(s.openedAt)}</td>
            <td className="px-3 py-2">{s.staffName}</td>
            <td className="px-3 py-2">{formatPrice(s.openingCash)}</td>
            <td className="px-3 py-2">{formatPrice(s.cashSales)}</td>
            <td className="px-3 py-2">{formatPrice(s.expectedCash)}</td>
            <td className="px-3 py-2">{s.countedCash === null ? 'Đang mở' : formatPrice(s.countedCash)}</td>
            <td
              className={`px-3 py-2 font-semibold ${
                s.countedCash === null ? '' : s.countedCash === s.expectedCash ? 'text-green-700' : 'text-red-600'
              }`}
            >
              {s.countedCash === null ? '' : formatPrice(s.countedCash - s.expectedCash)}
            </td>
            <td className="px-3 py-2">{s.closedByName ?? ''}</td>
            <td className="px-3 py-2 text-gray-600">{s.note}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
