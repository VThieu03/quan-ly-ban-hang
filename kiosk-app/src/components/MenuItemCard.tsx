import { formatPrice } from '../../../shared/format.ts';
import type { Lang, MenuItem } from '../../../shared/types.ts';
import type { Translate } from '../i18n.ts';

type Props = {
  item: MenuItem;
  lang: Lang;
  t: Translate;
  quantityInCart: number;
  onAdd: () => void;
};

export function MenuItemCard({ item, lang, t, quantityInCart, onAdd }: Props) {
  return (
    <button
      type="button"
      disabled={!item.available}
      onClick={onAdd}
      className="relative text-left bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col transition-shadow enabled:hover:shadow-md enabled:active:scale-[0.98] disabled:opacity-60"
    >
      <div className="aspect-4/3 bg-gray-200 w-full relative">
        <img src={item.image} alt={item.name[lang]} loading="lazy" className="w-full h-full object-cover" />
        {!item.available && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-white font-bold text-lg">
            {t('soldOut')}
          </span>
        )}
        {quantityInCart > 0 && (
          <span className="absolute top-2 right-2 bg-red-600 text-white rounded-full min-w-8 h-8 px-2 flex items-center justify-center font-bold shadow">
            {quantityInCart}
          </span>
        )}
      </div>
      <div className="p-3 md:p-4 flex flex-col flex-1 justify-between gap-2">
        <h3 className="font-bold text-base md:text-xl text-gray-800 leading-tight">{item.name[lang]}</h3>
        <div className="flex justify-between items-center">
          <span className="text-red-600 font-bold md:text-xl">{formatPrice(item.price)}</span>
          {item.available && (
            <span className="bg-red-600 text-white rounded-full w-8 h-8 md:w-10 md:h-10 flex items-center justify-center font-bold text-xl">
              +
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
