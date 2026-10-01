import { createContext, useContext, useEffect, useState } from 'react';
import { can } from '../../shared/permissions.ts';
import type { Permission } from '../../shared/permissions.ts';
import {
  DEFAULT_CANCEL_REASONS,
  DEFAULT_KITCHEN_LATE_MINUTES,
  DEFAULT_LOW_STOCK_BADGE,
  DEFAULT_PORTION,
  DEFAULT_VOID_REASONS,
} from '../../shared/config.ts';
import type { Settings, StaffMember } from '../../shared/types.ts';
import type { PosConfig } from './api.ts';

export type AppContextValue = {
  staff: StaffMember;
  config: PosConfig | null;
  /** Tăng mỗi khi server báo có thay đổi; dùng làm dependency để tải lại dữ liệu. */
  version: number;
};

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp phải nằm trong AppContext');
  return value;
}

/** Thông số vận hành (Cài đặt → Vận hành); chưa tải xong thì dùng mặc định trong shared/config.ts. */
export function useOperations(): Settings['operations'] {
  const { config } = useApp();
  return (
    config?.operations ?? {
      defaultPortion: DEFAULT_PORTION,
      lowStockBadge: DEFAULT_LOW_STOCK_BADGE,
      kitchenLateMinutes: DEFAULT_KITCHEN_LATE_MINUTES,
      cancelReasons: DEFAULT_CANCEL_REASONS,
      voidReasons: DEFAULT_VOID_REASONS,
    }
  );
}

export function useCan() {
  const { staff } = useApp();
  return (permission: Permission) => can(staff.role, permission);
}

/**
 * Tải dữ liệu từ API và tự tải lại khi server báo thay đổi (version) hoặc deps đổi.
 * Trả về [data, reload].
 */
export function useData<T>(load: () => Promise<T>, deps: unknown[] = []): [T | null, () => void] {
  const { version } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (result) => !cancelled && setData(result),
      () => {},
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, tick, ...deps]);

  return [data, () => setTick((t) => t + 1)];
}
