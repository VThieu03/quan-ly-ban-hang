import { useEffect, useRef, useState } from 'react';
import { formatPrice, formatTime } from '../../../shared/format.ts';
import type { StaffTable } from '../../../shared/types.ts';
import { api, beep } from '../api.ts';
import { useData } from '../context.ts';
import { TableDetail } from '../components/TableDetail.tsx';

type Alerts = Map<number, { newOrders: number; billRequested: boolean }>;

function alertsOf(tables: StaffTable[]): Alerts {
  return new Map(
    tables.map((t) => [
      t.id,
      {
        newOrders: t.session?.orders.filter((o) => o.status === 'new').length ?? 0,
        billRequested: Boolean(t.session?.billRequestedAt),
      },
    ]),
  );
}

export function TablesPage() {
  const [tables] = useData(api.tables);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const prevAlerts = useRef<Alerts | null>(null);

  // Kêu "ting" khi có đơn mới hoặc bàn vừa gọi thanh toán.
  useEffect(() => {
    if (!tables) return;
    const alerts = alertsOf(tables);
    const prev = prevAlerts.current;
    if (prev) {
      const changed = [...alerts].some(([id, a]) => {
        const p = prev.get(id);
        return a.newOrders > (p?.newOrders ?? 0) || (a.billRequested && !p?.billRequested);
      });
      if (changed) beep();
    }
    prevAlerts.current = alerts;
  }, [tables]);

  if (!tables) return <p className="text-gray-500">Đang tải...</p>;

  const areas = [...new Set(tables.map((t) => t.area))];
  const selected = tables.find((t) => t.id === selectedId);
  const busy = tables.filter((t) => t.session).length;

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      <div className="flex-1 w-full print:hidden">
        <div className="flex flex-wrap gap-3 text-sm text-gray-600 mb-3">
          <span>
            <b>{busy}</b>/{tables.length} bàn có khách
          </span>
          <span>⬜ Trống</span>
          <span className="text-green-700">🟩 Đang phục vụ</span>
          <span className="text-amber-700">🟧 Gọi thanh toán</span>
          <span className="text-blue-700">🟦 Chờ chuyển khoản</span>
        </div>
        {areas.map((area) => (
          <section key={area} className="mb-5">
            {area && <h2 className="font-bold text-gray-700 mb-2">{area}</h2>}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
              {tables
                .filter((t) => t.area === area)
                .map((t) => {
                  const newOrders = t.session?.orders.filter((o) => o.status === 'new').length ?? 0;
                  const color = !t.session
                    ? 'bg-white border-gray-200'
                    : t.session.pendingPayment
                      ? 'bg-blue-50 border-blue-400'
                      : t.session.billRequestedAt
                        ? 'bg-amber-100 border-amber-400 animate-pulse'
                        : 'bg-green-50 border-green-400';
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSelectedId(t.id)}
                      className={`relative text-left rounded-2xl border-2 p-3 h-32 flex flex-col justify-between transition-shadow hover:shadow-md ${color} ${
                        selectedId === t.id ? 'ring-4 ring-red-300' : ''
                      }`}
                    >
                      <span className="text-xl font-bold text-gray-800">{t.name}</span>
                      {t.session ? (
                        <span>
                          <span className="block text-sm text-gray-500">
                            {formatTime(t.session.openedAt)}
                            {t.session.guestCount ? ` · ${t.session.guestCount} khách` : ''}
                          </span>
                          <span className="block font-bold text-red-600">{formatPrice(t.session.total)}</span>
                        </span>
                      ) : t.nextReservation ? (
                        <span className="text-sm text-blue-700">
                          📅 {formatTime(t.nextReservation.reservedAt)} · {t.nextReservation.customerName}
                        </span>
                      ) : (
                        <span className="text-gray-400">Trống</span>
                      )}
                      {newOrders > 0 && (
                        <span className="absolute top-2 right-2 bg-blue-600 text-white text-xs font-bold rounded-full px-2 py-1">
                          {newOrders} mới
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          </section>
        ))}
      </div>

      {selected && (
        <div className="w-full lg:w-md lg:sticky lg:top-4">
          <TableDetail key={selected.id} table={selected} tables={tables} onClose={() => setSelectedId(null)} />
        </div>
      )}
    </div>
  );
}
