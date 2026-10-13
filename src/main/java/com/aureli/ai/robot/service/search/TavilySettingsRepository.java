package com.aureli.ai.robot.service.search;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.util.Optional;

@Repository
public class TavilySettingsRepository {
    public record Settings(boolean enabled, String mcpUrl, String apiKey) {
        @Override public String toString() { return "TavilySettings[credentials redacted]"; }
    }

    private final JdbcTemplate jdbc;
    public TavilySettingsRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Optional<Settings> find() {
        return jdbc.query("SELECT enabled, mcp_url, api_key FROM t_tavily_mcp_settings WHERE id = 1",
                (rs, row) -> new Settings(rs.getBoolean("enabled"), rs.getString("mcp_url"),
                        rs.getString("api_key"))).stream().findFirst();
    }

    public void save(Settings settings) {
        jdbc.update("""
                INSERT INTO t_tavily_mcp_settings (id, enabled, mcp_url, api_key)
                VALUES (1, ?, ?, ?)
                ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled,
                    mcp_url = EXCLUDED.mcp_url, api_key = EXCLUDED.api_key,
                    update_time = CURRENT_TIMESTAMP
                """, settings.enabled(), settings.mcpUrl(), settings.apiKey());
    }
}
