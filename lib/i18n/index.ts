import { create } from 'zustand';
import en from './en';
import zh from './zh';

export type Locale = 'en' | 'zh';
export type TranslationKey = keyof typeof en;

const translations: Record<Locale, Record<string, string>> = { en, zh };

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: 'zh',
  setLocale: (locale) => set({ locale }),
}));

/**
 * Get a translated string with optional interpolation.
 * Usage: t('buckets.deleteDesc', { name: 'my-bucket' })
 */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const locale = useI18nStore.getState().locale;
  let text = translations[locale]?.[key] ?? translations.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}

/**
 * React hook for i18n. Returns a `t` function that re-renders on locale change.
 */
export function useT() {
  const locale = useI18nStore((s) => s.locale);
  return (key: TranslationKey, params?: Record<string, string | number>): string => {
    let text = translations[locale]?.[key] ?? translations.en[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, String(v));
      }
    }
    return text;
  };
}
