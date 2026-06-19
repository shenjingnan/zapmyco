import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
}

const components: Components = {
  code: ({ className, children, ...props }) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code className="rounded bg-code-bg px-1 py-0.5 text-sm text-fg" {...props}>
          {children}
        </code>
      );
    }
    return (
      <pre className="overflow-x-auto rounded bg-code-bg p-3 text-sm text-fg">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    );
  },
  a: ({ children, href, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-amber-700 underline hover:text-amber-600"
      {...props}
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse border border-border text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-muted px-3 py-1.5 text-left font-medium text-fg">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border border-border px-3 py-1.5 text-fg">{children}</td>,
};

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}
