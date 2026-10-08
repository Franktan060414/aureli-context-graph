package com.aureli.ai.robot.service.model;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.mock.env.MockEnvironment;

import java.nio.file.Path;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

/** Run against a disposable PostgreSQL database with -Daureli.settings.jdbc-url=jdbc:postgresql://... . */
@EnabledIfSystemProperty(named = "aureli.settings.jdbc-url", matches = "jdbc:postgresql:.*")
class ModelApiSettingsRepositoryTest {
    @TempDir Path directory;

    @Test void actualPostgresSavesReloadsAndRejectsPartialUpdates() {
        String url = System.getProperty("aureli.settings.jdbc-url");
        String schema = "settings_test_" + UUID.randomUUID().toString().replace("-", "");
        var admin = new JdbcTemplate(new DriverManagerDataSource(url, "postgres", ""));
        admin.execute("CREATE SCHEMA " + schema);
        try {
            var datasource = new DriverManagerDataSource("jdbc:p6spy:" + url.substring("jdbc:".length())
                    + (url.contains("?") ? "&" : "?") + "currentSchema=" + schema, "postgres", "");
            datasource.setDriverClassName("com.p6spy.engine.spy.P6SpyDriver");
            var scripts = new ResourceDatabasePopulator(new ClassPathResource("db/model-api-settings.sql"));
            scripts.execute(datasource);
            scripts.execute(datasource); // The upgrade SQL is repeatable.
            var jdbc = new JdbcTemplate(datasource);
            var repository = new ModelApiSettingsRepository(jdbc);
            assertTrue(repository.find().isEmpty());
            var env = new MockEnvironment()
                    .withProperty("customer-service.model-settings-path", directory.resolve("absent.json").toString());
            var service = new ModelApiSettingsService(env, repository);
            var request = new ModelApiSettingsService.SettingsRequest(
                    new ModelApiSettingsService.EndpointRequest("openai", "https://chat.example/v1", "saved-chat", "chat-test-key"),
                    new ModelApiSettingsService.EndpointRequest("openai", "https://embedding.example/v1", "saved-embedding", "embedding-test-key"), 1536);
            var saved = service.save(request);
            assertEquals(saved, new ModelApiSettingsService(env, new ModelApiSettingsRepository(jdbc)).view());
            var stored = repository.find().orElseThrow();
            assertEquals("chat-test-key", stored.chat().apiKey());
            assertEquals("embedding-test-key", stored.embedding().apiKey());
            assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM t_model_api_settings", Integer.class));
            assertEquals(stored, repository.initialize(new ModelApiSettingsRepository.StoredSettings(
                    stored.embedding(), stored.chat(), 1536))); // Initialization cannot overwrite a saved row.

            var invalid = new ModelApiSettingsRepository.StoredSettings(stored.embedding(),
                    new ModelApiSettingsRepository.StoredEndpoint("local", "http://localhost/v1", "x".repeat(201), "fixture"), 1536);
            assertThrows(DataAccessException.class, () -> repository.save(invalid));
            assertEquals(stored, repository.find().orElseThrow()); // Neither endpoint changed.

            var before = service.view();
            var chatBefore = service.chatModel();
            jdbc.execute("DROP TABLE t_model_api_settings");
            assertThrows(DataAccessException.class, () -> service.save(request));
            assertEquals(before, service.view());
            assertSame(chatBefore, service.chatModel());
            var fallbackService = new ModelApiSettingsService(env, repository);
            assertEquals("http://192.168.0.106:11434/v1", fallbackService.view().chat().baseUrl());
            assertEquals("http://192.168.0.106:11434/v1", fallbackService.view().embedding().baseUrl());
            assertEquals("llama3:latest", fallbackService.view().chat().model());
            assertEquals("qwen3-embedding:4b", fallbackService.view().embedding().model());
        } finally {
            admin.execute("DROP SCHEMA " + schema + " CASCADE");
        }
    }
}
