import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatPrice } from '../../shared/format.ts';
import { LANGS } from '../../shared/types.ts';
import type { CustomerTableView, Lang, MenuCategory } from '../../shared/types.ts';
import { api, ApiRequestError, subscribeTable } from './api.ts';
import { CartPanel } from './components/CartPanel.tsx';
import type { CartEntry } from './components/CartPanel.tsx';
import { HistoryModal } from './components/HistoryModal.tsx';
import { LanguageSwitcher } from './components/LanguageSwitcher.tsx';
import { MenuItemCard } from './components/MenuItemCard.tsx';
import { StatusScreen } from './components/StatusScreen.tsx';
import { translator } from './i18n.ts';
import type { TextKey } from './i18n.ts';

type CartLine = { menuItemId: string; quantity: number };
/** Giỏ hàng gắn với một lượt ngồi, để tablet tại bàn không giữ giỏ của nhóm khách trước. */
type StoredCart = { sessionId: number | null; lines: CartLine[] };
type LoadState = 'loading' | 'ready' | 'not_found' | 'error';

// Mã QR của mỗi bàn trỏ tới "/?t=<token>".
const token = new URLSearchParams(window.location.search).get('t');
const cartKey = `cart:${token}`;
const POLL_MS = 10_000;

function readStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Trình duyệt chặn lưu trữ: bỏ qua, app vẫn chạy bình thường.
  }
}

function initialLang(): Lang {
  const stored = readStorage<Lang>('lang');
  if (stored && LANGS.includes(stored)) return stored;
  const browser = navigator.language.slice(0, 2) as Lang;
  return LANGS.includes(browser) ? browser : 'vi';
}

function App() {
  const [lang, setLangState] = useState(initialLang);
  const t = useMemo(() => translator(lang), [lang]);
  const setLang = (l: Lang) => {
    setLangState(l);
    writeStorage('lang', l);
  };

  const [loadState, setLoadState] = useState<LoadState>(token ? 'loading' : 'not_found');
  const [menu, setMenu] = useState<MenuCategory[]>([]);
  const [table, setTable] = useState<CustomerTableView | null>(null);
  const [showThanks, setShowThanks] = useState(false);
  const lastSessionId = useRef<number | null>(null);

  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<StoredCart>(() => readStorage<StoredCart>(cartKey) ?? { sessionId: null, lines: [] });
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [orderError, setOrderError] = useState<TextKey | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [requestingBill, setRequestingBill] = useState(false);

  // ---------- Tải dữ liệu & realtime ----------

  const loadMenu = useCallback(async () => {
    setMenu(await api.menu());
  }, []);

  const loadTable = useCallback(async () => {
    const view = await api.table(token!);
    // Bàn vừa được thanh toán xong → hiện màn hình cảm ơn.
    if (view.session) setShowThanks(false);
    else if (lastSessionId.current !== null) setShowThanks(true);
    lastSessionId.current = view.session?.id ?? null;
    setTable(view);
  }, []);

  const loadAll = useCallback(async () => {
    if (!token) return;
    try {
      await Promise.all([loadMenu(), loadTable()]);
      setLoadState('ready');
    } catch (e) {
      setLoadState(e instanceof ApiRequestError && e.status === 404 ? 'not_found' : 'error');
    }
  }, [loadMenu, loadTable]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- tải dữ liệu bất đồng bộ, setState chạy sau await
    loadAll();
  }, [loadAll]);

  const ready = loadState === 'ready';
  useEffect(() => {
    if (!ready || !token) return;
    const unsubscribe = subscribeTable(token, (event) => {
      if (!event || event.type === 'table') loadTable().catch(() => {});
      if (!event || event.type === 'menu') loadMenu().catch(() => {});
    });
    // Dự phòng khi mạng/proxy chặn luồng realtime: tự tải lại định kỳ.
    const timer = setInterval(() => {
      if (document.hidden) return;
      loadTable().catch(() => {});
      loadMenu().catch(() => {});
    }, POLL_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [ready, loadTable, loadMenu]);

  useEffect(() => {
    writeStorage(cartKey, cart);
  }, [cart]);

  useEffect(() => {
    if (!showSuccess) return;
    const timer = setTimeout(() => setShowSuccess(false), 2500);
    return () => clearTimeout(timer);
  }, [showSuccess]);

  // ---------- Giỏ hàng ----------

  const sessionId = table?.session?.id ?? null;
  const lines = sessionId !== null && cart.sessionId === sessionId ? cart.lines : [];
  const updateLines = (fn: (lines: CartLine[]) => CartLine[]) =>
    setCart((prev) => ({ sessionId, lines: fn(prev.sessionId === sessionId ? prev.lines : []) }));

  const itemsById = useMemo(() => new Map(menu.flatMap((c) => c.items).map((i) => [i.id, i])), [menu]);
  const entries: CartEntry[] = lines.flatMap((l) => {
    const item = itemsById.get(l.menuItemId);
    return item ? [{ item, quantity: l.quantity }] : [];
  });
  const cartCount = entries.reduce((sum, e) => sum + e.quantity, 0);
  const cartTotal = entries.reduce((sum, e) => sum + e.item.price * e.quantity, 0);

  const addToCart = (id: string) =>
    updateLines((ls) =>
      ls.some((l) => l.menuItemId === id)
        ? ls.map((l) => (l.menuItemId === id ? { ...l, quantity: l.quantity + 1 } : l))
        : [...ls, { menuItemId: id, quantity: 1 }],
    );
  const decreaseInCart = (id: string) =>
    updateLines((ls) =>
      ls.flatMap((l) => (l.menuItemId !== id ? [l] : l.quantity > 1 ? [{ ...l, quantity: l.quantity - 1 }] : [])),
    );
  const removeFromCart = (id: string) => updateLines((ls) => ls.filter((l) => l.menuItemId !== id));

  const submitOrder = async () => {
    if (!token) return;
    if (entries.some((e) => !e.item.available)) {
      updateLines((ls) => ls.filter((l) => itemsById.get(l.menuItemId)?.available));
      setOrderError('errorUnavailable');
      return;
    }
    setSending(true);
    setOrderError(null);
    try {
      await api.placeOrder(token, {
        items: entries.map((e) => ({ menuItemId: e.item.id, quantity: e.quantity })),
        note,
      });
      updateLines(() => []);
      setNote('');
      setCartOpen(false);
      setShowSuccess(true);
      loadTable().catch(() => {});
    } catch (e) {
      if (e instanceof ApiRequestError && e.message === 'item_unavailable' && e.itemId) {
        removeFromCart(e.itemId);
        setOrderError('errorUnavailable');
        loadMenu().catch(() => {});
      } else if (e instanceof ApiRequestError && e.message === 'table_closed') {
        loadTable().catch(() => {});
      } else {
        setOrderError('errorGeneric');
      }
    } finally {
      setSending(false);
    }
  };

  const requestBill = async () => {
    setRequestingBill(true);
    try {
      await api.requestBill(token!);
      await loadTable();
    } catch {
      alert(t('errorGeneric'));
    } finally {
      setRequestingBill(false);
    }
  };

  // ---------- Màn hình trạng thái ----------

  const langBar = (
    <div className="bg-red-600 rounded-xl p-2">
      <LanguageSwitcher lang={lang} onChange={setLang} />
    </div>
  );

  if (loadState === 'not_found') {
    return (
      <StatusScreen icon="📱" title={t('noTableTitle')} description={t('noTableDesc')}>
        {langBar}
      </StatusScreen>
    );
  }
  if (loadState === 'loading' && !table) {
    return <StatusScreen icon="⏳" title={t('loading')} />;
  }
  if (loadState === 'error' || !table) {
    return (
      <StatusScreen icon="⚠️" title={t('errorGeneric')}>
        <button
          onClick={() => {
            setLoadState('loading');
            loadAll();
          }}
          className="bg-red-600 text-white font-bold px-6 py-3 rounded-xl"
        >
          {t('retry')}
        </button>
      </StatusScreen>
    );
  }
  if (!table.session) {
    return showThanks ? (
      <StatusScreen icon="🙏" title={t('thanksTitle')} description={t('thanksDesc')}>
        {langBar}
      </StatusScreen>
    ) : (
      <StatusScreen icon="🔒" title={`${table.name} – ${t('closedTitle')}`} description={t('closedDesc')}>
        {langBar}
      </StatusScreen>
    );
  }

  // ---------- Màn hình gọi món ----------

  const session = table.session;
  const activeCategory = menu.find((c) => c.id === activeCategoryId) ?? menu[0];
  const cartPanel = (
    <CartPanel
      entries={entries}
      lang={lang}
      t={t}
      note={note}
      sending={sending}
      error={orderError && t(orderError)}
      onNoteChange={setNote}
      onAdd={addToCart}
      onDecrease={decreaseInCart}
      onRemove={removeFromCart}
      onSubmit={submitOrder}
    />
  );

  return (
    <div className="h-dvh flex flex-col md:flex-row bg-gray-100 overflow-hidden">
      {/* Đầu trang (điện thoại) / cột danh mục (tablet trở lên) */}
      <aside className="md:w-56 bg-white shadow-md flex flex-col md:h-full shrink-0">
        <div className="p-3 md:p-4 bg-red-600 text-white flex md:flex-col items-center justify-between md:justify-center gap-2 md:gap-3">
          <div className="md:text-center">
            <div className="font-bold text-xl">{t('appTitle')}</div>
            <div className="text-sm font-semibold text-red-100">{table.name}</div>
          </div>
          <LanguageSwitcher lang={lang} onChange={setLang} />
        </div>
        <nav className="flex md:flex-col overflow-x-auto md:overflow-y-auto md:flex-1 md:py-4 border-b md:border-b-0 border-gray-200">
          {menu.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCategoryId(c.id)}
              className={`shrink-0 whitespace-nowrap px-4 py-3 md:w-full md:py-6 text-left font-bold md:text-lg transition-colors ${
                activeCategory?.id === c.id
                  ? 'bg-red-50 text-red-600 border-b-4 md:border-b-0 md:border-l-4 border-red-600'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {c.title[lang]}
            </button>
          ))}
        </nav>
      </aside>

      {/* Danh sách món */}
      <main className="flex-1 overflow-y-auto p-3 md:p-6 pb-28 md:pb-6">
        <h2 className="hidden md:block text-3xl font-bold text-gray-800 mb-6">{activeCategory?.title[lang]}</h2>
        <div className="grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3 md:gap-6">
          {activeCategory?.items.map((item) => (
            <MenuItemCard
              key={item.id}
              item={item}
              lang={lang}
              t={t}
              quantityInCart={lines.find((l) => l.menuItemId === item.id)?.quantity ?? 0}
              onAdd={() => addToCart(item.id)}
            />
          ))}
        </div>
      </main>

      {/* Giỏ hàng bên phải (tablet trở lên) */}
      <aside className="hidden md:flex w-80 bg-white shadow-xl flex-col h-full border-l border-gray-200">
        <div className="p-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">{t('cartTitle')}</h2>
            <p className="text-gray-500">
              {cartCount} {t('itemsCount')}
            </p>
          </div>
          <button
            onClick={() => setShowHistory(true)}
            className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-2 rounded-lg font-semibold text-sm transition-colors"
          >
            🧾 {t('historyBtn')} ({session.orders.length})
          </button>
        </div>
        {cartPanel}
      </aside>

      {/* Thanh dưới cùng (điện thoại) */}
      <div className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex gap-2 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
        <button
          onClick={() => setShowHistory(true)}
          className="bg-gray-100 text-gray-700 rounded-xl px-3 font-semibold text-sm"
        >
          🧾 {t('historyBtn')} ({session.orders.length})
        </button>
        <button
          onClick={() => setCartOpen(true)}
          className="flex-1 bg-red-600 text-white rounded-xl py-3 px-4 font-bold flex justify-between items-center gap-2"
        >
          <span>
            🛒 {cartCount} {t('itemsCount')}
          </span>
          <span>{formatPrice(cartTotal)}</span>
        </button>
      </div>

      {/* Giỏ hàng dạng bảng trượt (điện thoại) */}
      {cartOpen && (
        <div className="md:hidden fixed inset-0 bg-black/60 z-40" onClick={() => setCartOpen(false)}>
          <div
            className="absolute bottom-0 inset-x-0 bg-white rounded-t-3xl max-h-[90dvh] flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-800">
                {t('cartTitle')} ({cartCount})
              </h2>
              <button
                onClick={() => setCartOpen(false)}
                aria-label={t('close')}
                className="text-gray-500 text-2xl font-bold w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100"
              >
                ×
              </button>
            </div>
            {cartPanel}
          </div>
        </div>
      )}

      {showSuccess && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowSuccess(false)}>
          <div className="bg-white p-8 md:p-10 rounded-3xl text-center shadow-2xl flex flex-col items-center max-w-md w-full mx-4">
            <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mb-6">
              <span className="text-6xl">👨‍🍳</span>
            </div>
            <h2 className="text-2xl md:text-3xl font-bold text-gray-800 mb-4">{t('successTitle')}</h2>
            <p className="text-gray-500 text-lg">{t('successDesc')}</p>
          </div>
        </div>
      )}

      {showHistory && (
        <HistoryModal
          session={session}
          lang={lang}
          t={t}
          requestingBill={requestingBill}
          onRequestBill={requestBill}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}

export default App;
