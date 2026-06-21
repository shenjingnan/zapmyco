import { Check, Copy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createHighlighter, type Highlighter } from 'shiki/bundle/full';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// ── Shiki 单例（只初始化一次） ──

let highlighterInstance: Highlighter | null = null;
let highlighterLoading: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (highlighterInstance) return Promise.resolve(highlighterInstance);
  if (highlighterLoading) return highlighterLoading;

  highlighterLoading = createHighlighter({
    themes: ['github-light', 'github-dark-dimmed'],
    langs: [
      'rust',
      'typescript',
      'javascript',
      'python',
      'bash',
      'json',
      'sql',
      'yaml',
      'toml',
      'markdown',
      'diff',
      'shell',
      'css',
      'html',
      'go',
      'java',
      'ruby',
      'cpp',
      'c',
      'graphql',
      'http',
      'plaintext',
    ],
  }).then((hl) => {
    highlighterInstance = hl;
    highlighterLoading = null;
    return hl;
  });

  return highlighterLoading;
}

// ── 代码块组件 ──

interface CodeBlockProps {
  className?: string;
  children: React.ReactNode;
}

export function CodeBlock({ className, children }: CodeBlockProps) {
  const codeText = String(children).replace(/\n$/, '');
  const lang = className?.replace(/^language-/, '') || 'text';
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const mountedRef = useRef(true);

  // 语法高亮
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    getHighlighter()
      .then((hl) => {
        if (cancelled || !mountedRef.current) return;
        const loadedLangs: string[] = hl.getLoadedLanguages();
        const resolvedLang = loadedLangs.includes(lang) ? lang : 'text';
        const highlighted = hl.codeToHtml(codeText, {
          lang: resolvedLang,
          themes: {
            light: 'github-light',
            dark: 'github-dark-dimmed',
          },
          defaultColor: 'light-dark()',
        });
        setHtml(highlighted);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [codeText, lang]);

  // 复制
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 浏览器可能拒绝剪贴板权限
    }
  }, [codeText]);

  return (
    <div className="group/codeblock my-3 overflow-hidden rounded-xl border border-border bg-[var(--shiki-background,#f6f8fa)] dark:bg-[var(--shiki-background,#24292f)]">
      {/* 标题栏 */}
      <div className="flex items-center justify-between border-b border-border/50 bg-muted/30 px-4 py-1.5">
        {lang ? (
          <Badge variant="secondary" className="font-mono text-[10px] tracking-wider">
            {lang}
          </Badge>
        ) : (
          <span />
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={handleCopy}
          className="cursor-pointer text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={copied ? '已复制' : '复制代码'}
        >
          {copied ? <Check className="text-green-500" /> : <Copy />}
        </Button>
      </div>

      {/* 代码内容 */}
      {html ? (
        <div
          className="overflow-x-auto p-4 text-sm leading-relaxed [&_pre]:m-0 [&_pre]:bg-transparent! [&_pre]:p-0 [&_code]:bg-transparent! [&_code]:p-0"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki 生成的语法高亮 HTML 需要直接插入 DOM
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto p-4 text-sm leading-relaxed text-foreground">
          <code>{codeText}</code>
        </pre>
      )}
    </div>
  );
}
