import { useEffect, useState } from 'react';
import { formatPrice, formatTime } from '../../../shared/format.ts';
import type { OrderItem, OrderStatus, StaffTable } from '../../../shared/types.ts';
import { api, ApiRequestError, errorText, run, statusLabels } from '../api.ts';
import { useCan } from '../context.ts';
import { BillPrint } from './BillPrint.tsx';
import { CheckoutDialog } from './CheckoutDialog.tsx';
import { CancelItemDialog, MoveDialog, OpenTableDialog, OrderDialog } from './TableDialogs.tsx';
import { Badge, Button } from './ui.tsx';

const STATUS_FLOW: OrderStatus[] = ['new', 'preparing', 'served'];

type Dialog = 'open' | 'order' | 'move' | 'checkout' | { cancel: OrderItem } | null;

type Props = {
  table: StaffTable;
  tables: StaffTable[];
  onClose: () => void;
};

export function TableDetail({ table, tables, onClose }: Props) {
  const can = useCan();
  const [dialog, setDialog] = useState<Dialog>(null);
  // In bằng trình duyệt khi chưa cài máy in hóa đơn: đặt giờ in rồi gọi print() sau khi render.
  const [printedAt, setPrintedAt] = useState<Date | null>(null);
  const session = table.session;

  useEffect(() => {
    if (printedAt) window.print();
  }, [printedAt]);

  const printBill = async () => {
    try {
      await api.printBill(table.id);
      alert('Đã gửi hóa đơn tạm tính tới máy in.');
    } catch (err) {
      if (err instanceof ApiRequestError && err.message === 'no_receipt_printer') setPrintedAt(new Date());
      else alert(errorText(err));
    }
  };

  const pending = session?.orders.filter((o) => o.status === 'new' || o.status === 'preparing').length ?? 0;

  return (
    <div className="bg-white rounded-2xl shadow-lg flex flex-col max-h-[calc(100dvh-7rem)] overflow-hidden">
      <div className="p-4 border-b flex justify-between items-start gap-2 print:hidden">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold text-gray-800">
            {table.name} {table.area && <span className="text-base font-normal text-gray-500">· {table.area}</span>}
          </h2>
          {session ? (
            <p className="text-gray-500">
              Mở lúc {formatTime(session.openedAt)}
              {session.guestCount ? ` · ${session.guestCount} khách` : ''}
            </p>
          ) : (
            <p className="text-gray-500">Bàn trống</p>
          )}
          <div className="flex flex-wrap gap-1">
            {session?.billRequestedAt && <Badge color="amber">🧾 Gọi thanh toán lúc {formatTime(session.billRequestedAt)}</Badge>}
            {session?.pendingPayment && (
              <Badge color="blue">⏳ Chờ chuyển khoản {formatPrice(session.pendingPayment.total)}</Badge>
            )}
            {table.nextReservation && (
              <Badge color="blue">
                📅 {formatTime(table.nextReservation.reservedAt)} {table.nextReservation.customerName} ({table.nextReservation.partySize})
              </Badge>
            )}
          </div>
        </div>
        <button onClick={onClose} className="text-2xl text-gray-400 hover:text-gray-700 w-10 h-10" aria-label="Đóng">
          ×
        </button>
      </div>

      {!session ? (
        <div className="p-6 print:hidden">
          {can('tables') ? (
            <Button variant="success" className="w-full text-xl py-4" onClick={() => setDialog('open')}>
              Mở bàn
            </Button>
          ) : (
            <p className="text-gray-500">Bàn trống.</p>
          )}
          <p className="text-gray-500 text-sm mt-3">Sau khi mở bàn, khách quét mã QR trên bàn để tự gọi món.</p>
        </div>
      ) : (
        <>
          {can('tables') && (
            <div className="px-4 py-2 border-b flex flex-wrap gap-2 print:hidden">
              <Button onClick={() => setDialog('order')}>+ Gọi món</Button>
              <Button variant="secondary" onClick={() => setDialog('move')}>
                ⇄ Chuyển / Gộp / Tách
              </Button>
              <Button variant="secondary" onClick={printBill}>
                🖨 In tạm tính
              </Button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4 space-y-3 print:hidden">
            {session.orders.length === 0 && <p className="text-gray-500 text-center py-6">Chưa gọi món nào.</p>}
            {session.orders.map((order, i) => (
              <div
                key={order.id}
                className={`border rounded-xl p-3 ${order.status === 'cancelled' ? 'opacity-50' : ''} ${
                  order.status === 'new' ? 'border-blue-400 bg-blue-50' : 'border-gray-200'
                }`}
              >
                <div className="flex justify-between items-center mb-2">
                  <span className="font-bold">
                    Lần #{i + 1} · {formatTime(order.createdAt)}{' '}
                    <span className="text-xs font-normal text-gray-500">{order.source === 'staff' ? '(NV gọi)' : '(QR)'}</span>
                  </span>
                  <span className="font-semibold text-red-600">{formatPrice(order.total)}</span>
                </div>
                <ul className="space-y-1">
                  {order.items.map((item) => (
                    <li key={item.id} className="flex justify-between items-center gap-2">
                      <span className={item.cancelled ? 'line-through text-gray-400' : ''}>
                        {item.quantity}× {item.name.vi}
                        {item.cancelled && item.cancelReason && <span className="text-xs"> ({item.cancelReason})</span>}
                      </span>
                      {!item.cancelled && order.status !== 'cancelled' && can('tables') && (
                        <button
                          onClick={() => setDialog({ cancel: item })}
                          className="text-xs text-gray-500 hover:text-red-600 border rounded px-2 py-0.5"
                        >
                          Hủy món
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {order.note && <p className="text-sm italic text-gray-600 mt-2">Ghi chú: “{order.note}”</p>}
                {order.status === 'cancelled' ? (
                  <p className="text-sm font-semibold text-gray-500 mt-2">Đã hủy</p>
                ) : (
                  can('tables') && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {STATUS_FLOW.map((s) => (
                        <button
                          key={s}
                          disabled={order.status === s}
                          onClick={() => run(() => api.setOrderStatus(order.id, s))}
                          className={`text-xs font-semibold px-2 py-1 rounded-lg border ${
                            order.status === s ? 'bg-gray-800 text-white border-gray-800' : 'hover:bg-gray-100'
                          }`}
                        >
                          {statusLabels[s]}
                        </button>
                      ))}
                      <button
                        onClick={() => {
                          if (confirm(`Hủy cả lần gọi #${i + 1}?`)) run(() => api.setOrderStatus(order.id, 'cancelled'));
                        }}
                        className="text-xs font-semibold px-2 py-1 rounded-lg border text-red-600 hover:bg-red-50 ml-auto"
                      >
                        Hủy đơn
                      </button>
                    </div>
                  )
                )}
              </div>
            ))}
          </div>

          <div className="p-4 border-t space-y-3 print:hidden">
            {pending > 0 && <p className="text-sm text-amber-700">⚠ Còn {pending} lần gọi chưa lên món.</p>}
            <div className="flex justify-between items-center">
              <span className="text-lg font-bold text-gray-700">Tạm tính</span>
              <span className="text-3xl font-bold text-red-600">{formatPrice(session.total)}</span>
            </div>
            {can('checkout') && (
              <Button className="w-full text-xl py-3" onClick={() => setDialog('checkout')}>
                Thanh toán
              </Button>
            )}
          </div>
          {printedAt && <BillPrint table={table} session={session} printedAt={printedAt} />}
        </>
      )}

      {dialog === 'open' && <OpenTableDialog table={table} onClose={() => setDialog(null)} />}
      {dialog === 'order' && <OrderDialog table={table} onClose={() => setDialog(null)} />}
      {dialog === 'move' && <MoveDialog table={table} tables={tables} onClose={() => setDialog(null)} />}
      {dialog === 'checkout' && <CheckoutDialog table={table} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && <CancelItemDialog item={dialog.cancel} onClose={() => setDialog(null)} />}
    </div>
  );
}
