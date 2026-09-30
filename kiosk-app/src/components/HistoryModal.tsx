import { formatPrice, formatTime } from '../../../shared/format.ts';
import type { Lang, OrderStatus, TableSession } from '../../../shared/types.ts';
import { statusTexts } from '../i18n.ts';
import type { Translate } from '../i18n.ts';

const statusStyles: Record<OrderStatus, string> = {
  new: 'bg-blue-100 text-blue-700',
  preparing: 'bg-amber-100 text-amber-700',
  served: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-200 text-gray-500',
};

type Props = {
  session: TableSession;
  lang: Lang;
  t: Translate;
  requestingBill: boolean;
  onRequestBill: () => void;
  onClose: () => void;
};

export function HistoryModal({ session, lang, t, requestingBill, onRequestBill, onClose }: Props) {
  // Server trả đơn theo thứ tự cũ → mới, hiển thị mới nhất lên đầu.
  const orders = session.orders.map((order, i) => ({ order, number: i + 1 })).reverse();

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end md:items-center justify-center z-50 md:p-4" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col w-full md:max-w-2xl max-h-[90dvh] md:max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 md:p-6 border-b border-gray-200 flex justify-between items-center bg-gray-50">
          <h2 className="text-xl md:text-2xl font-bold text-gray-800">{t('historyTitle')}</h2>
          <button
            onClick={onClose}
            aria-label={t('close')}
            className="text-gray-500 hover:text-gray-800 text-2xl font-bold w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-200 transition-colors"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
          {orders.length === 0 ? (
            <p className="text-center text-gray-500 py-10 text-lg">{t('historyEmpty')}</p>
          ) : (
            orders.map(({ order, number }) => (
              <div key={order.id} className="border border-gray-200 rounded-xl p-4 bg-white shadow-sm">
                <div className="flex justify-between items-center mb-3 border-b pb-2 gap-2">
                  <span className="font-bold text-lg text-gray-700">
                    {t('orderNumber')}
                    {number}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusStyles[order.status]}`}>
                      {statusTexts[order.status][lang]}
                    </span>
                    <span className="text-gray-500 font-medium">🕒 {formatTime(order.createdAt)}</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {order.items.map((item) => (
                    <div
                      key={item.id}
                      className={`flex justify-between items-center gap-2 ${
                        item.cancelled || order.status === 'cancelled' ? 'text-gray-400 line-through' : 'text-gray-600'
                      }`}
                    >
                      <span>
                        {item.quantity}× {item.name[lang]}
                      </span>
                      <span>{formatPrice(item.price * item.quantity)}</span>
                    </div>
                  ))}
                </div>
                {order.note && <p className="mt-2 text-sm text-gray-500 italic">“{order.note}”</p>}
              </div>
            ))
          )}
        </div>

        <div className="p-4 md:p-6 border-t border-gray-200 bg-white space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-lg md:text-xl font-bold text-gray-700">{t('subtotal')}:</span>
            <span className="text-2xl md:text-3xl font-bold text-red-600">{formatPrice(session.total)}</span>
          </div>
          {session.billRequestedAt ? (
            <p className="text-center bg-green-50 text-green-700 font-semibold rounded-xl p-4">
              ✅ {t('billRequested')}
            </p>
          ) : (
            <button
              onClick={onRequestBill}
              disabled={requestingBill || session.orders.length === 0}
              className="w-full bg-gray-800 hover:bg-gray-900 disabled:bg-gray-300 text-white py-4 rounded-xl font-bold text-xl transition-colors"
            >
              🧾 {t('requestBill')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
