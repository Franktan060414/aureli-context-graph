package com.aureli.ai.robot.service.search;

import com.aureli.ai.robot.utils.JsonUtil;
import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.spec.McpSchema;
import org.springframework.stereotype.Service;
import lombok.extern.slf4j.Slf4j;
import java.net.URI;
import java.net.http.HttpRequest;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import com.aureli.ai.robot.service.search.TavilySettingsRepository.Settings;

/** Uses Remote MCP initialize / tools/list / tools/call, not Tavily's REST search endpoint. */
@Service
@Slf4j
public class TavilyMcpSearchService {
    private static final Set<String> SEARCH_TOOLS = Set.of("tavily-search", "tavily_search");
    private static final Set<String> EXTRACT_TOOLS = Set.of("tavily-extract", "tavily_extract");
    private static final tools.jackson.databind.json.JsonMapper JSON = tools.jackson.databind.json.JsonMapper.builder().build();
    public static final int MAX_WEB_CONTENT_LENGTH = 500000;
    public static class WebPageReadException extends IllegalStateException {
        private final boolean advancedRetryAllowed;
        private final String reasonCode;
        public WebPageReadException(String message) { this(message, false, "READ_FAILED"); }
        private WebPageReadException(String message, boolean advancedRetryAllowed, String reasonCode) {
            super(message); this.advancedRetryAllowed = advancedRetryAllowed; this.reasonCode = reasonCode;
        }
    }
    public record WebPage(String title, String resolvedUrl, String content) {}
    private static final int MAX_CONTEXT_LENGTH = 24000;

    public void testConnection(Settings settings) {
        try (McpSyncClient client = connect(settings)) {
            client.initialize();
            searchTool(client);
        }
    }

    public String search(Settings settings, String query) {
        if (!settings.enabled() || query == null || query.isBlank() || query.length() > 500)
            throw new IllegalArgumentException("联网搜索未启用或搜索关键词无效。");
        try (McpSyncClient client = connect(settings)) {
            client.initialize();
            String tool = searchTool(client);
            var result = client.callTool(new McpSchema.CallToolRequest(tool, Map.of(
                    "query", query, "max_results", 5, "search_depth", "basic",
                    "include_raw_content", false, "include_images", false)));
            if (result == null || Boolean.TRUE.equals(result.isError()))
                throw new IllegalStateException("联网搜索未能返回结果。");
            String content = result.structuredContent() == null
                    ? result.content().stream().filter(McpSchema.TextContent.class::isInstance)
                        .map(McpSchema.TextContent.class::cast).map(McpSchema.TextContent::text)
                        .collect(Collectors.joining("\n"))
                    : JsonUtil.toJsonString(result.structuredContent());
            if (content.isBlank()) throw new IllegalStateException("联网搜索未返回文本资料。");
            return content.length() <= MAX_CONTEXT_LENGTH ? content
                    : content.substring(0, MAX_CONTEXT_LENGTH) + "\n[搜索结果已截断]";
        }
    }

    public WebPage extract(Settings settings, String url) {
        String source = com.aureli.ai.robot.service.web.WebPageUrls.validate(url);
        if (settings.apiKey().isBlank()) throw new WebPageReadException("请先在服务设置中保存 Tavily API Key。");
        // Explicit imports work with a configured key even when automatic answer-time search is off.
        try (McpSyncClient client = connect(settings, Duration.ofSeconds(45))) {
            client.initialize();
            McpSchema.Tool tool;
            try { tool = findTool(client, EXTRACT_TOOLS, "MCP 服务未提供网页提取工具，请检查 Tavily MCP 配置。"); }
            catch (MissingToolException error) { throw new WebPageReadException(error.getMessage()); }
            Map<String, Object> arguments = new java.util.HashMap<>();
            arguments.put("urls", java.util.List.of(source));
            var properties = tool.inputSchema().get("properties");
            if (properties instanceof Map<?, ?> fields) {
                if (fields.containsKey("format")) arguments.put("format", "markdown");
                if (fields.containsKey("extract_depth")) arguments.put("extract_depth", "basic");
                if (fields.containsKey("include_images")) arguments.put("include_images", false);
            }
            try {
                return callExtract(client, tool.name(), arguments, source);
            } catch (WebPageReadException error) {
                // Log only local classification and host; never provider text, query strings or credentials.
                log.warn("网页基础提取失败：host={}, reason={}", URI.create(source).getHost(), error.reasonCode);
                if (!error.advancedRetryAllowed || !(properties instanceof Map<?, ?> fields) || !fields.containsKey("extract_depth")) throw error;
                arguments.put("extract_depth", "advanced");
                try {
                    WebPage page = callExtract(client, tool.name(), arguments, source);
                    log.info("网页高级提取成功：host={}, characters={}", URI.create(source).getHost(), page.content().length());
                    return page;
                } catch (WebPageReadException advancedError) {
                    log.warn("网页高级提取失败：host={}, reason={}", URI.create(source).getHost(), advancedError.reasonCode);
                    throw advancedError;
                }
            }
        }
    }

    private WebPage callExtract(McpSyncClient client, String tool, Map<String, Object> arguments, String source) {
        var result = client.callTool(new McpSchema.CallToolRequest(tool, arguments));
        if (result == null || Boolean.TRUE.equals(result.isError()))
            throw new WebPageReadException("网页提取工具调用失败，请检查服务配置或稍后重试。", false, "TOOL_ERROR");
        if (result.structuredContent() != null) return parseWebPage(JsonUtil.toJsonString(result.structuredContent()), source);
        for (var block : result.content()) {
            if (block instanceof McpSchema.TextContent text) {
                try { return parseWebPage(text.text(), source); }
                catch (tools.jackson.core.JacksonException ignored) { /* Other blocks may contain the structured result. */ }
            }
        }
        throw new WebPageReadException("网页提取未返回有效的正文结果。", false, "MALFORMED_RESPONSE");
    }

    static WebPage parseWebPage(String payload, String sourceUrl) {
        var data = JSON.readTree(payload);
        var results = data.path("results");
        if (!results.isArray() || results.size() > 1)
            throw new WebPageReadException("网页提取返回的结果格式无效，请稍后重试。", false, "MALFORMED_RESPONSE");
        if (results.isEmpty()) {
            String reason = data.path("failed_results").isArray() && !data.path("failed_results").isEmpty()
                    ? data.path("failed_results").get(0).path("error").asString("").toLowerCase(java.util.Locale.ROOT) : "";
            if (reason.contains("timeout") || reason.contains("timed out"))
                throw new WebPageReadException("网页抓取超时，请稍后重试。", true, "FETCH_TIMEOUT");
            throw new WebPageReadException("抓取服务未能读取该网页。可稍后重试，或上传 PDF / 添加便签正文。", true, "FETCH_FAILED");
        }
        var page = results.get(0);
        var raw = page.path("raw_content");
        if (!raw.isString() || raw.asString().isBlank())
            throw new WebPageReadException("该网页没有可读取的正文，可上传 PDF 或添加便签正文。", true, "EMPTY_CONTENT");
        String content = raw.asString().strip();
        if (content.length() > MAX_WEB_CONTENT_LENGTH)
            throw new WebPageReadException("网页正文超过 50 万字符，请分段添加，原有快照已保留。");
        String resolved = page.path("url").isString() ? page.path("url").asString() : sourceUrl;
        resolved = com.aureli.ai.robot.service.web.WebPageUrls.validate(resolved);
        String title = page.path("title").isString() ? page.path("title").asString().strip() : "";
        if (title.isBlank()) {
            title = content.lines().filter(line -> line.matches("^#{1,2}\\s+.+")).findFirst()
                    .map(line -> line.replaceFirst("^#+\\s+", "")).orElse(URI.create(resolved).getHost());
        }
        return new WebPage(title.substring(0, Math.min(255, title.length())), resolved, content);
    }

    private McpSyncClient connect(Settings settings) {
        return connect(settings, Duration.ofSeconds(20));
    }

    private McpSyncClient connect(Settings settings, Duration requestTimeout) {
        if (settings.apiKey().isBlank()) throw new IllegalArgumentException("请先保存 Tavily API Key。");
        URI uri = URI.create(settings.mcpUrl());
        String endpoint = uri.getRawPath();
        var transport = HttpClientStreamableHttpTransport.builder(uri.getScheme() + "://" + uri.getRawAuthority())
                .endpoint(endpoint == null || endpoint.isBlank() ? "/mcp/" : endpoint)
                .requestBuilder(HttpRequest.newBuilder().header("Authorization", "Bearer " + settings.apiKey()))
                .connectTimeout(Duration.ofSeconds(10)).openConnectionOnStartup(false).build();
        return McpClient.sync(transport).initializationTimeout(Duration.ofSeconds(15))
                .requestTimeout(requestTimeout)
                .clientInfo(new McpSchema.Implementation("aureli-tavily", "1.0.0")).build();
    }

    private String searchTool(McpSyncClient client) {
        return findTool(client, SEARCH_TOOLS, "MCP 服务未提供 Tavily 搜索工具。").name();
    }

    private static class MissingToolException extends IllegalStateException {
        MissingToolException(String message) { super(message); }
    }
    private McpSchema.Tool findTool(McpSyncClient client, Set<String> names, String error) {
        String cursor = null;
        for (int page = 0; page < 5; page++) {
            var listed = client.listTools(cursor);
            for (var tool : listed.tools()) if (names.contains(tool.name())) return tool;
            cursor = listed.nextCursor();
            if (cursor == null || cursor.isBlank()) break;
        }
        throw new MissingToolException(error);
    }
}
