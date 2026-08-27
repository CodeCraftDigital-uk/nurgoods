import { Fragment, type ReactNode } from "react";

/**
 * Minimal markdown renderer for owner approved content. It renders to React
 * elements only, never to raw HTML, so stored content cannot inject markup.
 * Supports headings, paragraphs, lists, blockquotes, links, bold and italic.
 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const pattern = /(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (linkMatch) {
        const href = linkMatch[2]!;
        const safe = /^(https?:|mailto:|\/)/i.test(href) ? href : "#";
        nodes.push(
          <a
            key={key}
            href={safe}
            className="underline decoration-gold underline-offset-4 hover:text-foreground"
          >
            {linkMatch[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let ordered = false;
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ");
    blocks.push(
      <p key={`p-${key++}`} className="text-base leading-relaxed text-muted-foreground">
        {inline(text, `p${key}`)}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (list.length === 0) return;
    const items = list.map((item, i) => (
      <li key={i} className="leading-relaxed">
        {inline(item, `li${key}-${i}`)}
      </li>
    ));
    blocks.push(
      ordered ? (
        <ol key={`l-${key++}`} className="list-decimal space-y-2 pl-5 text-muted-foreground">
          {items}
        </ol>
      ) : (
        <ul key={`l-${key++}`} className="list-disc space-y-2 pl-5 text-muted-foreground">
          {items}
        </ul>
      ),
    );
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    const quote = /^>\s+(.*)$/.exec(line);

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]!.length;
      const content = inline(heading[2]!, `h${key}`);
      const classes =
        level <= 2
          ? "font-display text-2xl text-foreground sm:text-3xl"
          : "font-display text-xl text-foreground";
      const Tag = (level === 1 ? "h2" : level === 2 ? "h2" : level === 3 ? "h3" : "h4") as
        "h2" | "h3" | "h4";
      blocks.push(
        <Tag key={`h-${key++}`} className={`${classes} mt-4`}>
          {content}
        </Tag>,
      );
      continue;
    }
    if (bullet) {
      flushParagraph();
      if (ordered) flushList();
      ordered = false;
      list.push(bullet[1]!);
      continue;
    }
    if (numbered) {
      flushParagraph();
      if (!ordered) flushList();
      ordered = true;
      list.push(numbered[1]!);
      continue;
    }
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push(
        <blockquote
          key={`q-${key++}`}
          className="border-l-2 border-gold pl-4 text-base italic leading-relaxed text-muted-foreground"
        >
          {inline(quote[1]!, `q${key}`)}
        </blockquote>,
      );
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();

  return (
    <div className="space-y-5">
      {blocks.map((block, i) => (
        <Fragment key={i}>{block}</Fragment>
      ))}
    </div>
  );
}
