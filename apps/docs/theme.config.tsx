import React from 'react'
import { useConfig } from 'nextra-theme-docs'

const config = {
  logo: <span>ZapMyco</span>,
  project: {
    link: 'https://github.com/zapmyco/zapmyco',
  },
  docsRepositoryBase: 'https://github.com/zapmyco/zapmyco/tree/main/apps/docs',
  footer: {
    text: 'ZapMyco Docs',
  },
  useNextSeoProps() {
    return {
      titleTemplate: '%s – ZapMyco'
    }
  },
  head: () => {
    const { frontMatter } = useConfig()
    return (
      <>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content={frontMatter.description || 'ZapMyco: 智能建筑操作系统'} />
      </>
    )
  }
}

export default config
