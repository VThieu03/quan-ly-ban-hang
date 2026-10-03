import { createContext, useContext, useEffect, useState } from 'react';
import { can } from '../../shared/permissions.ts';
import type { Permission } from '../../shared/permissions.ts';
import * as defaults from '../../shared/config.ts';
import { DEFAULT_SYSTEM } from '../../shared/systemFields.ts';
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
      defaultPortion: defaults.DEFAULT_PORTION,
      lowStockBadge: defaults.DEFAULT_LOW_STOCK_BADGE,
      kitchenLateMinutes: defaults.DEFAULT_KITCHEN_LATE_MINUTES,
      cancelReasons: defaults.DEFAULT_CANCEL_REASONS,
      voidReasons: defaults.DEFAULT_VOID_REASONS,
    }
  );
}

/** Thông số hệ thống (Cài đặt → Hệ thống); chưa tải xong thì dùng mặc định trong shared/config.ts. */
export function useSystem(): Settings['system'] {
  const { config } = useApp();
  return (
    config?.system ?? DEFAULT_SYSTEM
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
