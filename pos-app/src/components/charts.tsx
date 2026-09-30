import { useState } from 'react';

// Biểu đồ cột một chuỗi (một màu): cột ≤ 24px, bo 4px đầu cột, lưới mảnh nhạt, tooltip khi rê/chạm.
const SERIES = '#2a78d6';
const GRID = '#e5e7eb';

function niceMax(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value / 4)! * magnitude;
  return Math.ceil(value / step) * step;
}

function compact(value: number) {
  if (value >= 1e9) return `${+(value / 1e9).toFixed(1)} tỷ`;
  if (value >= 1e6) return `${+(value / 1e6).toFixed(1)} tr`;
  if (value >= 1e3) return `${+(value / 1e3).toFixed(0)}k`;
  return String(value);
}

export function ColumnChart({
  data,
  format,
  height = 220,
}: {
  data: { label: string; value: number; detail?: string }[];
  format: (value: number) => string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  // Nhãn trục X thưa bớt khi nhiều cột.
  const labelEvery = Math.ceil(data.length / 12);

  return (
    <div className="relative select-none" style={{ height: height + 28 }}>
      <div className="absolute left-0 top-0 w-12 text-right text-xs text-gray-500" style={{ height }}>
        {ticks.map((t) => (
          <span key={t} className="absolute right-2 -translate-y-1/2" style={{ top: height - (t / max) * height }}>
            {compact(t)}
          </span>
        ))}
      </div>
      <div className="absolute left-12 right-0 top-0" style={{ height }}>
        {ticks.map((t) => (
          <div key={t} className="absolute inset-x-0 h-px" style={{ top: height - (t / max) * height, background: GRID }} />
        ))}
        <div className="absolute inset-0 flex items-end">
          {data.map((d, i) => (
            <div
              key={d.label}
              className="relative flex-1 h-full flex items-end justify-center cursor-default"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setHover(hover === i ? null : i)}
            >
              <div
                className="w-full max-w-6 mx-px rounded-t"
                style={{
                  height: `${(d.value / max) * 100}%`,
                  minHeight: d.value > 0 ? 2 : 0,
                  background: SERIES,
                  opacity: hover === null || hover === i ? 1 : 0.55,
                }}
              />
              {hover === i && (
                <div className="absolute bottom-full mb-1 z-10 bg-gray-900 text-white text-xs rounded-lg px-2 py-1 whitespace-nowrap pointer-events-none">
                  <div className="font-semibold">{d.label}</div>
                  <div>{format(d.value)}</div>
                  {d.detail && <div className="text-gray-300">{d.detail}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="absolute left-12 right-0 flex text-xs text-gray-500" style={{ top: height + 6 }}>
        {data.map((d, i) => (
          <span key={d.label} className="flex-1 text-center truncate">
            {i % labelEvery === 0 ? d.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Dòng có thanh ngang tỉ lệ (dùng trong bảng xếp hạng). */
export function BarCell({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-2 bg-gray-100 rounded-full w-32">
      <div className="h-2 rounded-full" style={{ width: `${max ? (value / max) * 100 : 0}%`, background: SERIES }} />
    </div>
  );
}
