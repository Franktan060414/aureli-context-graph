import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

// Keep wide tables scrollable without widening the answer panel.
markdown.renderer.rules.table_open = (_tokens, _index, _options, env) => env.preview
  ? '<div class="markdown-table"><table>\n'
  : '<div class="markdown-table" tabindex="0" role="region" aria-label="回答中的表格"><table>\n';
markdown.renderer.rules.table_close = () => "</table></div>\n";

// Canvas previews belong to the Tile selection control; links open in the reader.
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => env.preview
  ? '<span class="markdown-link">' : self.renderToken(tokens, index, options);
markdown.renderer.rules.link_close = (tokens, index, options, env, self) => env.preview
  ? '</span>' : self.renderToken(tokens, index, options);

export function renderMarkdown(content, { preview = false } = {}) {
  return markdown.render(content || "", { preview });
}
