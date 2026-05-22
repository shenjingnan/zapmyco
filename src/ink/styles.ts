/** 颜色值（命名颜色、hex 或 RGB） */
export type Color = string;

/**
 * 样式属性 — 应用于 Box 和 Text 组件。
 *
 * 布局属性用于 Box 组件（通过 Yoga flexbox 计算尺寸和位置），
 * 排版属性用于 Text 组件（设置颜色、粗体等）。
 */
export interface Styles {
  // 布局（Box）
  width?: number | string;
  height?: number | string;
  minWidth?: number;
  minHeight?: number;
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  justifyContent?: 'flex-start' | 'flex-end' | 'center';
  alignItems?: 'flex-start' | 'flex-end' | 'center';
  padding?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  margin?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  // 排版（Text）
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}
