/**
 * InkContext — 提供对当前 Ink 实例的访问
 *
 * 由 Ink 类在 render 时自动包裹在组件树外层。
 * 子组件可通过此上下文访问 Ink 实例以订阅 resize 等事件。
 */

import { createContext } from 'react';
import type { Ink } from '../ink';

export const InkContext = createContext<Ink | null>(null);
