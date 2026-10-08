package com.aureli.ai.robot.service.model;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.ai.document.Document;
import org.springframework.core.env.Environment;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.beans.factory.config.YamlPropertiesFactoryBean;
import org.springframework.core.io.ClassPathResource;
import tools.jackson.databind.json.JsonMapper;

import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import org.springframework.dao.DataAccessResourceFailureException;
import java.util.Optional;
import com.aureli.ai.robot.service.model.ModelApiSettingsRepository.StoredSettings;

class ModelApiSettingsServiceTest {
    @TempDir Path directory;
    private final ModelApiSettingsRepository repository = mock(ModelApiSettingsRepository.class);
    private final AtomicReference<StoredSettings> persisted = new AtomicReference<>();

    ModelApiSettingsServiceTest() {
        when(repository.find()).thenAnswer(call -> Optional.ofNullable(persisted.get()));
        when(repository.initialize(any())).thenAnswer(call -> {
            persisted.compareAndSet(null, call.getArgument(0));
            return persisted.get();
        });
        doAnswer(call -> { persisted.set(call.getArgument(0)); return null; }).when(repository).save(any());
    }
    private Environment env(Path path) {
        return new MockEnvironment().withProperty("customer-service.model-settings-path", path.toString())
                .withProperty("customer-service.base-url", "http://127.0.0.1:11434/v1")
                .withProperty("customer-service.api-key", "ollama")
                .withProperty("customer-service.model", "llama3:latest")
                .withProperty("spring.ai.openai.base-url", "http://127.0.0.1:11434/v1")
                .withProperty("spring.ai.openai.api-key", "ollama")
                .withProperty("spring.ai.openai.embedding.model", "qwen3-embedding:4b")
                .withProperty("spring.ai.vectorstore.pgvector.dimensions", "1536");
    }
    private MockEnvironment yamlEnvironment(Path path) {
        var yaml = new YamlPropertiesFactoryBean();
        yaml.setResources(new ClassPathResource("application.yml"));
        var env = new MockEnvironment();
        yaml.getObject().forEach((key, value) -> env.setProperty(key.toString(), value.toString()));
        return env.withProperty("customer-service.model-settings-path", path.toString());
    }

    private void assertLanFallback(ModelApiSettingsService service) {
        assertEquals(new ModelApiSettingsService.EndpointView("local", "http://192.168.0.106:11434/v1", "llama3:latest", true), service.view().chat());
        assertEquals(new ModelApiSettingsService.EndpointView("local", "http://192.168.0.106:11434/v1", "qwen3-embedding:4b", true), service.view().embedding());
        assertEquals(1536, service.dimensions());
        assertNotNull(service.chatModel());
        assertNotNull(service.embeddingModel());
    }
    private ModelApiSettingsService.EndpointRequest endpoint(String provider, String url, String model, String key) {
        return new ModelApiSettingsService.EndpointRequest(provider, url, model, key);
    }
    private ModelApiSettingsService.SettingsRequest settings(String key) {
        return new ModelApiSettingsService.SettingsRequest(
                endpoint("openai", "https://api.openai.com/v1", "gpt-4.1-mini", key),
                endpoint("openai", "https://api.openai.com/v1", "text-embedding-3-small", key), 1536);
    }

    @Test void savesReloadsAndRedactsCredentials() throws Exception {
        Path file = directory.resolve("config.json");
        ModelApiSettingsService service = new ModelApiSettingsService(env(file), repository);
        var view = service.save(settings("fixture-secret"));
        String publicJson = JsonMapper.builder().build().writeValueAsString(view);
        assertFalse(publicJson.contains("fixture-secret"));
        assertFalse(publicJson.contains("apiKey"));
        assertTrue(view.chat().keyConfigured());
        assertEquals(view, new ModelApiSettingsService(env(file), repository).view());
        assertEquals(view, service.save(settings(""))); // Blank keys preserve same endpoint credentials.
        assertEquals("fixture-secret", persisted.get().chat().apiKey());
        assertEquals("fixture-secret", persisted.get().embedding().apiKey());
        assertFalse(Files.exists(file)); // New saves never write the legacy file.
    }

    @Test void rejectsDimensionMismatchAndDoesNotForwardKeysToNewEndpoints() throws Exception {
        ModelApiSettingsService service = new ModelApiSettingsService(env(directory.resolve("config.json")), repository);
        service.save(settings("fixture-secret"));
        var before = service.view();
        assertThrows(IllegalArgumentException.class, () -> service.save(new ModelApiSettingsService.SettingsRequest(
                settings("").chat(), settings("").embedding(), 3072)));
        assertThrows(IllegalArgumentException.class, () -> service.save(new ModelApiSettingsService.SettingsRequest(
                endpoint("openai", "https://other.example/v1", "custom", ""), settings("").embedding(), 1536)));
        assertEquals(before, service.view());
    }

    @Test void invalidUrlAndFailedDatabaseWriteLeaveRunningConfigUnchanged() throws Exception {
        Path file = directory.resolve("config.json");
        ModelApiSettingsService service = new ModelApiSettingsService(env(file), repository);
        var before = service.view();
        assertThrows(IllegalArgumentException.class, () -> service.save(new ModelApiSettingsService.SettingsRequest(
                endpoint("local", "file:///tmp/key", "llama3", ""), settings("fixture").embedding(), 1536)));
        var chatBefore = service.chatModel();
        var embeddingBefore = service.embeddingModel();
        var databaseBefore = persisted.get();
        doThrow(new DataAccessResourceFailureException("database unavailable")).when(repository).save(any());
        assertThrows(DataAccessResourceFailureException.class, () -> service.save(settings("fixture-secret")));
        assertSame(chatBefore, service.chatModel());
        assertSame(embeddingBefore, service.embeddingModel());
        assertEquals(databaseBefore, persisted.get());
        assertEquals(before, service.view());
    }

    @Test void migratesLegacyFileOnceAndDatabaseOverridesLegacyAndEnvironment() throws Exception {
        Path file = directory.resolve("config.json");
        var old = new StoredSettings(
                new ModelApiSettingsRepository.StoredEndpoint("openai", "https://example.com/v1", "legacy-chat", "legacy-key"),
                new ModelApiSettingsRepository.StoredEndpoint("openai", "https://example.com/v1", "legacy-embedding", "legacy-key"), 1536);
        Files.writeString(file, JsonMapper.builder().build().writeValueAsString(old));
        var service = new ModelApiSettingsService(env(file), repository);
        assertEquals("legacy-chat", service.view().chat().model());
        assertEquals(old, persisted.get());
        service.save(settings("database-key"));
        Files.writeString(file, "invalid legacy file ignored after migration");
        var reloaded = new ModelApiSettingsService(env(file), repository);
        assertEquals(service.view(), reloaded.view());
        assertEquals("database-key", persisted.get().chat().apiKey());
        verify(repository, times(1)).initialize(any());
    }

    @Test void malformedLegacyFileDoesNotInitializeDatabase() throws Exception {
        Path file = directory.resolve("config.json");
        Files.writeString(file, "invalid-secret-fixture");
        var error = assertThrows(IllegalStateException.class, () -> new ModelApiSettingsService(env(file), repository));
        assertFalse(error.getMessage().contains("invalid-secret-fixture"));
        assertNull(error.getCause());
        verify(repository, never()).initialize(any());
    }

    @Test void databaseReadFailureUsesYamlWithoutReadingLegacyAndCanSaveAfterRecovery() throws Exception {
        Path file = directory.resolve("config.json");
        Files.writeString(file, "invalid legacy file must not block database fallback");
        when(repository.find()).thenThrow(new DataAccessResourceFailureException("fixture-secret-driver-error"));
        var service = new ModelApiSettingsService(yamlEnvironment(file), repository);
        assertLanFallback(service);
        verify(repository, never()).initialize(any());
        verify(repository, never()).save(any());
        assertNull(persisted.get());

        // Saving still requires a successful database write while fallback models remain usable.
        var before = service.view();
        var chatBefore = service.chatModel();
        doThrow(new DataAccessResourceFailureException("database unavailable")).when(repository).save(any());
        assertThrows(DataAccessResourceFailureException.class, () -> service.save(settings("fixture-secret")));
        assertEquals(before, service.view());
        assertSame(chatBefore, service.chatModel());
        doAnswer(call -> { persisted.set(call.getArgument(0)); return null; }).when(repository).save(any());
        assertEquals("gpt-4.1-mini", service.save(settings("fixture-secret")).chat().model());
        assertEquals("text-embedding-3-small", service.view().embedding().model());
    }

    @Test void failedDatabaseInitializationUsesYamlInsteadOfLegacyCredentials() throws Exception {
        Path file = directory.resolve("config.json");
        var old = new StoredSettings(
                new ModelApiSettingsRepository.StoredEndpoint("openai", "https://example.com/v1", "legacy-chat", "legacy-key"),
                new ModelApiSettingsRepository.StoredEndpoint("openai", "https://example.com/v1", "legacy-embedding", "legacy-key"), 1536);
        Files.writeString(file, JsonMapper.builder().build().writeValueAsString(old));
        when(repository.initialize(any())).thenThrow(new DataAccessResourceFailureException("database read-only"));
        var service = new ModelApiSettingsService(yamlEnvironment(file), repository);
        assertLanFallback(service);
        assertNull(persisted.get());
    }

    @Test void databaseReadFailureRespectsYamlOverrides() {
        when(repository.find()).thenThrow(new DataAccessResourceFailureException("database unavailable"));
        var env = yamlEnvironment(directory.resolve("absent.json"))
                .withProperty("OLLAMA_BASE_URL", "http://10.0.0.5:11434/v1")
                .withProperty("OLLAMA_CHAT_MODEL", "custom-chat")
                .withProperty("OLLAMA_EMBEDDING_MODEL", "custom-embedding");
        var service = new ModelApiSettingsService(env, repository);
        assertEquals("http://10.0.0.5:11434/v1", service.view().chat().baseUrl());
        assertEquals("http://10.0.0.5:11434/v1", service.view().embedding().baseUrl());
        assertEquals("custom-chat", service.view().chat().model());
        assertEquals("custom-embedding", service.view().embedding().model());
        assertEquals("local", service.view().chat().provider());
    }

    @Test void chatRequestsImmediatelyUseSavedAddressModelAndKey() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> body = new AtomicReference<>();
        AtomicReference<String> path = new AtomicReference<>();
        AtomicReference<String> authorization = new AtomicReference<>();
        server.createContext("/", exchange -> {
            path.set(exchange.getRequestURI().getPath());
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            body.set(new String(exchange.getRequestBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
            byte[] response = "{\"id\":\"fixture\",\"object\":\"chat.completion\",\"created\":1,\"model\":\"fixture-chat\",\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":\"fixture-answer\"},\"finish_reason\":\"stop\"}]}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        try {
            Path file = directory.resolve("config.json");
            var service = new ModelApiSettingsService(env(file), repository);
            String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/v1";
            service.save(new ModelApiSettingsService.SettingsRequest(
                    endpoint("local", url, "first-chat", "first-key"), endpoint("local", url, "fixture-embedding", "fixture"), 1536));
            var tested = service.testConnection();
            assertEquals("first-chat", tested.model());
            assertEquals("fixture-answer", tested.reply());
            assertTrue(body.get().contains("API 连接测试消息"));
            assertEquals("fixture-answer", service.chatModel().call("question"));
            assertEquals("/v1/chat/completions", path.get());
            assertEquals("Bearer first-key", authorization.get());
            assertTrue(body.get().contains("first-chat"));
            service.save(new ModelApiSettingsService.SettingsRequest(
                    endpoint("local", url.replace("/v1", "/next/v1"), "next-chat", "next-key"), endpoint("local", url, "fixture-embedding", ""), 1536));
            assertEquals("fixture-answer", service.chatModel().call("question"));
            assertEquals("/next/v1/chat/completions", path.get());
            assertEquals("Bearer next-key", authorization.get());
            assertTrue(body.get().contains("next-chat"));
            // A newly created service restores credentials as well as the public configuration.
            assertEquals("fixture-answer", new ModelApiSettingsService(env(file), repository).chatModel().call("question"));
            assertEquals("Bearer next-key", authorization.get());
        } finally { server.stop(0); }
    }

    @Test void primaryEmbeddingAdapterUsesSavedModelForIngestionAndRetrieval() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> requestBody = new AtomicReference<>();
        AtomicReference<String> authorization = new AtomicReference<>();
        AtomicReference<String> requestPath = new AtomicReference<>();
        server.createContext("/", exchange -> {
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            requestPath.set(exchange.getRequestURI().getPath());
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
            String vector = String.join(",", java.util.Collections.nCopies(1536, "0.1"));
            byte[] response = ("{\"object\":\"list\",\"model\":\"fixture-embedding\",\"data\":[{\"object\":\"embedding\",\"index\":0,\"embedding\":[" + vector + "]}],\"usage\":{\"prompt_tokens\":1,\"total_tokens\":1}}").getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length); exchange.getResponseBody().write(response); exchange.close();
        });
        server.start();
        try {
            ModelApiSettingsService service = new ModelApiSettingsService(env(directory.resolve("config.json")), repository);
            String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/v1";
            service.save(new ModelApiSettingsService.SettingsRequest(
                    endpoint("local", url, "fixture-chat", "fixture"), endpoint("local", url, "fixture-embedding", "fixture"), 1536));
            ConfigurableEmbeddingModel model = new ConfigurableEmbeddingModel(service);
            assertEquals(1536, model.dimensions());
            assertEquals(1536, model.embed(new Document("document for ingestion")).length);
            assertTrue(requestBody.get().contains("fixture-embedding"));
            assertTrue(requestBody.get().contains("1536"));
            assertEquals("Bearer fixture", authorization.get());
            assertEquals("/v1/embeddings", requestPath.get());
            service.save(new ModelApiSettingsService.SettingsRequest(
                    endpoint("local", url, "fixture-chat", ""), endpoint("local", url.replace("/v1", "/next/v1"), "updated-embedding", "updated-key"), 1536));
            assertEquals(1536, model.embed("retrieval question").length);
            assertTrue(requestBody.get().contains("updated-embedding"));
            assertEquals("Bearer updated-key", authorization.get());
            assertEquals("/next/v1/embeddings", requestPath.get());
        } finally { server.stop(0); }
    }
}
