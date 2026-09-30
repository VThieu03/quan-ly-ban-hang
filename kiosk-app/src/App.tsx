import { useState } from 'react';
import menuData from './data/menu.json';

type Lang = 'vi' | 'en' | 'ko' | 'zh' | 'ja';

type MenuItem = {
  id: string;
  name: Record<Lang, string>;
  price: number;
  image: string;
};

type MenuCategory = {
  id: string;
  title: Record<Lang, string>;
  items: MenuItem[];
};

type CartItem = MenuItem & {
  quantity: number;
};

type OrderRecord = {
  id: string;
  items: CartItem[];
  total: number;
  time: string;
};

const uiTexts = {
  appTitle: { vi: 'K-BBQ KIOSK', en: 'K-BBQ KIOSK', ko: 'K-BBQ 키오스크', zh: 'K-BBQ 自助点餐', ja: 'K-BBQ キオスク' },
  cartTitle: { vi: 'Giỏ hàng', en: 'Cart', ko: '장바구니', zh: '购物车', ja: 'カート' },
  itemsCount: { vi: 'món', en: 'items', ko: '개', zh: '件', ja: '点' },
  historyBtn: { vi: 'Lịch sử', en: 'History', ko: '주문 내역', zh: '历史订单', ja: '注文履歴' },
  emptyCart: { vi: 'Chưa có món nào', en: 'Cart is empty', ko: '장바구니가 비어 있습니다', zh: '购物车是空的', ja: 'カートは空です' },
  total: { vi: 'Tổng tiền', en: 'Total', ko: '합계', zh: '总计', ja: '合計' },
  orderBtn: { vi: 'Gọi món (Gửi vào bếp)', en: 'Order (Send to Kitchen)', ko: '주문하기 (주방으로 전송)', zh: '下单 (发送到厨房)', ja: '注文する (厨房へ送信)' },
  grandTotal: { vi: 'Tổng thanh toán', en: 'Grand Total', ko: '총 결제 금액', zh: '总计金额', ja: '総合計' },
  checkoutBtn: { vi: 'Thanh toán toàn bộ', en: 'Checkout All', ko: '전체 결제', zh: '全部结账', ja: 'お会計' },
  successTitle: { vi: 'Đã gửi vào Bếp!', en: 'Sent to Kitchen!', ko: '주방으로 전송되었습니다!', zh: '已发送至厨房！', ja: '厨房に送信されました！' },
  successDesc: { vi: 'Món ăn của bạn đang được chuẩn bị. Vui lòng đợi trong giây lát.', en: 'Your food is being prepared. Please wait a moment.', ko: '음식이 준비 중입니다. 잠시만 기다려주세요.', zh: '您的食物正在准备中，请稍候。', ja: '料理を準備しています。少々お待ちください。' },
  historyTitle: { vi: 'Lịch sử gọi món', en: 'Order History', ko: '주문 내역', zh: '历史订单', ja: '注文履歴' },
  historyEmpty: { vi: 'Chưa có lịch sử gọi món nào.', en: 'No order history.', ko: '주문 내역이 없습니다.', zh: '没有订单历史记录。', ja: '注文履歴がありません。' },
  orderNumber: { vi: 'Lần gọi #', en: 'Order #', ko: '주문 번호 ', zh: '订单号 ', ja: '注文番号 ' },
};

function App() {
  const [lang, setLang] = useState<Lang>('vi');
  const [activeCategoryId, setActiveCategoryId] = useState<string>(menuData[0].id);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderStatus, setOrderStatus] = useState<'idle' | 'success'>('idle');
  const [orderHistory, setOrderHistory] = useState<OrderRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const t = (key: keyof typeof uiTexts) => uiTexts[key][lang];

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(price);
  };

  const handleOrder = () => {
    if (cart.length > 0) {
      const newOrder: OrderRecord = {
        id: Math.random().toString(36).substring(7),
        items: [...cart],
        total: cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
        time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
      };
      setOrderHistory(prev => [newOrder, ...prev]);
      
      setOrderStatus('success');
      setTimeout(() => {
        setCart([]);
        setOrderStatus('idle');
      }, 3000);
    }
  };

  const addToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === item.id);
      if (existing) {
        return prev.map((i) => (i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const removeFromCart = (id: string) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === id);
      if (existing && existing.quantity > 1) {
        return prev.map((i) => (i.id === id ? { ...i, quantity: i.quantity - 1 } : i));
      }
      return prev.filter((i) => i.id !== id);
    });
  };

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const activeCategoryData = menuData.find((c) => c.id === activeCategoryId) as unknown as MenuCategory;

  return (
    <div className="flex h-screen bg-gray-100 font-sans overflow-hidden">
      {/* Sidebar / Categories */}
      <div className="w-56 bg-white shadow-md flex flex-col h-full overflow-y-auto">
        <div className="p-4 bg-red-600 text-white font-bold text-xl text-center flex flex-col items-center gap-3">
          <span>{t('appTitle')}</span>
          <div className="flex gap-2 justify-center flex-wrap mt-2">
            <button onClick={() => setLang('vi')} className={`text-xs px-2 py-1 rounded font-bold ${lang === 'vi' ? 'bg-white text-red-600 shadow' : 'bg-red-700 text-white hover:bg-red-500'}`}>VI</button>
            <button onClick={() => setLang('en')} className={`text-xs px-2 py-1 rounded font-bold ${lang === 'en' ? 'bg-white text-red-600 shadow' : 'bg-red-700 text-white hover:bg-red-500'}`}>EN</button>
            <button onClick={() => setLang('ko')} className={`text-xs px-2 py-1 rounded font-bold ${lang === 'ko' ? 'bg-white text-red-600 shadow' : 'bg-red-700 text-white hover:bg-red-500'}`}>KO</button>
            <button onClick={() => setLang('zh')} className={`text-xs px-2 py-1 rounded font-bold ${lang === 'zh' ? 'bg-white text-red-600 shadow' : 'bg-red-700 text-white hover:bg-red-500'}`}>ZH</button>
            <button onClick={() => setLang('ja')} className={`text-xs px-2 py-1 rounded font-bold ${lang === 'ja' ? 'bg-white text-red-600 shadow' : 'bg-red-700 text-white hover:bg-red-500'}`}>JA</button>
          </div>
        </div>
        <div className="flex-1 py-4">
          {(menuData as unknown as MenuCategory[]).map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCategoryId(c.id)}
              className={`w-full py-6 px-4 text-left font-bold text-lg transition-colors ${
                activeCategoryId === c.id
                  ? 'bg-red-50 text-red-600 border-l-4 border-red-600'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {c.title[lang]}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content / Items */}
      <div className="flex-1 p-6 h-full overflow-y-auto">
        <h2 className="text-3xl font-bold text-gray-800 mb-6">{activeCategoryData?.title[lang]}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {activeCategoryData?.items.map((item) => (
            <div
              key={item.id}
              className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden cursor-pointer hover:shadow-md transition-shadow flex flex-col"
              onClick={() => addToCart(item)}
            >
              <div className="h-48 bg-gray-200 w-full">
                <img
                  src={item.image}
                  alt={item.name[lang]}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-4 flex flex-col flex-1 justify-between">
                <h3 className="font-bold text-xl text-gray-800 mb-2 leading-tight">{item.name[lang]}</h3>
                <div className="flex justify-between items-center mt-auto">
                  <span className="text-red-600 font-bold text-xl">{formatPrice(item.price)}</span>
                  <button className="bg-red-600 text-white rounded-full w-10 h-10 flex items-center justify-center font-bold text-xl hover:bg-red-700">
                    +
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Cart Sidebar */}
      <div className="w-80 bg-white shadow-xl flex flex-col h-full border-l border-gray-200">
        <div className="p-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">{t('cartTitle')}</h2>
            <p className="text-gray-500">{cart.reduce((sum, item) => sum + item.quantity, 0)} {t('itemsCount')}</p>
          </div>
          <button 
            onClick={() => setShowHistory(true)}
            className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-2 rounded-lg font-semibold text-sm transition-colors"
          >
            {t('historyBtn')} ({orderHistory.length})
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <span className="text-4xl mb-2">🛒</span>
              <p>{t('emptyCart')}</p>
            </div>
          ) : (
            cart.map((item) => (
              <div key={item.id} className="flex flex-col bg-gray-50 p-3 rounded-xl">
                <div className="flex justify-between items-start mb-2">
                  <span className="font-bold text-gray-800 leading-tight pr-2">{item.name[lang]}</span>
                  <button 
                    onClick={() => setCart(prev => prev.filter(i => i.id !== item.id))}
                    className="text-gray-400 hover:text-red-500 font-bold"
                  >
                    ×
                  </button>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-red-600 font-semibold">{formatPrice(item.price * item.quantity)}</span>
                  <div className="flex items-center gap-3 bg-white px-2 py-1 rounded-lg border border-gray-200">
                    <button 
                      onClick={() => removeFromCart(item.id)}
                      className="w-6 h-6 flex items-center justify-center rounded-md bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold"
                    >
                      -
                    </button>
                    <span className="font-bold min-w-[1rem] text-center">{item.quantity}</span>
                    <button 
                      onClick={() => addToCart(item)}
                      className="w-6 h-6 flex items-center justify-center rounded-md bg-red-100 hover:bg-red-200 text-red-600 font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-4 border-t border-gray-200 bg-white">
          <div className="flex justify-between items-center mb-4">
            <span className="text-gray-600 font-semibold">{t('total')}</span>
            <span className="text-2xl font-bold text-red-600">{formatPrice(total)}</span>
          </div>
          <button 
            className={`w-full py-4 rounded-xl font-bold text-xl text-white transition-colors ${
              cart.length > 0 ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-300 cursor-not-allowed'
            }`}
            disabled={cart.length === 0}
            onClick={handleOrder}
          >
            {t('orderBtn')}
          </button>
        </div>
      </div>

      {/* Order Success Modal */}
      {orderStatus === 'success' && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white p-10 rounded-3xl text-center shadow-2xl transform transition-all scale-100 flex flex-col items-center max-w-md w-full mx-4">
            <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mb-6">
              <span className="text-6xl">👨‍🍳</span>
            </div>
            <h2 className="text-3xl font-bold text-gray-800 mb-4">{t('successTitle')}</h2>
            <p className="text-gray-500 text-lg mb-8">{t('successDesc')}</p>
            <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
              <div className="bg-green-500 h-full w-full animate-pulse"></div>
            </div>
          </div>
        </div>
      )}

      {/* Order History Modal */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl shadow-2xl flex flex-col max-w-2xl w-full max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center bg-gray-50">
              <h2 className="text-2xl font-bold text-gray-800">{t('historyTitle')}</h2>
              <button 
                onClick={() => setShowHistory(false)}
                className="text-gray-500 hover:text-gray-800 text-2xl font-bold w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-200 transition-colors"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {orderHistory.length === 0 ? (
                <div className="text-center text-gray-500 py-10">
                  <p className="text-xl">{t('historyEmpty')}</p>
                </div>
              ) : (
                orderHistory.map((order, index) => (
                  <div key={order.id} className="border border-gray-200 rounded-xl p-4 bg-white shadow-sm">
                    <div className="flex justify-between items-center mb-4 border-b pb-2">
                      <span className="font-bold text-lg text-gray-700">{t('orderNumber')}{orderHistory.length - index}</span>
                      <span className="text-gray-500 font-medium flex items-center gap-1">
                        🕒 {order.time}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {order.items.map((item) => (
                        <div key={item.id} className="flex justify-between items-center text-gray-600">
                          <span>{item.quantity}x {item.name[lang]}</span>
                          <span>{formatPrice(item.price * item.quantity)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 pt-2 border-t flex justify-between items-center font-bold text-gray-800">
                      <span>{t('total')}:</span>
                      <span className="text-red-600">{formatPrice(order.total)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
            {orderHistory.length > 0 && (
              <div className="p-6 border-t border-gray-200 bg-white">
                <div className="flex justify-between items-center mb-6">
                  <span className="text-xl font-bold text-gray-700">{t('grandTotal')}:</span>
                  <span className="text-3xl font-bold text-red-600">
                    {formatPrice(orderHistory.reduce((sum, order) => sum + order.total, 0))}
                  </span>
                </div>
                <button 
                  onClick={() => {
                    alert('Thanh toán thành công!');
                    setOrderHistory([]);
                    setShowHistory(false);
                  }}
                  className="w-full bg-red-600 hover:bg-red-700 text-white py-4 rounded-xl font-bold text-2xl transition-colors shadow-lg"
                >
                  {t('checkoutBtn')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
