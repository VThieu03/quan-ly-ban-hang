import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../../../shared/format.ts';
import type { OrderStatus } from '../../../shared/types.ts';
import { api, beep, run } from '../api.ts';
import { useData } from '../context.ts';

const COLUMNS: { status: OrderStatus; title: string; next: OrderStatus; action: string; color: string }[] = [
  { status: 'new', title: 'Đơn mới', next: 'preparing', action: 'Bắt đầu làm', color: 'bg-blue-600 hover:bg-blue-700' },
  { status: 'preparing', title: 'Đang làm', next: 'served', action: 'Đã lên món ✓', color: 'bg-green-600 hover:bg-green-700' },
];

const LATE_MINUTES = 15;

export function KitchenPage() {
  const [orders] = useData(api.kitchen);
  const [now, setNow] = useState(() => Date.now());
  const prevNewIds = useRef<Set<number> | null>(null);

  useEffect(() => {
    if (!orders) return;
    const newIds = orders.filter((o) => o.status === 'new').map((o) => o.id);
    if (prevNewIds.current && newIds.some((id) => !prevNewIds.current!.has(id))) beep();
    prevNewIds.current = new Set(newIds);
  }, [orders]);

  // Cập nhật số phút chờ.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {COLUMNS.map((col) => {
        const list = (orders ?? []).filter((o) => o.status === col.status);
        return (
          <section key={col.status}>
            <h2 className="text-xl font-bold text-gray-700 mb-3">
              {col.title} ({list.length})
            </h2>
            <div className="space-y-3">
              {list.length === 0 && <p className="text-gray-400">Không có đơn.</p>}
              {list.map((order) => {
                const minutes = Math.floor((now - new Date(order.createdAt).getTime()) / 60_000);
                const items = order.items.filter((i) => !i.cancelled);
                return (
                  <div key={order.id} className="bg-white rounded-2xl shadow p-4">
                    <div className="flex justify-between items-baseline mb-2">
                      <span className="text-2xl font-bold">{order.tableName}</span>
                      <span className={minutes >= LATE_MINUTES ? 'text-red-600 font-bold' : 'text-gray-500'}>
                        {formatTime(order.createdAt)} · {minutes} phút
                      </span>
                    </div>
                    <ul className="text-lg space-y-1 mb-2">
                      {items.map((item) => (
                        <li key={item.id}>
                          <b>{item.quantity}×</b> {item.name.vi}
                        </li>
                      ))}
                    </ul>
                    {order.note && <p className="bg-yellow-100 text-yellow-900 rounded-lg p-2 mb-2">📝 {order.note}</p>}
                    <button
                      onClick={() => run(() => api.setOrderStatus(order.id, col.next))}
                      className={`w-full text-white font-bold text-lg py-3 rounded-xl ${col.color}`}
                    >
                      {col.action}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
