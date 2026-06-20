import type { Preview } from '@storybook/react-vite'
import { ConfigProvider } from 'antd'
import { warmTheme } from '../src/config/theme'
import React from 'react'
import '../src/index.css'

const preview: Preview = {
  decorators: [
    (Story) => (
      <ConfigProvider theme={warmTheme}>
        <div className="p-8">
          <Story />
        </div>
      </ConfigProvider>
    ),
  ],
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: 'todo',
    },
  },
}

export default preview
