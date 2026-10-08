package com.aureli.ai.robot.service.model;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.Optional;

/** Both endpoints live in one row so a save cannot commit only half the configuration. */
@Repository
public class ModelApiSettingsRepository {
    public record StoredEndpoint(String provider, String baseUrl, String model, String apiKey) {
        @Override public String toString() { return "StoredEndpoint[credentials redacted]"; }
    }
    public record StoredSettings(StoredEndpoint chat, StoredEndpoint embedding, int dimensions) {}

    private static final String INSERT = """
            INSERT INTO t_model_api_settings
                (id, chat_provider, chat_base_url, chat_model, chat_api_key,
                 embedding_provider, embedding_base_url, embedding_model, embedding_api_key, dimensions)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """;
    private final JdbcTemplate jdbc;

    public ModelApiSettingsRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public Optional<StoredSettings> find() {
        return jdbc.query("SELECT * FROM t_model_api_settings WHERE id = 1", (rs, row) ->
                new StoredSettings(
                        new StoredEndpoint(rs.getString("chat_provider"), rs.getString("chat_base_url"),
                                rs.getString("chat_model"), rs.getString("chat_api_key")),
                        new StoredEndpoint(rs.getString("embedding_provider"), rs.getString("embedding_base_url"),
                                rs.getString("embedding_model"), rs.getString("embedding_api_key")),
                        rs.getInt("dimensions"))).stream().findFirst();
    }

    public StoredSettings initialize(StoredSettings settings) {
        jdbc.update(INSERT + " ON CONFLICT (id) DO NOTHING", values(settings));
        // Another instance may have initialized the row first; the database always wins.
        return find().orElseThrow(() -> new IllegalStateException("模型配置初始化失败。"));
    }

    public void save(StoredSettings settings) {
        jdbc.update(INSERT + """
                ON CONFLICT (id) DO UPDATE SET
                    chat_provider = EXCLUDED.chat_provider,
                    chat_base_url = EXCLUDED.chat_base_url,
                    chat_model = EXCLUDED.chat_model,
                    chat_api_key = EXCLUDED.chat_api_key,
                    embedding_provider = EXCLUDED.embedding_provider,
                    embedding_base_url = EXCLUDED.embedding_base_url,
                    embedding_model = EXCLUDED.embedding_model,
                    embedding_api_key = EXCLUDED.embedding_api_key,
                    dimensions = EXCLUDED.dimensions,
                    update_time = CURRENT_TIMESTAMP
                """, values(settings));
    }

    private Object[] values(StoredSettings settings) {
        return new Object[]{settings.chat().provider(), settings.chat().baseUrl(), settings.chat().model(), settings.chat().apiKey(),
                settings.embedding().provider(), settings.embedding().baseUrl(), settings.embedding().model(), settings.embedding().apiKey(), settings.dimensions()};
    }
}
