// UI translations (i18next). Texts live in one JSON file per language under
// ./locales, in i18next's JSON v4 format (plural keys `_one`, `_other`… follow
// the CLDR categories of each language), so translators and tools such as
// Weblate can edit them without touching code. English is the source and the
// fallback: a missing key shows the English text. `pnpm check:locales` (run by
// `pnpm build`) fails when a language misses keys, plural forms or variables.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import es from "./locales/es.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";

/** Supported languages, named in their own language (how pickers show them). */
export const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
] as const;

export type Language = (typeof LANGUAGES)[number]["code"];

const SUPPORTED: readonly string[] = LANGUAGES.map((l) => l.code);

/** First of the system's preferred languages that we support, else English. */
export function systemLanguage(preferred: readonly string[] = navigator.languages ?? [navigator.language]): Language {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split("-")[0];
    if (SUPPORTED.includes(base)) return base as Language;
  }
  return "en";
}

/** The language to show for a saved setting (`null` = follow the system). */
export function resolveLanguage(setting: string | null): Language {
  return setting && SUPPORTED.includes(setting) ? (setting as Language) : systemLanguage();
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es }, ja: { translation: ja }, ko: { translation: ko } },
  lng: systemLanguage(),
  fallbackLng: "en",
  supportedLngs: SUPPORTED,
  // React already escapes text; `<code>` tags are mapped by <Trans>.
  interpolation: { escapeValue: false },
  // Editor phrases contain spaces and "$"; keys never use ":" namespaces.
  nsSeparator: false,
  returnNull: false,
});

// Screen readers pick their voice and Windows picks Japanese or Korean glyph
// shapes (Han unification) from `lang`, and styles.css chooses CJK fallback
// fonts with :lang(), so keep it in sync with the UI language.
const syncLang = (lng: string) => document.documentElement.setAttribute("lang", lng);
syncLang(i18n.language);
i18n.on("languageChanged", syncLang);

export default i18n;
