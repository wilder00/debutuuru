// Rendered Markdown, the way GitHub shows it: GFM (tables, task lists,
// footnotes, autolinks), emoji shortcodes, alerts (> [!NOTE]), math (KaTeX)
// and Mermaid diagrams, with code blocks colored like the code viewer.
//
// The Markdown comes from the repository, so it's untrusted: raw HTML goes
// through rehype-sanitize with GitHub's own schema (no scripts, no event
// handlers, no iframes, no styles), Mermaid runs with securityLevel "strict",
// and the app's CSP keeps blocking scripts and external images.
import "katex/dist/katex.min.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightCode, tagHighlighter, tags as t } from "@lezer/highlight";
import { Children, isValidElement, useEffect, useId, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkEmoji from "remark-emoji";
import remarkGfm from "remark-gfm";
import { remarkAlert } from "remark-github-blockquote-alert";
import remarkMath from "remark-math";
import type { FileBytes } from "../../bindings/FileBytes";
import { joinPath, type Link } from "./links";

type Props = {
  /** Reads an image of the repository or folder (stable between renders). */
  readBytes: (path: string) => Promise<FileBytes>;
  path: string;
  text: string;
  /** Opens a repo file or folder (relative links). */
  onFollow: (link: Link) => void;
};

// GitHub's schema, plus what the alert and math plugins produce: classes
// (styling only) and the alert icons' <svg><path>.
const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "svg", "path"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className"],
    svg: ["viewBox", "width", "height", "ariaHidden"],
    path: ["d"],
  },
};

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const isExternal = (href: string) => /^(https?:|mailto:|tel:)/i.test(href);

/** GitHub-style heading anchor: "Hello, World!" → "hello-world". */
const slug = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");

const textOf = (node: ReactNode): string =>
  Children.toArray(node)
    .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : isValidElement<{ children?: ReactNode }>(c) ? textOf(c.props.children) : ""))
    .join("");

export function MarkdownView({ readBytes, path, text, onFollow }: Props) {
  const dir = dirOf(path);
  // The latest callback, without making the components below new.
  const follow = useRef(onFollow);
  follow.current = onFollow;

  // Stable between renders: react-markdown uses these as component types, so
  // new functions would remount every block (code blocks lost their colors
  // and painted them again on each refresh, which looked like flickering).
  const components = useMemo<Components>(() => {
    const heading =
      (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
      ({ children }: { children?: ReactNode }) => <Tag data-anchor={slug(textOf(children))}>{children}</Tag>;

    return {
      h1: heading("h1"),
      h2: heading("h2"),
      h3: heading("h3"),
      h4: heading("h4"),
      h5: heading("h5"),
      h6: heading("h6"),
      a: ({ href = "", children, title }) => (
        <a
          href={href}
          title={title ?? (isExternal(href) ? href : undefined)}
          onClick={(e) => {
            e.preventDefault();
            if (isExternal(href)) void openUrl(href);
            else if (href.startsWith("#")) {
              const id = decodeURIComponent(href.slice(1)).replace(/^user-content-/, "");
              e.currentTarget.closest(".markdown-body")?.querySelector(`[data-anchor="${CSS.escape(id)}"], [id="user-content-${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" });
            } else follow.current({ from: 0, to: 0, spec: href, lang: "markdown" });
          }}
        >
          {children}
        </a>
      ),
      img: ({ src, alt, title }) => <RepoImage read={readBytes} dir={dir} src={typeof src === "string" ? src : ""} alt={alt ?? ""} title={title} />,
      input: (p: ComponentProps<"input">) => <input {...p} disabled />,
      pre: ({ children }) => <>{children}</>,
      code: ({ className, children }) => {
        const lang = /language-([\w+#.-]+)/.exec(className ?? "")?.[1];
        const code = textOf(children).replace(/\n$/, "");
        const block = lang !== undefined || code.includes("\n");
        if (!block) return <code className={className}>{children}</code>;
        if (lang === "mermaid") return <Mermaid code={code} />;
        return <CodeBlock code={code} lang={lang} />;
      },
    };
  }, [readBytes, dir]);

  // Parsing only when the text (or where its images come from) changes.
  const body = useMemo(
    () => (
      <Markdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={components}>
        {text}
      </Markdown>
    ),
    [text, components],
  );

  return (
    <div className="markdown-scroll">
      <article className="markdown-body">{body}</article>
    </div>
  );
}

const REMARK = [remarkGfm, remarkEmoji, remarkAlert, remarkMath];
const REHYPE: NonNullable<ComponentProps<typeof Markdown>["rehypePlugins"]> = [rehypeRaw, [rehypeSanitize, schema], rehypeKatex];

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  // As <img>, SVG never runs scripts.
  svg: "image/svg+xml",
};

/** Images from the repo (any revision) or folder as data URLs. External images are
 *  blocked by the CSP (no tracking pixels): their alt text shows instead. */
function RepoImage({ read, dir, src, alt, title }: { read: (path: string) => Promise<FileBytes>; dir: string; src: string; alt: string; title?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const path = src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith("//") ? joinPath(src.startsWith("/") ? "" : dir, decodeURIComponent(src.split(/[?#]/)[0])) : null;
  const mime = path ? MIME[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] : undefined;

  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (!path || !mime) return;
    let stale = false;
    read(path)
      .then((b) => !stale && setUrl(`data:${mime};base64,${b.base64}`))
      .catch(() => !stale && setFailed(true));
    return () => {
      stale = true;
    };
  }, [read, path, mime]);

  if (src.startsWith("data:image/")) return <img src={src} alt={alt} title={title} />;
  if (url) return <img src={url} alt={alt} title={title} />;
  if (path && mime && !failed) return <span className="md-img-placeholder">{alt}</span>;
  return (
    <span className="md-img-placeholder" title={src}>
      🖼 {alt || src}
    </span>
  );
}

/** Classes for the --syn-* colors (same palette as the code viewer). */
const highlighter = tagHighlighter([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], class: "syn-keyword" },
  { tag: [t.string, t.special(t.string), t.regexp, t.character], class: "syn-string" },
  { tag: [t.number, t.integer, t.float], class: "syn-number" },
  { tag: [t.bool, t.null, t.atom, t.constant(t.variableName), t.standard(t.variableName)], class: "syn-constant" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], class: "syn-function" },
  { tag: [t.typeName, t.className, t.namespace, t.tagName, t.self], class: "syn-type" },
  { tag: [t.propertyName, t.attributeName, t.labelName], class: "syn-property" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: "syn-comment" },
  { tag: [t.meta, t.processingInstruction], class: "syn-meta" },
  { tag: [t.inserted], class: "syn-inserted" },
  { tag: [t.deleted], class: "syn-deleted" },
]);

/** A fenced code block, colored with the language's Lezer parser. */
function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [html, setHtml] = useState<ReactNode[] | null>(null);
  useEffect(() => {
    setHtml(null);
    const desc = lang ? LanguageDescription.matchLanguageName(languages, lang, true) : null;
    if (!desc) return;
    let stale = false;
    desc
      .load()
      .then((support) => {
        if (stale) return;
        const out: ReactNode[] = [];
        let k = 0;
        highlightCode(
          code,
          support.language.parser.parse(code),
          highlighter,
          (text, classes) => out.push(classes ? <span key={k++} className={classes}>{text}</span> : text),
          () => out.push("\n"),
        );
        setHtml(out);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [code, lang]);
  return (
    <pre className="md-code">
      <code>{html ?? code}</code>
    </pre>
  );
}

/** Theme colors for diagrams, read from the app's tokens. */
function mermaidTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    darkMode: true,
    background: v("--bg-panel"),
    primaryColor: v("--bg-raised"),
    primaryTextColor: v("--text"),
    primaryBorderColor: v("--border-strong"),
    secondaryColor: v("--bg-active"),
    tertiaryColor: v("--bg-hover"),
    lineColor: v("--text-muted"),
    textColor: v("--text"),
    mainBkg: v("--bg-raised"),
    nodeBorder: v("--border-strong"),
    clusterBkg: v("--bg-panel"),
    titleColor: v("--text"),
    edgeLabelBackground: v("--bg-panel"),
    fontFamily: v("--font-ui"),
  };
}

/** A ```mermaid block as a diagram. Mermaid is big: it's only downloaded the
 *  first time a document has a diagram. */
function Mermaid({ code }: { code: string }) {
  const id = "mmd-" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "base", themeVariables: mermaidTheme() });
        const { svg } = await mermaid.render(id, code);
        if (!stale) setSvg(svg);
      })
      .catch((e) => !stale && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      stale = true;
    };
  }, [id, code]);
  if (error) return <pre className="md-code md-error">{error}</pre>;
  // Mermaid's "strict" level sanitizes its own SVG output (DOMPurify).
  return svg ? <div className="md-mermaid" dangerouslySetInnerHTML={{ __html: svg }} /> : <pre className="md-code">{code}</pre>;
}
