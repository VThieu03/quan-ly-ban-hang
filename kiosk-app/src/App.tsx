import { useState } from 'react';
import menuData from './data/menu.json';

type MenuItem = {
  id: string;
  name: string;
  price: number;
  image: string;
};

type MenuCategory = {
  category: string;
  items: MenuItem[];
};

type CartItem = MenuItem & {
  quantity: number;
};

function App() {
  const [activeCategory, setActiveCategory] = useState<string>(menuData[0].category);
  const [cart, setCart] = useState<CartItem[]>([]);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(price);
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

  const activeCategoryData = menuData.find((c) => c.category === activeCategory) as MenuCategory;

  return (
    <div className="flex h-screen bg-gray-100 font-sans overflow-hidden">
      {/* Sidebar / Categories */}
      <div className="w-48 bg-white shadow-md flex flex-col h-full overflow-y-auto">
        <div className="p-4 bg-red-600 text-white font-bold text-xl text-center">
          K-BBQ KIOSK
        </div>
        <div className="flex-1 py-4">
          {menuData.map((c) => (
            <button
              key={c.category}
              onClick={() => setActiveCategory(c.category)}
              className={`w-full py-6 px-4 text-left font-bold text-lg transition-colors ${
                activeCategory === c.category
                  ? 'bg-red-50 text-red-600 border-l-4 border-red-600'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {c.category}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content / Items */}
      <div className="flex-1 p-6 h-full overflow-y-auto">
        <h2 className="text-3xl font-bold text-gray-800 mb-6">{activeCategory}</h2>
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
                  alt={item.name}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-4 flex flex-col flex-1 justify-between">
                <h3 className="font-bold text-xl text-gray-800 mb-2">{item.name}</h3>
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
        <div className="p-4 bg-gray-50 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-800">Giỏ hàng</h2>
          <p className="text-gray-500">{cart.reduce((sum, item) => sum + item.quantity, 0)} món</p>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <span className="text-4xl mb-2">🛒</span>
              <p>Chưa có món nào</p>
            </div>
          ) : (
            cart.map((item) => (
              <div key={item.id} className="flex flex-col bg-gray-50 p-3 rounded-xl">
                <div className="flex justify-between items-start mb-2">
                  <span className="font-bold text-gray-800">{item.name}</span>
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
            <span className="text-gray-600 font-semibold">Tổng tiền</span>
            <span className="text-2xl font-bold text-red-600">{formatPrice(total)}</span>
          </div>
          <button 
            className={`w-full py-4 rounded-xl font-bold text-xl text-white transition-colors ${
              cart.length > 0 ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-300 cursor-not-allowed'
            }`}
            disabled={cart.length === 0}
            onClick={() => {
              if (cart.length > 0) {
                alert('Chức năng thanh toán đang được phát triển!');
              }
            }}
          >
            Thanh toán
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
