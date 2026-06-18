import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

interface MarkdownRendererProps {
  content: string
}

const components: Components = {
  code: ({ className, children, ...props }) => {
    const isInline = !className
    if (isInline) {
      return (
        <code
          className="rounded bg-gray-700/50 px-1 py-0.5 text-sm"
          {...props}
        >
          {children}
        </code>
      )
    }
    return (
      <pre className="overflow-x-auto rounded bg-gray-800 p-3 text-sm">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    )
  },
  a: ({ children, href, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-blue-400 underline hover:text-blue-300"
      {...props}
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse border border-gray-600 text-sm">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-gray-600 bg-gray-700/50 px-3 py-1.5 text-left font-medium">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-gray-600 px-3 py-1.5">{children}</td>
  ),
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={components}
    >
      {content}
    </ReactMarkdown>
  )
}
