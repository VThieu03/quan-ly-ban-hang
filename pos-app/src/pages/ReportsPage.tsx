import { useState } from 'react';
import { formatPrice } from '../../../shared/format.ts';
import type { PaymentMethod } from '../../../shared/types.ts';
import { api, download, paymentLabels, run } from '../api.ts';
import { useData } from '../context.ts';
import { BarCell, ColumnChart } from '../components/charts.tsx';
import { Button, Card, DateRange, PageHeader, Table, Tabs } from '../components/ui.tsx';
import { useDateRange } from '../dates.ts';

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </Card>
  );
}

export function ReportsPage() {
  const [range, setRange] = useDateRange(6);
  const [report] = useData(() => api.report(range.from, range.to), [range.from, range.to]);
  const [view, setView] = useState<'day' | 'hour'>('day');

  if (!report) return <p className="text-gray-500">Đang tải...</p>;
  const margin = report.revenue ? Math.round((report.grossProfit / report.revenue) * 100) : 0;
  const topMax = Math.max(0, ...report.topItems.map((i) => i.revenue));
  const methodTotal = Object.values(report.byMethod).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Báo cáo">
        <Button
          variant="secondary"
          onClick={() => run(() => download(`/reports/bills.csv?from=${range.from}&to=${range.to}`, `hoa-don_${range.from}_${range.to}.csv`))}
        >
          ⬇ Xuất Excel (CSV)
        </Button>
      </PageHeader>
      <DateRange value={range} onChange={setRange} />

      <Card>
        <div className="text-sm text-gray-500">Doanh thu thực thu</div>
        <div className="text-5xl font-bold text-gray-900">{formatPrice(report.revenue)}</div>
        <div className="text-sm text-gray-500 mt-1">
          Tiền hàng {formatPrice(report.subtotal)} − giảm giá {formatPrice(report.discounts)}
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat
          label="Hóa đơn"
          value={report.bills.toLocaleString('vi-VN')}
          sub={report.voided.bills ? `${report.voided.bills} HĐ đã hủy (${formatPrice(report.voided.amount)}) không tính` : undefined}
        />
        <Stat label="TB / hóa đơn" value={formatPrice(report.averageBill)} />
        <Stat label="Lượt khách" value={report.guests.toLocaleString('vi-VN')} sub="theo số khách lúc mở bàn" />
        <Stat label="Giá vốn" value={formatPrice(report.cogs)} sub="món đã khai báo định lượng" />
        <Stat label="Lãi gộp" value={formatPrice(report.grossProfit)} sub={`${margin}% doanh thu`} />
        <Stat label="Món bị hủy" value={report.cancelled.items.toLocaleString('vi-VN')} sub={formatPrice(report.cancelled.amount)} />
      </div>

      <Card>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-gray-800">Doanh thu {view === 'day' ? 'theo ngày' : 'theo giờ'}</h2>
          <div className="w-56">
            <Tabs
              value={view}
              onChange={setView}
              tabs={[
                { id: 'day', label: 'Theo ngày' },
                { id: 'hour', label: 'Theo giờ' },
              ]}
            />
          </div>
        </div>
        <ColumnChart
          format={formatPrice}
          data={
            view === 'day'
              ? report.byDay.map((d) => ({
                  label: new Date(`${d.date}T00:00:00`).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
                  value: d.revenue,
                  detail: `${d.bills} hóa đơn`,
                }))
              : Array.from({ length: 24 }, (_, h) => {
                  const row = report.byHour.find((x) => x.hour === h);
                  return { label: `${h}h`, value: row?.revenue ?? 0, detail: `${row?.bills ?? 0} hóa đơn` };
                }).filter((d, _, all) => {
                  // Bỏ các giờ trống ở đầu/cuối ngày cho gọn.
                  const active = all.filter((x) => x.value > 0).map((x) => Number(x.label.slice(0, -1)));
                  const h = Number(d.label.slice(0, -1));
                  return active.length === 0 || (h >= Math.min(...active) && h <= Math.max(...active));
                })
          }
        />
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <div>
          <h2 className="font-bold text-gray-800 mb-2">Món bán chạy</h2>
          <Table head={['#', 'Món', 'SL', 'Doanh số', '']}>
            {report.topItems.map((item, i) => (
              <tr key={item.menuItemId}>
                <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                <td className="px-3 py-2">{item.name}</td>
                <td className="px-3 py-2 tabular-nums">{item.quantity}</td>
                <td className="px-3 py-2 tabular-nums">{formatPrice(item.revenue)}</td>
                <td className="px-3 py-2">
                  <BarCell value={item.revenue} max={topMax} />
                </td>
              </tr>
            ))}
          </Table>
        </div>
        <div className="space-y-4">
          <div>
            <h2 className="font-bold text-gray-800 mb-2">Hình thức thanh toán</h2>
            <Table head={['Hình thức', 'Số tiền', 'Tỉ lệ', '']}>
              {(Object.keys(report.byMethod) as PaymentMethod[]).map((m) => (
                <tr key={m}>
                  <td className="px-3 py-2">{paymentLabels[m]}</td>
                  <td className="px-3 py-2 tabular-nums">{formatPrice(report.byMethod[m])}</td>
                  <td className="px-3 py-2 tabular-nums">{methodTotal ? Math.round((report.byMethod[m] / methodTotal) * 100) : 0}%</td>
                  <td className="px-3 py-2">
                    <BarCell value={report.byMethod[m]} max={methodTotal} />
                  </td>
                </tr>
              ))}
            </Table>
          </div>
          <div>
            <h2 className="font-bold text-gray-800 mb-2">Theo danh mục</h2>
            <Table head={['Danh mục', 'SL', 'Doanh số']}>
              {report.byCategory.map((c) => (
                <tr key={c.categoryId}>
                  <td className="px-3 py-2">{c.name}</td>
                  <td className="px-3 py-2 tabular-nums">{c.quantity}</td>
                  <td className="px-3 py-2 tabular-nums">{formatPrice(c.revenue)}</td>
                </tr>
              ))}
            </Table>
          </div>
          <div>
            <h2 className="font-bold text-gray-800 mb-2">Theo thu ngân</h2>
            <Table head={['Nhân viên', 'Hóa đơn', 'Doanh thu']}>
              {report.byStaff.map((s) => (
                <tr key={String(s.staffId)}>
                  <td className="px-3 py-2">{s.name}</td>
                  <td className="px-3 py-2 tabular-nums">{s.bills}</td>
                  <td className="px-3 py-2 tabular-nums">{formatPrice(s.revenue)}</td>
                </tr>
              ))}
            </Table>
          </div>
        </div>
      </div>

      <details className="bg-white rounded-2xl border p-4">
        <summary className="cursor-pointer font-semibold">Bảng số liệu theo ngày</summary>
        <Table head={['Ngày', 'Hóa đơn', 'Doanh thu']}>
          {report.byDay.map((d) => (
            <tr key={d.date}>
              <td className="px-3 py-2">{new Date(`${d.date}T00:00:00`).toLocaleDateString('vi-VN')}</td>
              <td className="px-3 py-2 tabular-nums">{d.bills}</td>
              <td className="px-3 py-2 tabular-nums">{formatPrice(d.revenue)}</td>
            </tr>
          ))}
        </Table>
      </details>
    </div>
  );
}
