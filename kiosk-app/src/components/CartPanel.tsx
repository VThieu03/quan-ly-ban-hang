import { formatPrice } from '../../../shared/format.ts';
import type { Lang, MenuItem } from '../../../shared/types.ts';
import type { Translate } from '../i18n.ts';

export type CartEntry = { item: MenuItem; quantity: number };

type Props = {
  entries: CartEntry[];
  lang: Lang;
  t: Translate;
  note: string;
  sending: boolean;
  error: string | null;
  onNoteChange: (note: string) => void;
  onAdd: (id: string) => void;
  onDecrease: (id: string) => void;
  onRemove: (id: string) => void;
  onSubmit: () => void;
};

export function CartPanel({
  entries,
  lang,
  t,
  note,
  sending,
  error,
  onNoteChange,
  onAdd,
  onDecrease,
  onRemove,
  onSubmit,
}: Props) {
  const total = entries.reduce((sum, e) => sum + e.item.price * e.quantity, 0);

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {entries.length === 0 ? (
          <div className="h-full min-h-40 flex flex-col items-center justify-center text-gray-400">
            <span className="text-4xl mb-2">🛒</span>
            <p>{t('emptyCart')}</p>
          </div>
        ) : (
          entries.map(({ item, quantity }) => (
            <div key={item.id} className="flex flex-col bg-gray-50 p-3 rounded-xl">
              <div className="flex justify-between items-start mb-2">
                <span className="font-bold text-gray-800 leading-tight pr-2">{item.name[lang]}</span>
                <button
                  onClick={() => onRemove(item.id)}
                  aria-label="×"
                  className="text-gray-400 hover:text-red-500 font-bold text-xl leading-none px-1"
                >
                  ×
                </button>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-red-600 font-semibold">{formatPrice(item.price * quantity)}</span>
                <div className="flex items-center gap-3 bg-white px-2 py-1 rounded-lg border border-gray-200">
                  <button
                    onClick={() => onDecrease(item.id)}
                    className="w-8 h-8 flex items-center justify-center rounded-md bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold"
                  >
                    −
                  </button>
                  <span className="font-bold min-w-[1.5rem] text-center">{quantity}</span>
                  <button
                    onClick={() => onAdd(item.id)}
                    className="w-8 h-8 flex items-center justify-center rounded-md bg-red-100 hover:bg-red-200 text-red-600 font-bold"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-4 border-t border-gray-200 bg-white space-y-3">
        {entries.length > 0 && (
          <textarea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            maxLength={200}
            rows={2}
            placeholder={t('notePlaceholder')}
            className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none focus:outline-red-400"
          />
        )}
        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg p-2">{error}</p>}
        <div className="flex justify-between items-center">
          <span className="text-gray-600 font-semibold">{t('total')}</span>
          <span className="text-2xl font-bold text-red-600">{formatPrice(total)}</span>
        </div>
        <button
          className="w-full py-4 rounded-xl font-bold text-xl text-white transition-colors bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          disabled={entries.length === 0 || sending}
          onClick={onSubmit}
        >
          {sending ? t('sending') : t('orderBtn')}
        </button>
      </div>
    </>
  );
}
