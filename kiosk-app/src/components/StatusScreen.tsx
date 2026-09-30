import type { ReactNode } from 'react';

type Props = {
  icon: string;
  title: string;
  description?: string;
  children?: ReactNode;
};

/** Màn hình thông báo toàn trang: chưa quét QR, bàn chưa mở, cảm ơn... */
export function StatusScreen({ icon, title, description, children }: Props) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center bg-gray-100">
      <span className="text-7xl">{icon}</span>
      <h1 className="text-2xl md:text-3xl font-bold text-gray-800">{title}</h1>
      {description && <p className="text-gray-500 text-lg max-w-md">{description}</p>}
      {children}
    </div>
  );
}
