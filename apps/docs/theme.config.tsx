import React from 'react'
import { useConfig } from 'nextra-theme-docs'

const config = {
  logo: <span>Building OS</span>,
  project: {
    link: 'https://github.com/shenjingnan/building-os',
  },
  docsRepositoryBase: 'https://github.com/shenjingnan/building-os/tree/main/apps/docs',
  footer: {
    text: 'Building OS Docs',
  },
  useNextSeoProps() {
    return {
      titleTemplate: '%s – Building OS'
    }
  },
  head: () => {
    const { frontMatter } = useConfig()
    return (
      <>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content={frontMatter.description || 'Building OS: 智能建筑操作系统'} />
      </>
    )
  }
}

export default config
