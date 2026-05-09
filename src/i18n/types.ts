/**
 * i18next TypeScript 类型增强
 *
 * 通过 module augmentation 让 t() 调用有类型检查和自动补全。
 */

import type zhCN from './locales/zh-CN.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      translation: typeof zhCN;
    };
  }
}
