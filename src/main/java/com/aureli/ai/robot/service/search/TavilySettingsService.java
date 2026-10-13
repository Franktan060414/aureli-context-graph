package com.aureli.ai.robot.service.search;

import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.sql.init.dependency.DependsOnDatabaseInitialization;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import java.net.URI;
import java.util.concurrent.atomic.AtomicReference;
import com.aureli.ai.robot.service.search.TavilySettingsRepository.Settings;

@Service
@DependsOnDatabaseInitialization
@Slf4j
public class TavilySettingsService {
    public static final String DEFAULT_URL = "https://mcp.tavily.com/mcp/";
    public record Request(Boolean enabled, String mcpUrl, String apiKey) {
        @Override public String toString() { return "TavilySettingsRequest[credentials redacted]"; }
    }
    public record View(boolean enabled, String mcpUrl, boolean keyConfigured) {}

    private final TavilySettingsRepository repository;
    private final AtomicReference<Settings> current;

    public TavilySettingsService(TavilySettingsRepository repository) {
        this.repository = repository;
        Settings initial = new Settings(false, DEFAULT_URL, "");
        try { initial = repository.find().orElse(initial); }
        catch (DataAccessException error) {
            log.warn("无法读取联网搜索配置，联网搜索保持关闭。");
        }
        current = new AtomicReference<>(initial);
    }

    public Settings snapshot() { return current.get(); }
    public View view() { return view(current.get()); }

    public synchronized View save(Request request) {
        if (request == null || request.enabled() == null)
            throw new IllegalArgumentException("请设置是否启用联网搜索。");
        String url = validateUrl(request.mcpUrl());
        String key = request.apiKey() == null ? "" : request.apiKey().trim();
        if (key.length() > 4096 || key.chars().anyMatch(Character::isISOControl))
            throw new IllegalArgumentException("Tavily API Key 格式无效。");
        Settings previous = current.get();
        if (key.isBlank() && url.equals(previous.mcpUrl())) key = previous.apiKey();
        if (request.enabled() && key.isBlank())
            throw new IllegalArgumentException("启用联网搜索前，请填写 Tavily API Key。");
        Settings replacement = new Settings(request.enabled(), url, key);
        repository.save(replacement);
        current.set(replacement);
        return view(replacement);
    }

    private static String validateUrl(String value) {
        try {
            String trimmed = value == null ? "" : value.trim();
            URI uri = URI.create(trimmed);
            if (trimmed.length() > 2048 || uri.getHost() == null || uri.getUserInfo() != null
                    || uri.getQuery() != null || uri.getFragment() != null
                    || !("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme())))
                throw new IllegalArgumentException();
            return trimmed;
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("请填写有效的 Tavily MCP HTTP / HTTPS 地址，密钥请填写在 API Key 中。");
        }
    }

    private static View view(Settings value) {
        return new View(value.enabled(), value.mcpUrl(), !value.apiKey().isBlank());
    }
}
