import { LANGS } from '../../../shared/types.ts';
import type { Lang } from '../../../shared/types.ts';

type Props = {
  lang: Lang;
  onChange: (lang: Lang) => void;
};

export function LanguageSwitcher({ lang, onChange }: Props) {
  return (
    <div className="flex gap-1.5 flex-wrap justify-center">
      {LANGS.map((l) => (
        <button
          key={l}
          onClick={() => onChange(l)}
          className={`text-xs px-2 py-1 rounded font-bold ${
            lang === l ? 'bg-white text-red-600 shadow' : 'bg-red-700 text-white hover:bg-red-500'
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
