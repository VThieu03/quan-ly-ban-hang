import { useEffect } from 'react';
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

/** Ô nhập số tiền: hiển thị có dấu chấm ngăn cách, trả về số nguyên. */
export function MoneyInput({
  value,
  onChange,
  ...props
}: { value: number; onChange: (value: number) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <input
      inputMode="numeric"
      {...props}
      value={value ? value.toLocaleString('vi-VN') : ''}
      onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)}
      className={`${inputCls} text-right ${props.className ?? ''}`}
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
