import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

import { shiftDate, today } from '../dates.ts';

// Bộ component giao diện dùng chung cho app quầy.

export const inputCls =
  'w-full border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-red-500 disabled:bg-gray-100';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={2} {...props} className={`${inputCls} resize-none ${props.className ?? ''}`} />;
}

/**
 * Bấm vào ô thì chọn sẵn số cũ để gõ đè (chỉ khi người dùng chưa tự chọn / chưa kịp gõ gì).
 * Nội dung ô không đổi lúc bấm vào nên vùng chọn của trình duyệt (bấm đúp, bấm 3 lần, kéo chọn) vẫn giữ.
 */
function selectOnFocus(input: HTMLInputElement) {
  const before = input.value;
  requestAnimationFrame(() => {
    if (document.activeElement === input && input.value === before && input.selectionStart === input.selectionEnd) {
      input.select();
    }
  });
}

const formatMoney = (n: number) => Math.round(n).toLocaleString('vi-VN');

/**
 * Ô nhập số tiền, hiện dạng 115.000 cả khi đang gõ, trả về số nguyên.
 * Sau mỗi phím, con trỏ được đặt lại đúng vị trí theo số chữ số đứng trước nó; nếu không,
 * dấu chấm tự chèn vào sẽ làm con trỏ lệch và số bị đảo (vd gõ 115000 thành 111500).
 */
export function MoneyInput({
  value,
  onChange,
  onFocus,
  onBlur,
  ...props
}: { value: number; onChange: (value: number) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const ref = useRef<HTMLInputElement>(null);
  /** Số chữ số đứng trước con trỏ sau lần gõ gần nhất (để đặt lại con trỏ sau khi định dạng). */
  const digitsBeforeCaret = useRef<number | null>(null);
  // Gõ "0" thì vẫn hiện 0 (giá trị 0 bình thường hiện ô trống).
  const [showZero, setShowZero] = useState(false);
  const display = value ? formatMoney(value) : showZero ? '0' : '';

  useLayoutEffect(() => {
    const input = ref.current;
    const wanted = digitsBeforeCaret.current;
    if (!input || wanted === null || document.activeElement !== input) return;
    digitsBeforeCaret.current = null;
    let pos = 0;
    for (let seen = 0; pos < display.length && seen < wanted; pos++) if (/\d/.test(display[pos])) seen++;
    input.setSelectionRange(pos, pos);
  });

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      {...props}
      value={display}
      onFocus={(e) => {
        selectOnFocus(e.currentTarget);
        onFocus?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        const caret = e.target.selectionStart ?? raw.length;
        const digits = raw.replace(/\D/g, '');
        // Bỏ số 0 thừa ở đầu (05 → 5) để con trỏ không lệch.
        const leadingZeros = digits.length - (digits.replace(/^0+(?=\d)/, '').length);
        digitsBeforeCaret.current = Math.max(0, raw.slice(0, caret).replace(/\D/g, '').length - leadingZeros);
        setShowZero(digits !== '' && Number(digits) === 0);
        onChange(Number(digits) || 0);
      }}
      onBlur={(e) => {
        setShowZero(false);
        onBlur?.(e);
      }}
      className={`${inputCls} text-right tabular-nums ${props.className ?? ''}`}
    />
  );
}

/**
 * Ô nhập số (số nguyên hoặc thập phân, chấp nhận cả dấu phẩy). Giữ nguyên chữ đang gõ cho tới khi rời ô,
 * nên xóa trống để gõ lại được và gõ được "1." / "0,5" mà không bị tự sửa.
 */
export function NumberInput({
  value,
  onChange,
  decimal = false,
  onFocus,
  onBlur,
  ...props
}: { value: number; onChange: (value: number) => void; decimal?: boolean } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
>) {
  const [typing, setTyping] = useState<string | null>(null);
  return (
    <input
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      autoComplete="off"
      {...props}
      value={typing ?? (value ? String(value) : '')}
      onFocus={(e) => {
        selectOnFocus(e.currentTarget);
        onFocus?.(e);
      }}
      onChange={(e) => {
        let text = e.target.value.replace(',', '.');
        text = decimal ? text.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1') : text.replace(/\D/g, '');
        setTyping(text);
        onChange(Number(text) || 0);
      }}
      onBlur={(e) => {
        setTyping(null);
        onBlur?.(e);
      }}
      className={`${inputCls} text-right tabular-nums ${props.className ?? ''}`}
    />
  );
}

const buttonVariants = {
  primary: 'bg-red-600 hover:bg-red-700 text-white',
  secondary: 'bg-white border border-gray-300 hover:bg-gray-50 text-gray-800',
  success: 'bg-green-600 hover:bg-green-700 text-white',
  dark: 'bg-gray-800 hover:bg-gray-900 text-white',
  danger: 'bg-white border border-red-300 text-red-600 hover:bg-red-50',
  ghost: 'text-gray-600 hover:bg-gray-100',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonVariants }) {
  return (
    <button
      type="button"
      {...props}
      className={`px-4 py-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${buttonVariants[variant]} ${className}`}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-gray-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-gray-500 mt-1">{hint}</span>}
    </label>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4 print:hidden">
      <div
        className={`bg-white w-full ${wide ? 'sm:max-w-4xl' : 'sm:max-w-lg'} rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[95dvh]`}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="text-lg font-bold text-gray-800">{title}</h2>
          <button onClick={onClose} className="text-2xl text-gray-400 hover:text-gray-700 w-9 h-9" aria-label="Đóng">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">{children}</div>
        {footer && <div className="px-5 py-3 border-t flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-4 py-2 font-semibold whitespace-nowrap border-b-2 -mb-px ${
            value === t.id ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-800'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <h1 className="text-2xl font-bold text-gray-800">{title}</h1>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white rounded-2xl shadow-sm border border-gray-200 p-4 ${className}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-center text-gray-400 py-8">{children}</p>;
}

export function Badge({ children, color = 'gray' }: { children: ReactNode; color?: 'gray' | 'green' | 'red' | 'amber' | 'blue' }) {
  const colors = {
    gray: 'bg-gray-100 text-gray-700',
    green: 'bg-green-100 text-green-800',
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-800',
    blue: 'bg-blue-100 text-blue-800',
  };
  return <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${colors[color]}`}>{children}</span>;
}

/** Bảng dữ liệu có cuộn ngang trên màn hình nhỏ. */
export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto bg-white rounded-2xl border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-600 text-left">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2 font-semibold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">{children}</tbody>
      </table>
    </div>
  );
}

export function DateRange({
  value,
  onChange,
}: {
  value: { from: string; to: string };
  onChange: (value: { from: string; to: string }) => void;
}) {
  const monthStart = today().slice(0, 8) + '01';
  const presets = [
    { label: 'Hôm nay', from: today(), to: today() },
    { label: 'Hôm qua', from: shiftDate(-1), to: shiftDate(-1) },
    { label: '7 ngày', from: shiftDate(-6), to: today() },
    { label: 'Tháng này', from: monthStart, to: today() },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((p) => (
        <button
          key={p.label}
          onClick={() => onChange({ from: p.from, to: p.to })}
          className={`text-sm px-3 py-1.5 rounded-lg border ${
            value.from === p.from && value.to === p.to ? 'bg-gray-800 text-white border-gray-800' : 'bg-white hover:bg-gray-50'
          }`}
        >
          {p.label}
        </button>
      ))}
      <input
        type="date"
        value={value.from}
        max={value.to}
        onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
        className="border rounded-lg px-2 py-1 text-sm"
      />
      <span className="text-gray-400">→</span>
      <input
        type="date"
        value={value.to}
        min={value.from}
        onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
        className="border rounded-lg px-2 py-1 text-sm"
      />
    </div>
  );
}
