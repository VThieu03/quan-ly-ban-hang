import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { formatPrice } from '../../../shared/format.ts';
import { BANKS } from '../../../shared/banks.ts';
import type { CheckoutBreakdown, CheckoutRequest, CheckoutResult, Customer, PaymentMethod, StaffTable } from '../../../shared/types.ts';
import { api, errorText, paymentLabels } from '../api.ts';
import type { TransferInfo } from '../api.ts';
import { useApp } from '../context.ts';
import { Badge, Button, Field, Input, Modal, MoneyInput, NumberInput } from './ui.tsx';

type Props = { table: StaffTable; onClose: () => void };

export function CheckoutDialog({ table, onClose }: Props) {
  const { config } = useApp();
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [discountValue, setDiscountValue] = useState(0);
  const [discountNote, setDiscountNote] = useState('');
  const [voucherCode, setVoucherCode] = useState('');
  const [phone, setPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [usePoints, setUsePoints] = useState(0);
  const [wantInvoice, setWantInvoice] = useState(false);
  const [buyer, setBuyer] = useState({ companyName: '', taxCode: '', address: '', email: '' });
  const [cashGiven, setCashGiven] = useState(0);

  const [breakdown, setBreakdown] = useState<CheckoutBreakdown | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<(TransferInfo & { qrImage: string }) | null>(null);
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [busy, setBusy] = useState(false);

  const request: CheckoutRequest = {
    paymentMethod: method,
    discount: discountValue ? { type: discountType, value: discountValue, note: discountNote } : null,
    voucherCode: voucherCode.trim() || null,
    customerPhone: phone.trim() || null,
    customerName: customerName.trim() || null,
    usePoints,
    buyer: wantInvoice ? buyer : null,
  };
  const requestKey = JSON.stringify({ ...request, buyer: null });

  // Xem trước số tiền mỗi khi thay đổi giảm giá / mã / khách hàng.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api.previewCheckout(table.id, JSON.parse(requestKey)).then(
        (b) => {
          if (cancelled) return;
          setBreakdown(b);
          setPreviewError(null);
        },
        (err) => !cancelled && setPreviewError(errorText(err)),
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [table.id, requestKey, table.session?.total]);

  // Webhook ngân hàng chốt bill → bàn đóng trong lúc đang hiện mã QR.
  const paidByTransfer = transfer !== null && !table.session && !result;

  const lookup = async () => {
    if (!phone.trim()) {
      setCustomer(null);
      return;
    }
    try {
      const found = await api.lookupCustomer(phone.trim());
      setCustomer(found);
      if (found?.name) setCustomerName(found.name);
    } catch {
      setCustomer(null);
    }
  };

  const showQr = async () => {
    setBusy(true);
    try {
      const info = await api.prepareTransfer(table.id, request);
      setTransfer({ ...info, qrImage: await QRCode.toDataURL(info.qrPayload, { width: 300, margin: 1 }) });
    } catch (err) {
      alert(errorText(err));
    }
    setBusy(false);
  };

  const closeQr = () => {
    api.cancelTransfer(table.id).catch(() => {});
    setTransfer(null);
  };

  const confirm = async () => {
    setBusy(true);
    try {
      setResult(await api.checkout(table.id, request));
      setTransfer(null);
    } catch (err) {
      alert(errorText(err));
    }
    setBusy(false);
  };

  if (result || paidByTransfer) {
    return (
      <Modal title="Đã thanh toán" onClose={onClose} footer={<Button onClick={onClose}>Xong</Button>}>
        <div className="text-center space-y-2">
          <div className="text-6xl">✅</div>
          <p className="text-xl font-bold">
            {table.name} · {result ? formatPrice(result.total) : 'Đã nhận chuyển khoản'}
          </p>
          {result?.invoice && (
            <p>
              Hóa đơn điện tử:{' '}
              {result.invoice.status === 'issued' ? (
                <Badge color="green">Số {result.invoice.invoiceNo}</Badge>
              ) : (
                <Badge color="red">Lỗi – sẽ tự gửi lại ({result.invoice.error})</Badge>
              )}
            </p>
          )}
          {method === 'cash' && result && cashGiven > result.total && (
            <p className="text-lg">
              Tiền thối: <b className="text-red-600">{formatPrice(cashGiven - result.total)}</b>
            </p>
          )}
        </div>
      </Modal>
    );
  }

  if (transfer) {
    const bankName = BANKS.find((b) => b.bin === transfer.bank.bin)?.name ?? transfer.bank.bin;
    return (
      <Modal
        title={`Chuyển khoản – ${table.name}`}
        onClose={closeQr}
        footer={
          <>
            <Button variant="secondary" onClick={closeQr}>
              Quay lại
            </Button>
            <Button variant="success" disabled={busy} onClick={confirm}>
              Đã nhận tiền (xác nhận tay)
            </Button>
          </>
        }
      >
        <div className="text-center space-y-2">
          <img src={transfer.qrImage} alt="VietQR" className="mx-auto w-64" />
          <p className="text-3xl font-bold text-red-600">{formatPrice(transfer.breakdown.total)}</p>
          <p>
            {bankName} · <b>{transfer.bank.accountNumber}</b> · {transfer.bank.accountName}
          </p>
          <p>
            Nội dung: <b className="font-mono">{transfer.breakdown.transferCode}</b>
          </p>
          <p className="text-sm text-gray-500 animate-pulse">Đang chờ tiền về… bill sẽ tự đóng khi ngân hàng báo có.</p>
        </div>
      </Modal>
    );
  }

  const b = breakdown;
  return (
    <Modal
      wide
      title={`Thanh toán – ${table.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          {method === 'transfer' && config?.bankConfigured && (
            <Button variant="dark" disabled={busy || !b || Boolean(previewError)} onClick={showQr}>
              Hiện mã QR
            </Button>
          )}
          <Button disabled={busy || !b || Boolean(previewError)} onClick={confirm}>
            {method === 'transfer' ? 'Xác nhận đã nhận tiền' : `Thu ${b ? formatPrice(b.total) : ''}`}
          </Button>
        </>
      }
    >
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <Field label="Hình thức thanh toán">
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(paymentLabels) as PaymentMethod[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMethod(m)}
                  className={`py-2 rounded-lg font-semibold border-2 ${method === m ? 'border-red-600 bg-red-50 text-red-700' : ''}`}
                >
                  {paymentLabels[m]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Giảm giá">
            <div className="flex gap-2">
              <MoneyInput value={discountValue} onChange={setDiscountValue} placeholder="0" />
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as 'amount' | 'percent')}
                className="border rounded-lg px-2"
              >
                <option value="amount">đ</option>
                <option value="percent">%</option>
              </select>
            </div>
            {discountValue > 0 && (
              <Input className="mt-2" placeholder="Lý do giảm (bắt buộc nên ghi)" value={discountNote} onChange={(e) => setDiscountNote(e.target.value)} />
            )}
          </Field>

          <Field label="Mã khuyến mãi">
            <Input value={voucherCode} onChange={(e) => setVoucherCode(e.target.value.toUpperCase())} placeholder="VD: GIAM10" />
          </Field>

          <Field label="Khách hàng thành viên (SĐT)">
            <div className="flex gap-2">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={lookup} placeholder="09xx..." inputMode="tel" />
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Tên khách" />
            </div>
            {phone.trim() && (
              <p className="text-sm mt-1">
                {customer ? (
                  <>
                    Khách quen · <b>{customer.points}</b> điểm · đã chi {formatPrice(customer.totalSpent)} ({customer.visits} lần)
                  </>
                ) : (
                  <span className="text-gray-500">Khách mới – sẽ được tạo khi thanh toán.</span>
                )}
              </p>
            )}
            {customer && customer.points > 0 && config?.loyalty.enabled && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-sm whitespace-nowrap">Dùng điểm:</span>
                <NumberInput
                  value={usePoints}
                  onChange={(n) => setUsePoints(Math.min(customer.points, Math.max(0, n)))}
                  className="w-28"
                />
                <Button variant="ghost" className="text-sm" onClick={() => setUsePoints(customer.points)}>
                  Dùng hết
                </Button>
              </div>
            )}
          </Field>

          {config?.invoiceEnabled && (
            <div>
              <label className="flex items-center gap-2 font-semibold">
                <input type="checkbox" checked={wantInvoice} onChange={(e) => setWantInvoice(e.target.checked)} />
                Xuất hóa đơn công ty
              </label>
              {wantInvoice && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <Input placeholder="Mã số thuế" value={buyer.taxCode} onChange={(e) => setBuyer({ ...buyer, taxCode: e.target.value })} />
                  <Input placeholder="Email nhận HĐ" value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} />
                  <Input
                    className="col-span-2"
                    placeholder="Tên công ty"
                    value={buyer.companyName}
                    onChange={(e) => setBuyer({ ...buyer, companyName: e.target.value })}
                  />
                  <Input
                    className="col-span-2"
                    placeholder="Địa chỉ"
                    value={buyer.address}
                    onChange={(e) => setBuyer({ ...buyer, address: e.target.value })}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="bg-gray-50 rounded-xl p-4 space-y-2 self-start">
          {previewError && <p className="text-red-600 bg-red-50 rounded-lg p-2">{previewError}</p>}
          {b && (
            <>
              <Row label="Tạm tính" value={b.subtotal} />
              {b.manualDiscount > 0 && <Row label="Giảm giá" value={-b.manualDiscount} />}
              {b.voucher && <Row label={`Mã ${b.voucher.code}`} value={-b.voucher.discount} />}
              {b.pointsDiscount > 0 && <Row label={`Dùng ${b.pointsUsed} điểm`} value={-b.pointsDiscount} />}
              <div className="border-t pt-2 flex justify-between items-baseline">
                <span className="font-bold text-lg">Khách trả</span>
                <span className="text-3xl font-bold text-red-600">{formatPrice(b.total)}</span>
              </div>
              {b.vatRate > 0 && (
                <p className="text-xs text-gray-500 text-right">
                  Đã gồm VAT {b.vatRate}%: {formatPrice(b.vatAmount)}
                </p>
              )}
              {b.pointsEarned > 0 && <p className="text-sm text-green-700">Khách được cộng {b.pointsEarned} điểm.</p>}
              {method === 'cash' && (
                <div className="pt-3 space-y-2">
                  <Field label="Khách đưa">
                    <MoneyInput value={cashGiven} onChange={setCashGiven} />
                  </Field>
                  <div className="flex flex-wrap gap-1">
                    {[b.total, 100_000, 200_000, 500_000, 1_000_000, 2_000_000]
                      .filter((v, i, arr) => v >= b.total && arr.indexOf(v) === i)
                      .slice(0, 5)
                      .map((v) => (
                        <button key={v} className="text-sm px-2 py-1 rounded bg-white border" onClick={() => setCashGiven(v)}>
                          {formatPrice(v)}
                        </button>
                      ))}
                  </div>
                  {cashGiven > 0 && (
                    <p className="text-lg">
                      Tiền thối:{' '}
                      <b className={cashGiven >= b.total ? 'text-green-700' : 'text-red-600'}>
                        {cashGiven >= b.total ? formatPrice(cashGiven - b.total) : `thiếu ${formatPrice(b.total - cashGiven)}`}
                      </b>
                    </p>
                  )}
                </div>
              )}
              {method === 'transfer' && !config?.bankConfigured && (
                <p className="text-sm text-amber-700">Chưa cài tài khoản ngân hàng nên không hiện được mã QR (Cài đặt → Thanh toán).</p>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-600">{label}</span>
      <span className={value < 0 ? 'text-green-700' : ''}>
        {value < 0 ? '−' : ''}
        {formatPrice(Math.abs(value))}
      </span>
    </div>
  );
}
