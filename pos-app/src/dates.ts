import { useState } from 'react';

// Tiện ích ngày giờ cho app quầy (ngày dạng YYYY-MM-DD theo giờ máy).

export const today = () => new Date().toLocaleDateString('sv-SE');

export function shiftDate(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('sv-SE');
}

export function useDateRange(initialDays = 0) {
  return useState(() => ({ from: shiftDate(-initialDays), to: today() }));
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function formatQty(n: number) {
  return Number(n.toFixed(3)).toLocaleString('vi-VN');
}
