import { parseDateHeading } from "./date.js";

export function escapeHtml(value = "") {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl, window.location.href);
    const protocol = url.protocol.toLowerCase();

    if (protocol === "http:" || protocol === "https:" || protocol === "mailto:") {
      return url.href;
    }
  } catch (error) {
    return "";
  }

  return "";
}

function renderInlineSegment(segment) {
  let html = escapeHtml(segment);

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
    const href = safeUrl(url);
    const safeLabel = escapeHtml(label);

    if (!href) {
      return safeLabel;
    }

    return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${safeLabel}</a>`;
  });

  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^\*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  return html;
}

function renderInline(text) {
  const segments = text.split(/(`[^`]+`)/g);

  return segments
    .map((segment) => {
      if (segment.startsWith("`") && segment.endsWith("`")) {
        return `<code>${escapeHtml(segment.slice(1, -1))}</code>`;
      }

      return renderInlineSegment(segment);
    })
    .join("");
}

function renderListItem(content) {
  const taskMatch = content.match(/^\[( |x|X)\]\s*(.*)$/);

  if (taskMatch) {
    const checked = taskMatch[1].toLowerCase() === "x";
    return [
      `<span class="task-box${checked ? " is-checked" : ""}">${checked ? "x" : ""}</span>`,
      renderInline(taskMatch[2]),
    ].join("");
  }

  const timestampMatch = content.match(/^\[(\d{1,2}:\d{2}(?:\s?[AP]M)?)\]\s*(.*)$/);

  if (timestampMatch) {
    return `<span class="timestamp">[${escapeHtml(timestampMatch[1])}]</span>${renderInline(timestampMatch[2])}`;
  }

  return renderInline(content);
}

export function stripFrontmatter(markdown = "") {
  if (!markdown.startsWith("---\n")) {
    return markdown;
  }

  const endIndex = markdown.indexOf("\n---\n", 4);
  if (endIndex === -1) {
    return markdown;
  }

  return markdown.slice(endIndex + 5);
}

export function markdownToText(markdown = "") {
  return stripFrontmatter(markdown)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[*_>#-]/g, " ")
    .replace(/\[( |x|X)\]/g, " ")
    .replace(/\[(\d{1,2}:\d{2}(?:\s?[AP]M)?)\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function renderMarkdown(markdown = "", options = {}) {
  const source = stripFrontmatter(markdown).replace(/\r\n/g, "\n");
  const lines = source.split("\n");
  const todayKey = options.todayKey || "";

  let html = "";
  let paragraph = [];
  let quote = [];
  let listOpen = false;
  let inCodeBlock = false;
  let codeLines = [];

  const closeParagraph = () => {
    if (!paragraph.length) {
      return;
    }

    html += `<p>${renderInline(paragraph.join(" "))}</p>`;
    paragraph = [];
  };

  const closeQuote = () => {
    if (!quote.length) {
      return;
    }

    html += `<blockquote><p>${renderInline(quote.join(" "))}</p></blockquote>`;
    quote = [];
  };

  const closeList = () => {
    if (!listOpen) {
      return;
    }

    html += "</ul>";
    listOpen = false;
  };

  const closeCodeBlock = () => {
    if (!inCodeBlock) {
      return;
    }

    html += `<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`;
    inCodeBlock = false;
    codeLines = [];
  };

  for (const line of lines) {
    if (inCodeBlock) {
      if (line.startsWith("```")) {
        closeCodeBlock();
      } else {
        codeLines.push(line);
      }

      continue;
    }

    if (line.startsWith("```")) {
      closeParagraph();
      closeQuote();
      closeList();
      inCodeBlock = true;
      continue;
    }

    if (!line.trim()) {
      closeParagraph();
      closeQuote();
      closeList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      closeParagraph();
      closeQuote();
      closeList();

      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const headingKey = parseDateHeading(line);
      const classes = [];

      if (level === 2 && headingKey) {
        classes.push("day-heading");

        if (headingKey === todayKey) {
          classes.push("today");
        }
      }

      const classAttribute = classes.length ? ` class="${classes.join(" ")}"` : "";
      html += `<h${level}${classAttribute}>${renderInline(content)}</h${level}>`;
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      closeParagraph();
      closeList();
      quote.push(quoteMatch[1]);
      continue;
    }

    const listMatch = line.match(/^(\s*)-\s+(.*)$/);
    if (listMatch) {
      closeParagraph();
      closeQuote();

      if (!listOpen) {
        html += "<ul>";
        listOpen = true;
      }

      const indent = Math.floor(listMatch[1].length / 2);
      const style = indent ? ` style="margin-left:${indent * 1.2}rem"` : "";
      html += `<li${style}>${renderListItem(listMatch[2])}</li>`;
      continue;
    }

    closeQuote();
    closeList();
    paragraph.push(line.trim());
  }

  closeParagraph();
  closeQuote();
  closeList();
  closeCodeBlock();

  return html || '<p class="placeholder-copy">Nothing to preview yet.</p>';
}
