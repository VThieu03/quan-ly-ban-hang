import { useEffect, useState } from 'react';
import { BANNER_ROTATE_MS } from '../../../shared/config.ts';
import type { Banner, Lang } from '../../../shared/types.ts';


type Props = {
  banners: Banner[];
  lang: Lang;
  onSelect: (banner: Banner) => void;
};

/** Banner quảng cáo đầu menu: tự chuyển mỗi 5 giây, bấm để tới danh mục / món khuyến mãi. */
export function BannerCarousel({ banners, lang, onSelect }: Props) {
  const [index, setIndex] = useState(0);
  const current = banners[index % banners.length];

  useEffect(() => {
    if (banners.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % banners.length), BANNER_ROTATE_MS);
    return () => clearInterval(timer);
  }, [banners.length]);

  if (!current) return null;
  const title = current.title[lang];
  const subtitle = current.subtitle[lang];

  return (
    <div className="relative mb-4 md:mb-6 rounded-2xl overflow-hidden shadow-sm bg-gray-200 aspect-[16/7] md:aspect-[16/5]">
      <button
        type="button"
        onClick={() => onSelect(current)}
        className={`absolute inset-0 w-full h-full text-left ${current.targetType === 'none' ? 'cursor-default' : ''}`}
      >
        <img key={current.id} src={current.image} alt={title} className="w-full h-full object-cover" />
        {(title || subtitle) && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 md:p-6 text-white">
            {title && <div className="text-xl md:text-3xl font-bold drop-shadow">{title}</div>}
            {subtitle && <div className="text-sm md:text-lg drop-shadow">{subtitle}</div>}
          </div>
        )}
      </button>
      {banners.length > 1 && (
        <div className="absolute top-3 right-3 flex gap-1.5">
          {banners.map((b, i) => (
            <button
              key={b.id}
              type="button"
              aria-label={`Banner ${i + 1}`}
              onClick={() => setIndex(i)}
              className={`h-2 rounded-full transition-all ${i === index % banners.length ? 'w-6 bg-white' : 'w-2 bg-white/60'}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
