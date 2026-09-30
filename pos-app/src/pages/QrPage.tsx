import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, run } from '../api.ts';
import { useApp, useData } from '../context.ts';
import { Button, PageHeader } from '../components/ui.tsx';

type QrCard = { id: number; name: string; area: string; url: string; image: string };

export function QrPage() {
  const { config } = useApp();
  const [tables, reload] = useData(api.tables);
  const [cards, setCards] = useState<QrCard[]>([]);
  const baseUrl = config?.orderBaseUrl ?? '';

  useEffect(() => {
    if (!tables || !baseUrl) return;
    let cancelled = false;
    Promise.all(
      tables.map(async (t) => {
        const url = `${baseUrl}?t=${t.token}`;
        return { id: t.id, name: t.name, area: t.area, url, image: await QRCode.toDataURL(url, { width: 320, margin: 1 }) };
      }),
    )
      .then((result) => !cancelled && setCards(result))
      .catch((err) => console.error('Không tạo được mã QR', err));
    return () => {
      cancelled = true;
    };
  }, [tables, baseUrl]);

  return (
    <div>
      <div className="print:hidden">
        <PageHeader title="Mã QR gọi món">
          <Button onClick={() => window.print()}>🖨 In tất cả</Button>
        </PageHeader>
        <p className="text-gray-600 mb-4">
          Mã QR trỏ tới <code className="bg-gray-200 px-1 rounded">{baseUrl}</code>. Đổi địa chỉ bằng biến môi trường{' '}
          <code className="bg-gray-200 px-1 rounded">ORDER_BASE_URL</code> của server. Nếu mã của bàn nào bị lộ (bị chụp lại
          mang về), bấm "Đổi mã" rồi in lại mã bàn đó.
        </p>
      </div>
      <div className="print-area grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3 gap-4">
        {cards.map((card) => (
          <div key={card.id} className="bg-white rounded-2xl border-2 border-gray-300 p-4 text-center break-inside-avoid">
            <div className="font-bold text-2xl">{card.name}</div>
            {card.area && <div className="text-sm text-gray-500">{card.area}</div>}
            <img src={card.image} alt={`QR ${card.name}`} className="w-full max-w-60 mx-auto" />
            <div className="text-sm mt-1">Quét mã để gọi món · Scan to order</div>
            <div className="print:hidden mt-2 flex justify-center gap-2 text-xs">
              <a href={card.url} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                Mở thử
              </a>
              <button
                className="text-red-600 underline"
                onClick={() => {
                  if (confirm(`Đổi mã QR của ${card.name}? Mã cũ đã in sẽ không dùng được nữa.`)) {
                    run(() => api.regenerateTableToken(card.id)).then(reload);
                  }
                }}
              >
                Đổi mã
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
