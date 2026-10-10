import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

// Keep wide tables scrollable without widening the answer panel.
markdown.renderer.rules.table_open = () =>
  '<div class="markdown-table" tabindex="0" role="region" aria-label="回答中的表格"><table>\n';
markdown.renderer.rules.table_close = () => "</table></div>\n";

export function renderMarkdown(content) {
  return markdown.render(content || "");
}
