import iso31661 from 'iso-3166-1';

const LANGUAGE_TO_LOCALE = {
  'zh-hans': 'zh-Hans',
  'zh-hant': 'zh-Hant',
  en: 'en',
  jp: 'ja',
  ko: 'ko'
};

const OTHER_LABELS = {
  'zh-hans': '其他',
  'zh-hant': '其他',
  en: 'Other',
  jp: 'その他',
  ko: '기타'
};

const TAIWAN_NAMING_MODE_LABELS = {
  'locale-default': {
    'zh-hans': '中国台湾',
    'zh-hant': '台灣',
    en: 'Taiwan',
    jp: '台湾',
    ko: '대만'
  },
  neutral: {
    'zh-hans': '台湾',
    'zh-hant': '台灣',
    en: 'Taiwan',
    jp: '台湾',
    ko: '대만'
  },
  cn: {
    'zh-hans': '中国台湾',
    'zh-hant': '中國台灣',
    en: 'Taiwan, China',
    jp: '台湾（中国）',
    ko: '대만(중국)'
  },
  roc: {
    'zh-hans': '中华民国（台湾）',
    'zh-hant': '中華民國（台灣）',
    en: 'Republic of China (Taiwan)',
    jp: '中華民国（台湾）',
    ko: '중화민국(대만)'
  }
};

const displayNameCache = new Map();
const countryOptionsCache = new Map();

export const DEFAULT_APP_SETTINGS = Object.freeze({
  taiwanNamingMode: 'locale-default'
});

export const TAIWAN_NAMING_MODE_OPTIONS = Object.freeze([
  { value: 'locale-default', label: '按语言默认' },
  { value: 'neutral', label: '台湾 / Taiwan' },
  { value: 'cn', label: '中国台湾 / Taiwan, China' },
  { value: 'roc', label: '中华民国（台湾） / Republic of China (Taiwan)' }
]);

const getLocale = (lang) => LANGUAGE_TO_LOCALE[lang] || 'en';

const getDisplayNames = (locale) => {
  if (!displayNameCache.has(locale)) {
    displayNameCache.set(locale, new Intl.DisplayNames([locale, 'en'], { type: 'region' }));
  }
  return displayNameCache.get(locale);
};

const OFFICIAL_ISO_COUNTRY_CODES = Object.freeze(
  iso31661
    .all()
    .map((country) => String(country.alpha2 || '').toUpperCase())
    .filter(Boolean)
);

const OFFICIAL_ISO_COUNTRY_CODE_SET = new Set(OFFICIAL_ISO_COUNTRY_CODES);

export const isOfficialIsoCountryCode = (code) => OFFICIAL_ISO_COUNTRY_CODE_SET.has(String(code || '').toUpperCase());

export const getCountryName = (code, lang, taiwanNamingMode = DEFAULT_APP_SETTINGS.taiwanNamingMode) => {
  const normalizedCode = String(code || '').toUpperCase();
  if (!normalizedCode) return '';
  if (normalizedCode === 'OTHER') return OTHER_LABELS[lang] || OTHER_LABELS.en;

  if (normalizedCode === 'TW') {
    const modeLabels = TAIWAN_NAMING_MODE_LABELS[taiwanNamingMode] || TAIWAN_NAMING_MODE_LABELS[DEFAULT_APP_SETTINGS.taiwanNamingMode];
    return modeLabels[lang] || modeLabels.en;
  }

  const locale = getLocale(lang);
  const localizedName = getDisplayNames(locale).of(normalizedCode);
  if (localizedName && localizedName !== normalizedCode && !localizedName.startsWith('Unknown')) {
    return localizedName;
  }

  const englishName = getDisplayNames('en').of(normalizedCode);
  if (englishName && englishName !== normalizedCode && !englishName.startsWith('Unknown')) {
    return englishName;
  }

  return normalizedCode;
};

export const getCountryOptions = (lang, taiwanNamingMode = DEFAULT_APP_SETTINGS.taiwanNamingMode) => {
  const cacheKey = `${lang}:${taiwanNamingMode}`;
  if (!countryOptionsCache.has(cacheKey)) {
    const locale = getLocale(lang);
    const options = OFFICIAL_ISO_COUNTRY_CODES
      .map((code) => ({
        code,
        label: getCountryName(code, lang, taiwanNamingMode)
      }))
      .sort((left, right) => left.label.localeCompare(right.label, locale));

    options.push({
      code: 'OTHER',
      label: OTHER_LABELS[lang] || OTHER_LABELS.en
    });

    countryOptionsCache.set(cacheKey, options);
  }

  return countryOptionsCache.get(cacheKey);
};
