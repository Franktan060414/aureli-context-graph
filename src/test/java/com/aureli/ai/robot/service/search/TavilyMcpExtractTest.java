package com.aureli.ai.robot.service.search;

import com.aureli.ai.robot.service.web.WebPageUrls;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.jupiter.api.Assertions.*;

class TavilyMcpExtractTest {
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void extractsSpecifiedUrlWithSearchDisabledAndKeepsFullBody(boolean structured) throws Exception {
        exercise(structured, "success");
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"fallback", "empty-content", "both-fail", "tool-error", "oversized", "no-depth-failure", "success-with-depth"})
    void advancedFallbackIsBoundedAndOnlyUsedForPageExtractionFailures(String scenario) throws Exception {
        exercise(false, scenario);
    }

    private void exercise(boolean structured, String scenario) throws Exception {
        var json = JsonMapper.builder().build();
        String content = "# 网页标题\n\n" + "完整正文。".repeat(7000);
        var called = new AtomicBoolean();
        var depths = new java.util.concurrent.CopyOnWriteArrayList<String>();
        boolean supportsDepth = !List.of("success", "no-depth-failure").contains(scenario);
        var properties = new java.util.HashMap<String, Object>();
        properties.put("urls", Map.of("type", "array")); properties.put("format", Map.of("type", "string"));
        if (supportsDepth) properties.put("extract_depth", Map.of("type", "string", "enum", List.of("basic", "advanced")));
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/mcp/", exchange -> {
            if (!"POST".equals(exchange.getRequestMethod())) { exchange.sendResponseHeaders(405, -1); exchange.close(); return; }
            var request = json.readTree(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            if (!request.has("id")) { exchange.sendResponseHeaders(202, -1); exchange.close(); return; }
            assertEquals("Bearer fixture-key", exchange.getRequestHeaders().getFirst("Authorization"));
            Object result = switch (request.path("method").asString()) {
                case "initialize" -> Map.of("protocolVersion", request.path("params").path("protocolVersion").asString(),
                        "capabilities", Map.of("tools", Map.of()), "serverInfo", Map.of("name", "extract-fixture", "version", "1"));
                case "tools/list" -> Map.of("tools", List.of(Map.of("name", "tavily-extract", "description", "Extract",
                        "inputSchema", Map.of("type", "object", "properties", properties))));
                case "tools/call" -> {
                    called.set(true);
                    var args = request.path("params").path("arguments");
                    assertEquals("tavily-extract", request.path("params").path("name").asString());
                    assertEquals("https://example.com/article", args.path("urls").get(0).asString());
                    assertEquals("markdown", args.path("format").asString());
                    if (!supportsDepth) assertFalse(args.has("extract_depth"), "only send optional parameters supported by this server");
                    String depth = args.path("extract_depth").asString("basic");
                    depths.add(depth);
                    boolean failed = scenario.equals("both-fail") || scenario.equals("no-depth-failure") || (scenario.equals("fallback") && depth.equals("basic"));
                    String body = scenario.equals("oversized") ? "x".repeat(TavilyMcpSearchService.MAX_WEB_CONTENT_LENGTH + 1)
                            : scenario.equals("empty-content") && depth.equals("basic") ? " " : content;
                    var payload = failed ? Map.of("results", List.of(), "failed_results", List.of(Map.of("url", "https://example.com/article", "error", "Failed to fetch url")))
                            : Map.of("results", List.of(Map.of("url", "https://example.com/article", "raw_content", body)), "failed_results", List.of());
                    yield structured ? Map.of("content", List.of(), "structuredContent", payload)
                            : Map.of("content", List.of(Map.of("type", "text", "text", json.writeValueAsString(payload))), "isError", scenario.equals("tool-error"));
                }
                default -> Map.of();
            };
            byte[] bytes = json.writeValueAsBytes(Map.of("jsonrpc", "2.0", "id", request.get("id"), "result", result));
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
        });
        server.start();
        try {
            var settings = new TavilySettingsRepository.Settings(false, "http://127.0.0.1:" + server.getAddress().getPort() + "/mcp/", "fixture-key");
            var service = new TavilyMcpSearchService();
            if (List.of("both-fail", "tool-error", "oversized", "no-depth-failure").contains(scenario)) {
                assertThrows(TavilyMcpSearchService.WebPageReadException.class, () -> service.extract(settings, "https://example.com/article"));
            } else {
                var page = service.extract(settings, "https://example.com/article");
                assertEquals("网页标题", page.title()); assertEquals(content, page.content());
            }
            assertTrue(called.get());
            assertEquals(List.of("fallback", "both-fail", "empty-content").contains(scenario) ? List.of("basic", "advanced") : List.of("basic"), depths);
        } finally { server.stop(0); }
    }

    @Test void checksPerUrlFailureEvenWhenMcpEnvelopeWasSuccessful() {
        for (String result : List.of("{\"results\":[],\"failed_results\":[{\"url\":\"https://example.com\",\"error\":\"blocked\"}]}",
                "{\"results\":[{\"url\":\"https://example.com\",\"raw_content\":\" \"}]}"))
            assertThrows(TavilyMcpSearchService.WebPageReadException.class,
                    () -> TavilyMcpSearchService.parseWebPage(result, "https://example.com"));
    }
    @Test void acceptsPublicPort8081WithoutAllowingLocalOrPrivateSources() {
        String officialSite = "http://47.93.18.45:8081/index.html";
        assertEquals(officialSite, WebPageUrls.validate(officialSite));
        assertEquals("https://example.com:8081/article", WebPageUrls.validate("https://example.com:8081/article"));
        assertEquals(officialSite, TavilyMcpSearchService.parseWebPage(
                "{\"results\":[{\"url\":\"" + officialSite + "\",\"raw_content\":\"官网正文\"}]}", officialSite).resolvedUrl());
        for (String url : List.of("http://localhost:8081", "http://127.0.0.1:8081", "http://10.0.0.1:8081",
                "http://192.168.1.1:8081", "http://[::1]:8081", "http://user:secret@example.com:8081"))
            assertThrows(IllegalArgumentException.class, () -> WebPageUrls.validate(url));
    }

    @Test void rejectsUnsafeSourcesAndResolvedAddresses() {
        for (String url : List.of("file:///etc/passwd", "javascript:alert(1)", "https://user:secret@example.com", "http://localhost/a",
                "http://127.0.0.1", "http://10.0.0.1", "http://[::1]", "http://[fd00::1]", "https://example.com:8080/a"))
            assertThrows(IllegalArgumentException.class, () -> WebPageUrls.validate(url));
        assertEquals("https://example.com/a#part", WebPageUrls.validate(" https://example.com/a#part "));
        assertThrows(IllegalArgumentException.class, () -> TavilyMcpSearchService.parseWebPage(
                "{\"results\":[{\"url\":\"http://127.0.0.1\",\"raw_content\":\"body\"}]}", "https://example.com"));
    }
}
