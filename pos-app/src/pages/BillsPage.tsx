import { useState } from 'react';
import { formatPrice, formatTime } from '../../../shared/format.ts';
import type { BillSummary, InvoiceInfo } from '../../../shared/types.ts';
import { api, errorText, paymentLabels, run } from '../api.ts';
import { useApp, useCan, useData, useOperations } from '../context.ts';
import { Badge, Button, DateRange, Empty, Input, Modal, PageHeader, Table } from '../components/ui.tsx';
import { useDateRange } from '../dates.ts';

export function InvoiceBadge({ invoice }: { invoice: InvoiceInfo | null }) {
  if (!invoice) return <span className="text-gray-400">—</span>;
  if (invoice.status === 'issued') return <Badge color="green">{invoice.invoiceNo}</Badge>;
  if (invoice.status === 'failed') return <Badge color="red">Lỗi</Badge>;
  if (invoice.status === 'cancelled') return <Badge>Đã hủy{invoice.invoiceNo ? ` ${invoice.invoiceNo}` : ''}</Badge>;
  return <Badge color="amber">Đang gửi</Badge>;
}


export function BillsPage() {
  const { config } = useApp();
  const [range, setRange] = useDateRange();
  const [bills, reload] = useData(() => api.bills(range.from, range.to), [range.from, range.to]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [search, setSearch] = useState('');

  const filtered = (bills ?? []).filter((b) =>
    `${b.id} ${b.tableName} ${b.customer?.phone ?? ''} ${b.customer?.name ?? ''} ${b.invoice?.invoiceNo ?? ''}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const valid = filtered.filter((b) => !b.voided);
  const total = valid.reduce((sum, b) => sum + b.total, 0);
  const voidedCount = filtered.length - valid.length;
  const failed = (bills ?? []).filter((b) => b.invoice && (b.invoice.status === 'failed' || b.invoice.status === 'pending')).length;

  return (
    <div>
      <PageHeader title="Hóa đơn đã thanh toán">
        {config?.invoiceEnabled && failed > 0 && (
          <Button variant="danger" onClick={() => run(api.retryInvoices).then(reload)}>
            Gửi lại {failed} HĐĐT lỗi
          </Button>
        )}
      </PageHeader>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <DateRange value={range} onChange={setRange} />
        <Input className="max-w-xs" placeholder="Tìm mã HĐ, bàn, SĐT, số HĐĐT..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <p className="mb-2 text-gray-600">
        {valid.length} hóa đơn · <b className="text-red-600">{formatPrice(total)}</b>
        {voidedCount > 0 && <span className="text-gray-500"> · {voidedCount} hóa đơn đã hủy (không tính)</span>}
      </p>
      {bills && filtered.length === 0 ? (
        <Empty>Không có hóa đơn.</Empty>
      ) : (
        <Table head={['Mã', 'Giờ', 'Bàn', 'Khách', 'Giảm', 'Thành tiền', 'Hình thức', 'Thu ngân', 'HĐĐT']}>
          {filtered.map((b) => (
            <tr
              key={b.id}
              className={`hover:bg-gray-50 cursor-pointer ${b.voided ? 'text-gray-400 line-through' : ''}`}
              onClick={() => setOpenId(b.id)}
            >
              <td className="px-3 py-2 font-mono whitespace-nowrap">
                #{b.id} {b.voided && <span className="no-underline inline-block"><Badge color="red">Đã hủy</Badge></span>}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {new Date(b.closedAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} {formatTime(b.closedAt)}
              </td>
              <td className="px-3 py-2">{b.tableName}</td>
              <td className="px-3 py-2">{b.customer ? `${b.customer.name || ''} ${b.customer.phone}` : '—'}</td>
              <td className="px-3 py-2 text-green-700">{b.discountAmount ? `−${formatPrice(b.discountAmount)}` : ''}</td>
              <td className="px-3 py-2 font-semibold">{formatPrice(b.total)}</td>
              <td className="px-3 py-2">{paymentLabels[b.paymentMethod]}</td>
              <td className="px-3 py-2">{b.cashier ?? (b.paymentMethod === 'transfer' ? 'Tự động (CK)' : '—')}</td>
              <td className="px-3 py-2">
                <InvoiceBadge invoice={b.invoice} />
              </td>
            </tr>
          ))}
        </Table>
      )}
      {openId !== null && (
        <BillDialog
          billId={openId}
          summary={bills?.find((b) => b.id === openId)}
          onClose={() => {
            setOpenId(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function BillDialog({ billId, summary, onClose }: { billId: number; summary?: BillSummary; onClose: () => void }) {
  const { config } = useApp();
  const can = useCan();
  const [bill, reload] = useData(() => api.bill(billId), [billId]);
  const [voidOpen, setVoidOpen] = useState(false);
  const { voidReasons } = useOperations();
  const [voidReason, setVoidReason] = useState(voidReasons[0] ?? '');
  const [buyerOpen, setBuyerOpen] = useState(false);
  const [buyer, setBuyer] = useState({ companyName: '', taxCode: '', address: '', email: '' });
  const [busy, setBusy] = useState(false);

  const issue = async (withBuyer: boolean) => {
    setBusy(true);
    try {
      const info = await api.issueInvoice(billId, withBuyer ? buyer : undefined);
      if (info.status !== 'issued') alert(`Xuất hóa đơn lỗi: ${info.error}`);
      setBuyerOpen(false);
      reload();
    } catch (err) {
      alert(errorText(err));
    }
    setBusy(false);
  };

  const voidBill = async () => {
    if (!bill || !confirm(`Hủy hóa đơn #${billId} (${formatPrice(bill.total)})? Thao tác này không hoàn tác được.`)) return;
    setBusy(true);
    try {
      const result = await api.voidBill(billId, voidReason);
      if (result.invoice?.error) alert(result.invoice.error);
      setVoidOpen(false);
      reload();
    } catch (err) {
      alert(errorText(err));
    }
    setBusy(false);
  };

  const invoice = bill?.invoice ?? summary?.invoice ?? null;
  const voided = bill?.voided ?? summary?.voided ?? null;
  return (
    <Modal
      title={`Hóa đơn #${billId} · ${summary?.tableName ?? ''}`}
      onClose={onClose}
      footer={
        <>
          {!voided && can('voidBills') && (
            <Button variant="danger" className="mr-auto" disabled={busy} onClick={() => setVoidOpen(!voidOpen)}>
              Hủy hóa đơn
            </Button>
          )}
          {!voided && config?.invoiceEnabled && invoice?.status !== 'issued' && invoice?.status !== 'cancelled' && (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setBuyerOpen(!buyerOpen)}>
                HĐ công ty
              </Button>
              <Button variant="dark" disabled={busy} onClick={() => issue(false)}>
                {invoice ? 'Gửi lại HĐĐT' : 'Xuất HĐĐT'}
              </Button>
            </>
          )}
          <Button onClick={() => run(() => api.reprintBill(billId)).then((ok) => ok && alert('Đã gửi lệnh in.'))}>🖨 In lại</Button>
        </>
      }
    >
      {!bill ? (
        <p>Đang tải...</p>
      ) : (
        <>
          {voided && (
            <div className="bg-red-50 text-red-800 rounded-xl p-3">
              <b>Đã hủy</b> lúc {new Date(voided.at).toLocaleString('vi-VN')}
              {voided.by && ` bởi ${voided.by}`} · Lý do: {voided.reason}
            </div>
          )}
          {voidOpen && (
            <div className="border-2 border-red-300 rounded-xl p-3 space-y-2">
              <p className="text-sm">
                Hủy hóa đơn sẽ: hoàn lại nguyên liệu vào kho, trả lại điểm và lượt dùng mã cho khách, ghi khoản hoàn tiền{' '}
                <b>{formatPrice(bill.total)}</b> ({paymentLabels[bill.paymentMethod]}) vào ca thu ngân, không tính vào doanh thu và
                hủy hóa đơn điện tử (nếu có).
              </p>
              <div className="flex flex-wrap gap-2">
                {voidReasons.map((r) => (
                  <button
                    key={r}
                    onClick={() => setVoidReason(r)}
                    className={`text-sm px-3 py-1.5 rounded-lg border ${voidReason === r ? 'border-red-600 bg-red-50 text-red-700' : ''}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Lý do hủy" maxLength={200} />
              <Button disabled={busy || !voidReason.trim()} onClick={voidBill}>
                Xác nhận hủy hóa đơn
              </Button>
            </div>
          )}
          <p className="text-sm text-gray-600">
            Vào {formatTime(bill.openedAt)} · Thanh toán {new Date(bill.closedAt).toLocaleString('vi-VN')} ·{' '}
            {paymentLabels[bill.paymentMethod]} · Thu ngân: {bill.cashier ?? (bill.paymentMethod === 'transfer' ? 'Tự động (CK)' : '—')}
          </p>
          <div className="border rounded-xl divide-y">
            {bill.orders.flatMap((o) =>
              o.items.map((i) => (
                <div
                  key={i.id}
                  className={`flex justify-between px-3 py-1.5 ${i.cancelled || o.status === 'cancelled' ? 'line-through text-gray-400' : ''}`}
                >
                  <span>
                    {i.quantity}× {i.name.vi}
                  </span>
                  <span>{formatPrice(i.price * i.quantity)}</span>
                </div>
              )),
            )}
          </div>
          <div className="space-y-1">
            <div className="flex justify-between">
              <span>Tạm tính</span>
              <span>{formatPrice(bill.subtotal)}</span>
            </div>
            {bill.discountAmount > 0 && (
              <div className="flex justify-between text-green-700">
                <span>{bill.discountNote || 'Giảm giá'}</span>
                <span>−{formatPrice(bill.discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg">
              <span>Thành tiền</span>
              <span className="text-red-600">{formatPrice(bill.total)}</span>
            </div>
            {bill.customer && (
              <p className="text-sm">
                Khách: {bill.customer.name} {bill.customer.phone} · dùng {bill.pointsUsed} điểm · cộng {bill.pointsEarned} điểm
              </p>
            )}
          </div>
          {invoice && (
            <div className="bg-gray-50 rounded-xl p-3 text-sm">
              <b>Hóa đơn điện tử:</b> <InvoiceBadge invoice={invoice} />
              {invoice.lookupCode && <div>Mã tra cứu: {invoice.lookupCode}</div>}
              {invoice.error && <div className="text-red-600">Lỗi: {invoice.error}</div>}
            </div>
          )}
          {buyerOpen && (
            <div className="border rounded-xl p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Mã số thuế" value={buyer.taxCode} onChange={(e) => setBuyer({ ...buyer, taxCode: e.target.value })} />
                <Input placeholder="Email" value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} />
              </div>
              <Input placeholder="Tên công ty" value={buyer.companyName} onChange={(e) => setBuyer({ ...buyer, companyName: e.target.value })} />
              <Input placeholder="Địa chỉ" value={buyer.address} onChange={(e) => setBuyer({ ...buyer, address: e.target.value })} />
              <Button disabled={busy} onClick={() => issue(true)}>
                Xuất hóa đơn cho công ty
              </Button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
