export type Role = 'admin' | 'cashier' | 'waiter' | 'kitchen';

export const ROLES: Role[] = ['admin', 'cashier', 'waiter', 'kitchen'];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Quản lý',
  cashier: 'Thu ngân',
  waiter: 'Phục vụ',
  kitchen: 'Bếp',
};

export type Permission =
  | 'tables' // xem sơ đồ bàn, mở bàn, gọi món thay khách, chuyển/gộp/tách bàn
  | 'checkout' // thanh toán, giảm giá, xuất hóa đơn
  | 'kitchen'
  | 'reservations'
  | 'customers'
  | 'bills' // danh sách hóa đơn đã thanh toán
  | 'cashShift' // mở/chốt ca thu ngân
  | 'menu'
  | 'promotions'
  | 'inventory'
  | 'reports'
  | 'staff'
  | 'settings';

const ALL: Permission[] = [
  'tables',
  'checkout',
  'kitchen',
  'reservations',
  'customers',
  'bills',
  'cashShift',
  'menu',
  'promotions',
  'inventory',
  'reports',
  'staff',
  'settings',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ALL,
  cashier: ['tables', 'checkout', 'kitchen', 'reservations', 'customers', 'bills', 'cashShift'],
  waiter: ['tables', 'kitchen', 'reservations'],
  kitchen: ['kitchen'],
};

export function can(role: Role, permission: Permission) {
  return ROLE_PERMISSIONS[role].includes(permission);
}
