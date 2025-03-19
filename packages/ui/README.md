# @zapmyco/ui

Zapmyco UI 是一个为智能家居系统设计的React组件库，旨在帮助开发者快速构建智能家居应用的用户界面。

## 特性

- 🏠 专为智能家居设计的组件
- 🎨 可定制的主题和样式
- 📱 响应式设计，适配各种设备
- 🔌 易于集成的API
- 📦 支持按需加载
- 🌙 内置暗黑模式支持

## 安装

```bash
# 使用npm
npm install @zapmyco/ui

# 使用yarn
yarn add @zapmyco/ui

# 使用pnpm
pnpm add @zapmyco/ui
```

## 使用示例

```jsx
import { DeviceCard } from '@zapmyco/ui';

// 设备数据
const device = {
  id: 'light-1',
  name: '客厅灯',
  type: 'light',
  status: {
    online: true,
    power: true,
    brightness: 80
  }
};

// 在组件中使用
function MyComponent() {
  const handleToggle = (device, value) => {
    console.log(`设备 ${device.name} 状态切换为 ${value ? '开启' : '关闭'}`);
  };

  return (
    <DeviceCard 
      device={device} 
      onToggle={handleToggle}
    />
  );
}
```

## 组件

### 基础组件

- `Button` - 按钮组件
- `Card` - 卡片组件
- `Icon` - 图标组件

### 设备组件

- `DeviceCard` - 设备卡片组件
- `DeviceControl` - 设备控制组件
- `DeviceList` - 设备列表组件

### 工具组件

- `ThemeProvider` - 主题提供者
- `useDeviceStatus` - 设备状态钩子
- `useMediaQuery` - 媒体查询钩子

## 自定义主题

```jsx
import { ThemeProvider } from '@zapmyco/ui';

function App() {
  return (
    <ThemeProvider
      theme={{
        colorScheme: 'dark',
        primaryColor: '#10b981', // 绿色
        borderRadius: 'large',
        animation: true
      }}
    >
      <YourApp />
    </ThemeProvider>
  );
}
```

## 开发

本项目使用NX进行管理，提供了以下命令：

```bash
# 安装依赖
pnpm install

# 启动开发服务器（监视模式）
pnpm dev

# 构建
pnpm build

# 运行测试
pnpm test

# 运行Storybook
pnpm storybook
```

## 技术栈

- **React**: UI库基础框架
- **TypeScript**: 类型安全
- **Vite**: 快速的构建工具
- **Storybook**: 组件文档和开发环境
- **NX**: Monorepo管理工具

## 贡献指南

欢迎贡献代码、报告问题或提出建议。请查看我们的[贡献指南](https://github.com/zapmyco/zapmyco/blob/main/CONTRIBUTING.md)了解更多信息。

## 许可证

[Apache-2.0](LICENSE) 