import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';
import { Alert } from './ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

interface MarkdownRendererProps {
  content: string;
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="scroll-m-20 text-3xl font-bold mt-6 mb-4 font-heading">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="scroll-m-20 text-2xl font-semibold mt-5 mb-3 font-heading">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="scroll-m-20 text-xl font-semibold mt-4 mb-2 font-heading">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="scroll-m-20 text-lg font-medium mt-3 mb-2 font-heading">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="scroll-m-20 text-base font-medium mt-3 mb-1 font-heading">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="scroll-m-20 text-sm font-medium mt-3 mb-1 font-heading">{children}</h6>
  ),
  blockquote: ({ children }) => (
    <Alert
      role="blockquote"
      variant="default"
      className="my-3 [&>:first-child]:mt-0 [&>:last-child]:mb-0"
    >
      {children}
    </Alert>
  ),
  ul: ({ children }) => <ul className="my-3 ml-5 list-disc [&>li]:mt-1.5">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 ml-5 list-decimal [&>li]:mt-1.5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  code: ({ className, children, ...props }) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code className="rounded bg-muted px-1 py-0.5 text-sm text-foreground" {...props}>
          {children}
        </code>
      );
    }
    return <CodeBlock className={className}>{children}</CodeBlock>;
  },
  a: ({ children, href, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2 hover:text-primary/80"
      {...props}
    >
      {children}
    </a>
  ),
  table: ({ children }) => <Table>{children}</Table>,
  thead: ({ children }) => <TableHeader>{children}</TableHeader>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  th: ({ children }) => <TableHead className="whitespace-normal">{children}</TableHead>,
  td: ({ children }) => <TableCell className="whitespace-normal">{children}</TableCell>,
};

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components}>
      {content}
    </ReactMarkdown>
  );
}
