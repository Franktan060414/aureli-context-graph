package com.aureli.ai.robot.service.search;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.jupiter.api.Assertions.*;

/** Real SDK and Streamable HTTP against a local MCP fixture; no credentials or internet needed. */
class TavilyMcpSearchServiceTest {
    @Test void initializesDiscoversAndCallsRemoteToolWithHeaderCredentials() throws Exception {
        exercise(false);
    }
    @Test void errorToolResultsAreRejected() throws Exception {
        exercise(true);
    }
    private void exercise(boolean errorResult) throws Exception {
        var json = JsonMapper.builder().build();
        var requests = new CopyOnWriteArrayList<String>();
        var correctAuth = new AtomicBoolean(true);
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/custom/mcp/", exchange -> {
            correctAuth.compareAndSet(true, "Bearer fixture-secret".equals(exchange.getRequestHeaders().getFirst("Authorization"))
                    && exchange.getRequestURI().getQuery() == null);
            if (!"POST".equals(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(405, -1); exchange.close(); return;
            }
            var body = json.readTree(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            String method = body.path("method").asString();
            requests.add(method);
            if (!body.has("id")) {
                exchange.sendResponseHeaders(202, -1); exchange.close(); return;
            }
            Object result = switch (method) {
                case "initialize" -> Map.of("protocolVersion", body.path("params").path("protocolVersion").asString(),
                        "capabilities", Map.of("tools", Map.of()), "serverInfo", Map.of("name", "tavily-fixture", "version", "1"));
                case "tools/list" -> Map.of("tools", List.of(Map.of("name", "tavily_search", "description", "Search",
                        "inputSchema", Map.of("type", "object", "properties", Map.of("query", Map.of("type", "string"))))));
                case "tools/call" -> {
                    assertEquals("tavily_search", body.path("params").path("name").asString());
                    assertEquals("Aureli 最新版本", body.path("params").path("arguments").path("query").asString());
                    assertEquals(5, body.path("params").path("arguments").path("max_results").asInt());
                    yield Map.of("content", List.of(Map.of("type", "text", "text",
                            "{\"results\":[{\"title\":\"官方资料\",\"url\":\"https://example.com/source\",\"content\":\"资料正文\"}]}")), "isError", errorResult);
                }
                default -> Map.of();
            };
            byte[] response = json.writeValueAsBytes(Map.of("jsonrpc", "2.0", "id", body.get("id"), "result", result));
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response); exchange.close();
        });
        server.start();
        try {
            var settings = new TavilySettingsRepository.Settings(true,
                    "http://127.0.0.1:" + server.getAddress().getPort() + "/custom/mcp/", "fixture-secret");
            var service = new TavilyMcpSearchService();
            service.testConnection(settings);
            assertFalse(requests.contains("tools/call"));
            if (errorResult) assertThrows(IllegalStateException.class, () -> service.search(settings, "Aureli 最新版本"));
            else {
                String result = service.search(settings, "Aureli 最新版本");
                assertTrue(result.contains("https://example.com/source"));
                assertTrue(result.contains("资料正文"));
            }
            assertTrue(correctAuth.get());
            assertTrue(requests.containsAll(List.of("initialize", "notifications/initialized", "tools/list", "tools/call")));
        } finally { server.stop(0); }
    }
}
