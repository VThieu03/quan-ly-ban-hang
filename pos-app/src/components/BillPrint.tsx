import { formatPrice, formatTime } from '../../../shared/format.ts';
import type { StaffTable, TableSession } from '../../../shared/types.ts';

type Props = { table: StaffTable; session: TableSession; printedAt: Date };

/** Hóa đơn tạm tính để in (khổ giấy máy in nhiệt 80mm). Chỉ hiện khi in. */
export function BillPrint({ table, session, printedAt }: Props) {
  // Gộp cùng món cùng giá qua các lần gọi.
  const lines = new Map<string, { name: string; price: number; quantity: number }>();
  for (const order of session.orders) {
    if (order.status === 'cancelled') continue;
    for (const item of order.items) {
      if (item.cancelled) continue;
      const key = `${item.menuItemId}:${item.price}`;
      const line = lines.get(key) ?? { name: item.name.vi, price: item.price, quantity: 0 };
      line.quantity += item.quantity;
      lines.set(key, line);
    }
  }

  return (
    <div
      className="print-area hidden print:block print:fixed print:left-0 print:top-0 text-black text-sm"
      style={{ width: '72mm' }}
    >
      <h1 className="text-center font-bold text-lg">K-BBQ</h1>
      <p className="text-center">HÓA ĐƠN TẠM TÍNH</p>
      <p className="mt-2">
        {table.name} · Vào: {formatTime(session.openedAt)} · In: {formatTime(printedAt.toISOString())}
      </p>
      <p>{printedAt.toLocaleDateString('vi-VN')}</p>
      <hr className="my-2 border-dashed border-black" />
      <table className="w-full">
        <tbody>
          {[...lines.values()].map((line) => (
            <tr key={`${line.name}:${line.price}`} className="align-top">
              <td>
                {line.name}
                <br />
                {line.quantity} × {formatPrice(line.price)}
              </td>
              <td className="text-right whitespace-nowrap">{formatPrice(line.price * line.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr className="my-2 border-dashed border-black" />
      <p className="flex justify-between font-bold text-base">
        <span>TỔNG CỘNG</span>
        <span>{formatPrice(session.total)}</span>
      </p>
      <p className="text-center mt-4">Cảm ơn quý khách!</p>
    </div>
  );
}
