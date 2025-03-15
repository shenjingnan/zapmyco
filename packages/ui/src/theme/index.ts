import { createContext, useContext } from 'react';

/**
 * 主题配置接口
 */
export interface ThemeConfig {
  colorScheme: 'light' | 'dark' | 'system';
  primaryColor: string;
  borderRadius: 'none' | 'small' | 'medium' | 'large' | 'full';
  animation: boolean;
}

/**
 * 默认主题配置
 */
export const defaultTheme: ThemeConfig = {
  colorScheme: 'system',
  primaryColor: '#3b82f6', // 蓝色
  borderRadius: 'medium',
  animation: true,
};

/**
 * 主题上下文
 */
export const ThemeContext = createContext<{
  theme: ThemeConfig;
  setTheme: (theme: Partial<ThemeConfig>) => void;
}>({
  theme: defaultTheme,
  setTheme: () => {},
});

/**
 * 主题钩子
 */
export const useTheme = () => useContext(ThemeContext); 