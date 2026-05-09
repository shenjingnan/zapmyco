/**
 * i18next 国际化模块
 *
 * 使用 i18next 实现国际化支持。
 * 通过传入静态 resources 实现同步初始化，无需 async/await。
 * 翻译文件为标准 JSON 格式，未来 React Web 界面可复用。
 */

import i18next from 'i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

// 同步初始化 i18next（传入静态 resources，无 backend → 同步）
i18next.init({
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en },
  },
  initAsync: false,
  interpolation: {
    escapeValue: false, // CLI 不需要 HTML 转义
    prefix: '{{',
    suffix: '}}',
  },
  returnNull: false,
  returnEmptyString: true,
});

export const { t } = i18next;

/**
 * 设置当前语言
 */
export function setLocale(locale: string): void {
  // 使用 changeLanguage（虽然是 async，但 language 属性会同步更新）
  i18next.changeLanguage(locale).catch(() => {
    // 静默处理错误
  });
}

/**
 * 获取当前语言
 */
export function getCurrentLocale(): string {
  return i18next.language;
}

export default i18next;
