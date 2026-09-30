import { useCallback, useEffect, useState } from 'react';
import { formatPrice } from '../../shared/format.ts';
import { can, ROLE_LABELS } from '../../shared/permissions.ts';
import type { Permission } from '../../shared/permissions.ts';
import type { DailySummary, ServerEvent } from '../../shared/types.ts';
import { api, beep, eventsUrl, getToken, run, setToken, setUnauthorizedHandler } from './api.ts';
import type { MeInfo, PosConfig } from './api.ts';
import { LoginScreen } from './components/LoginScreen.tsx';
import { AppContext } from './context.ts';
import { BillsPage } from './pages/BillsPage.tsx';
import { CashShiftPage } from './pages/CashShiftPage.tsx';
import { CustomersPage } from './pages/CustomersPage.tsx';
import { InventoryPage } from './pages/InventoryPage.tsx';
import { KitchenPage } from './pages/KitchenPage.tsx';
import { MenuPage } from './pages/MenuPage.tsx';
import { PromotionsPage } from './pages/PromotionsPage.tsx';
import { QrPage } from './pages/QrPage.tsx';
import { ReportsPage } from './pages/ReportsPage.tsx';
import { ReservationsPage } from './pages/ReservationsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { StaffPage } from './pages/StaffPage.tsx';
import { TablesPage } from './pages/TablesPage.tsx';

const PAGES = [
  { id: 'tables', label: 'Sơ đồ bàn', icon: '🪑', perms: ['tables', 'checkout'], Page: TablesPage },
  { id: 'kitchen', label: 'Bếp', icon: '👨‍🍳', perms: ['kitchen'], Page: KitchenPage },
  { id: 'reservations', label: 'Đặt bàn', icon: '📅', perms: ['reservations'], Page: ReservationsPage },
  { id: 'bills', label: 'Hóa đơn', icon: '🧾', perms: ['bills'], Page: BillsPage },
  { id: 'cash', label: 'Ca thu ngân', icon: '💵', perms: ['cashShift'], Page: CashShiftPage },
  { id: 'customers', label: 'Khách hàng', icon: '👥', perms: ['customers'], Page: CustomersPage },
  { id: 'menu', label: 'Thực đơn', icon: '📋', perms: ['menu'], Page: MenuPage },
  { id: 'promotions', label: 'Khuyến mãi', icon: '🏷️', perms: ['promotions'], Page: PromotionsPage },
  { id: 'inventory', label: 'Kho', icon: '📦', perms: ['inventory'], Page: InventoryPage },
  { id: 'reports', label: 'Báo cáo', icon: '📊', perms: ['reports'], Page: ReportsPage },
  { id: 'staff', label: 'Nhân viên', icon: '🧑‍💼', perms: ['staff'], Page: StaffPage },
  { id: 'qr', label: 'Mã QR bàn', icon: '🔳', perms: ['settings'], Page: QrPage },
  { id: 'settings', label: 'Cài đặt', icon: '⚙️', perms: ['settings'], Page: SettingsPage },
] as const satisfies readonly { id: string; label: string; icon: string; perms: Permission[]; Page: () => unknown }[];

type PageId = (typeof PAGES)[number]['id'];

const POLL_MS = 10_000;

function App() {
  const [token, setTokenState] = useState(getToken);
  const [me, setMe] = useState<MeInfo | null>(null);
  const [config, setConfig] = useState<PosConfig | null>(null);
  const [page, setPage] = useState<PageId | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const logout = useCallback(() => {
    setToken(null);
    setTokenState(null);
    setMe(null);
    setPage(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, [logout]);

  const loadMe = useCallback(() => {
    api.me().then(setMe, () => {});
    api.config().then(setConfig, () => {});
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- tải dữ liệu bất đồng bộ, setState chạy sau await
    if (token) loadMe();
  }, [token, loadMe]);

  useEffect(() => {
    if (!token) return;
    const source = new EventSource(eventsUrl());
    source.onopen = () => {
      setConnected(true);
      setVersion((v) => v + 1);
    };
    source.onmessage = (e) => {
      const event = JSON.parse(e.data) as ServerEvent;
      if (event.type === 'payment') {
        beep(1320);
        setNotice(`💰 Nhận chuyển khoản ${formatPrice(event.amount)} (mã KBBQ${event.sessionId})`);
      }
      setVersion((v) => v + 1);
    };
    source.onerror = () => {
      setConnected(false);
      // Token hết hạn thì server trả 401 và EventSource tự đóng: kiểm tra lại đăng nhập.
      if (source.readyState === EventSource.CLOSED) api.me().catch(() => {});
    };
    // Dự phòng khi mạng/proxy chặn luồng realtime: tự tải lại định kỳ.
    const timer = setInterval(() => {
      if (!document.hidden) setVersion((v) => v + 1);
    }, POLL_MS);
    return () => {
      source.close();
      clearInterval(timer);
    };
  }, [token]);

  const staff = me?.staff;
  useEffect(() => {
    if (!staff || !(can(staff.role, 'bills') || can(staff.role, 'reports'))) return;
    api.summary().then(setSummary, () => {});
  }, [staff, version]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!token) {
    return (
      <LoginScreen
        onLogin={(t) => {
          setToken(t);
          setTokenState(t);
        }}
      />
    );
  }
  if (!staff) return <div className="min-h-dvh flex items-center justify-center text-gray-500">Đang tải...</div>;

  const pages = PAGES.filter((p) => p.perms.some((perm) => can(staff.role, perm)));
  const current = pages.find((p) => p.id === page) ?? pages[0];
  const Page = current.Page;
  const timesheet = me.timesheet;

  return (
    <AppContext.Provider value={{ staff, config, version }}>
      <div className="min-h-dvh flex">
        {/* Menu bên trái */}
        <aside
          className={`${menuOpen ? 'fixed inset-0 z-40 flex' : 'hidden'} lg:static lg:flex print:hidden`}
          onClick={() => setMenuOpen(false)}
        >
          <nav className="w-56 bg-gray-900 text-gray-300 flex flex-col py-3 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 pb-3 mb-2 border-b border-gray-700">
              <div className="text-white font-bold text-lg">🔥 {config?.restaurantName ?? 'K-BBQ'}</div>
              <div className="text-sm">
                {staff.name} · {ROLE_LABELS[staff.role]}
              </div>
            </div>
            {pages.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setPage(p.id);
                  setMenuOpen(false);
                }}
                className={`text-left px-4 py-2.5 font-semibold ${
                  current.id === p.id ? 'bg-red-600 text-white' : 'hover:bg-gray-800 hover:text-white'
                }`}
              >
                <span className="mr-2">{p.icon}</span>
                {p.label}
              </button>
            ))}
          </nav>
          <div className="flex-1 bg-black/40 lg:hidden" />
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          <header className="bg-white border-b flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 print:hidden">
            <button className="lg:hidden text-2xl" onClick={() => setMenuOpen(true)} aria-label="Menu">
              ☰
            </button>
            <span className="font-bold text-gray-800">
              {current.icon} {current.label}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
              {summary && (
                <span className="text-gray-600">
                  Hôm nay: <b>{summary.bills}</b> HĐ · <b className="text-red-600">{formatPrice(summary.revenue)}</b>
                </span>
              )}
              <span className={connected ? 'text-green-600' : 'text-amber-600'} title="Kết nối realtime">
                ● {connected ? 'Trực tuyến' : 'Đang kết nối lại'}
              </span>
              <button
                onClick={() => run(async () => (timesheet ? api.clockOut() : api.clockIn())).then(loadMe)}
                className={`px-3 py-1.5 rounded-lg font-semibold ${
                  timesheet ? 'bg-green-100 text-green-800 hover:bg-green-200' : 'bg-gray-100 hover:bg-gray-200'
                }`}
                title={timesheet ? `Vào ca lúc ${new Date(timesheet.clockIn).toLocaleTimeString('vi-VN')}` : 'Chấm công vào ca'}
              >
                {timesheet ? `⏱ Trong ca · Tan ca` : '⏱ Vào ca'}
              </button>
              <button
                onClick={() => {
                  api.logout().catch(() => {});
                  logout();
                }}
                className="text-gray-500 hover:text-gray-900 underline"
              >
                Đăng xuất
              </button>
            </div>
          </header>

          {notice && (
            <div className="bg-green-600 text-white font-semibold px-4 py-2 flex justify-between print:hidden">
              <span>{notice}</span>
              <button onClick={() => setNotice(null)}>×</button>
            </div>
          )}

          <main className="flex-1 p-4 min-w-0">
            <Page />
          </main>
        </div>
      </div>
    </AppContext.Provider>
  );
}

export default App;
