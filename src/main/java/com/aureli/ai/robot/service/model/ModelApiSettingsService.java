package com.aureli.ai.robot.service.model;

import com.aureli.ai.robot.prompt.ModelApiTestPrompts;
import com.aureli.ai.robot.service.model.ModelApiSettingsRepository.StoredEndpoint;
import com.aureli.ai.robot.service.model.ModelApiSettingsRepository.StoredSettings;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.openai.OpenAiEmbeddingModel;
import org.springframework.ai.openai.OpenAiEmbeddingOptions;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataAccessException;
import org.springframework.boot.sql.init.dependency.DependsOnDatabaseInitialization;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicReference;

/** Runtime model configuration. Credentials never appear in the public response. */
@Service
@DependsOnDatabaseInitialization
@Slf4j
public class ModelApiSettingsService {
    public record EndpointRequest(String provider, String baseUrl, String model, String apiKey) {
        @Override public String toString() { return "EndpointRequest[credentials redacted]"; }
    }
    public record SettingsRequest(EndpointRequest chat, EndpointRequest embedding, Integer dimensions) {}
    public record EndpointView(String provider, String baseUrl, String model, boolean keyConfigured) {}
    public record SettingsView(EndpointView chat, EndpointView embedding, int dimensions) {}
    public record ConnectionTestView(String model, String reply) {}
    private record RuntimeSettings(StoredSettings stored, ChatModel chatModel, EmbeddingModel embeddingModel) {}

    private final AtomicReference<RuntimeSettings> current;
    private final ModelApiSettingsRepository repository;
    private final int dimensions;
    private final double temperature;

    public ModelApiSettingsService(Environment env, ModelApiSettingsRepository repository) {
        this.repository = repository;
        dimensions = env.getProperty("spring.ai.vectorstore.pgvector.dimensions", Integer.class, 1536);
        temperature = env.getProperty("customer-service.temperature", Double.class, 0.0);
        String commonUrl = env.getProperty("spring.ai.openai.base-url", "http://192.168.0.106:11434/v1");
        String commonKey = env.getProperty("spring.ai.openai.api-key", "ollama");
        String chatUrl = env.getProperty("customer-service.base-url", commonUrl);
        String embeddingUrl = env.getProperty("spring.ai.openai.embedding.base-url", commonUrl);
        StoredSettings initial = new StoredSettings(
                new StoredEndpoint(provider(chatUrl), normalizeUrl(chatUrl), env.getProperty("customer-service.model", "llama3:latest"), env.getProperty("customer-service.api-key", commonKey)),
                new StoredEndpoint(provider(embeddingUrl), normalizeUrl(embeddingUrl), env.getProperty("spring.ai.openai.embedding.model", "qwen3-embedding:4b"), env.getProperty("spring.ai.openai.embedding.api-key", commonKey)), dimensions);
        StoredSettings fallback = validate(toRequest(initial), initial);
        current = new AtomicReference<>(runtime(loadInitial(env, fallback)));
    }

    private StoredSettings loadInitial(Environment env, StoredSettings fallback) {
        try {
            return loadFromDatabase(env, fallback);
        } catch (DataAccessException e) {
            // SQL errors may contain credentials. Log only a fixed message, without the cause.
            log.warn("模型配置数据库读取或初始化失败，使用 application.yml 中的兜底模型配置。");
            return fallback;
        }
    }

    private StoredSettings loadFromDatabase(Environment env, StoredSettings initial) {
        var saved = repository.find();
        if (saved.isPresent()) {
            initial = validate(toRequest(saved.get()), initial);
        } else {
            // One-time compatibility migration. Once a database row exists the legacy file is ignored.
            Path configPath = Path.of(env.getProperty("customer-service.model-settings-path", "config/model-api-settings.json")).toAbsolutePath();
            if (Files.exists(configPath)) {
                try {
                    StoredSettings stored = JsonMapper.builder().build().readValue(Files.readString(configPath), StoredSettings.class);
                    initial = validate(toRequest(stored), initial);
                } catch (Exception e) {
                    // Parser excerpts can contain credentials, so do not attach the cause.
                    throw new IllegalStateException("无法迁移旧模型 API 配置文件，请检查格式和向量维度。");
                }
            }
            initial = validate(toRequest(initial), initial);
            initial = validate(toRequest(repository.initialize(initial)), initial);
        }
        return initial;
    }

    public SettingsView view() { return view(current.get().stored()); }
    public ChatModel chatModel() { return current.get().chatModel(); }
    public EmbeddingModel embeddingModel() { return current.get().embeddingModel(); }
    public int dimensions() { return dimensions; }

    /** Uses the active persisted chat configuration; unsaved browser fields are never involved. */
    public ConnectionTestView testConnection() {
        RuntimeSettings active = current.get();
        String reply = active.chatModel().call(ModelApiTestPrompts.connectionTest())
                .getResult().getOutput().getText();
        if (reply == null || reply.isBlank()) throw new IllegalStateException("模型未返回测试内容。");
        return new ConnectionTestView(active.stored().chat().model(), reply.trim());
    }

    public synchronized SettingsView save(SettingsRequest request) {
        StoredSettings stored = validate(request, current.get().stored());
        RuntimeSettings replacement = runtime(stored);
        repository.save(stored); // A failed database write must leave the running configuration unchanged.
        current.set(replacement);
        return view(stored);
    }

    private StoredSettings validate(SettingsRequest request, StoredSettings previous) {
        if (request == null) throw new IllegalArgumentException("请提供模型配置。");
        if (request.dimensions() != null && request.dimensions() != dimensions)
            throw new IllegalArgumentException("向量维度必须与当前数据库一致（" + dimensions + "）。");
        return new StoredSettings(validateEndpoint(request.chat(), previous.chat(), "对话"),
                validateEndpoint(request.embedding(), previous.embedding(), "向量"), dimensions);
    }

    private StoredEndpoint validateEndpoint(EndpointRequest value, StoredEndpoint previous, String label) {
        if (value == null) throw new IllegalArgumentException("请提供" + label + "模型配置。");
        if (!"local".equals(value.provider()) && !"openai".equals(value.provider()))
            throw new IllegalArgumentException("请选择本地模型或 OpenAI 标准接口。");
        String url;
        try { url = normalizeUrl(value.baseUrl()); }
        catch (Exception e) { throw new IllegalArgumentException(label + "模型 API 地址无效，请使用 HTTP / HTTPS 地址。"); }
        String model = value.model() == null ? "" : value.model().trim();
        if (model.isBlank() || model.length() > 200) throw new IllegalArgumentException("请填写有效的" + label + "模型名称（最多 200 字符）。");
        String key = value.apiKey() == null ? "" : value.apiKey().trim();
        if (key.length() > 4096) throw new IllegalArgumentException("API Key 长度超出限制。");
        if (key.isBlank() && value.provider().equals(previous.provider()) && url.equals(previous.baseUrl())) key = previous.apiKey();
        if (key == null || key.isBlank()) {
            if ("openai".equals(value.provider())) throw new IllegalArgumentException("请填写" + label + "模型的 API Key。");
            key = "ollama";
        }
        return new StoredEndpoint(value.provider(), url, model, key);
    }

    private RuntimeSettings runtime(StoredSettings stored) {
        ChatModel chat = OpenAiChatModel.builder().options(OpenAiChatOptions.builder()
                .baseUrl(stored.chat().baseUrl()).apiKey(stored.chat().apiKey())
                .model(stored.chat().model()).temperature(temperature).build()).build();
        EmbeddingModel embedding = OpenAiEmbeddingModel.builder().options(OpenAiEmbeddingOptions.builder()
                .baseUrl(stored.embedding().baseUrl()).apiKey(stored.embedding().apiKey())
                .model(stored.embedding().model()).dimensions(dimensions).build()).build();
        return new RuntimeSettings(stored, chat, embedding);
    }

    private static String normalizeUrl(String value) {
        String normalized = value == null ? "" : value.trim().replaceAll("/+$", "");
        URI uri = URI.create(normalized);
        if ((!"http".equalsIgnoreCase(uri.getScheme()) && !"https".equalsIgnoreCase(uri.getScheme()))
                || uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null)
            throw new IllegalArgumentException("无效的服务地址。");
        return normalized;
    }
    private static String provider(String url) {
        String host = URI.create(url).getHost();
        return host != null && (host.equals("localhost") || host.startsWith("127.") || host.contains("::1")
                || host.startsWith("192.168.") || host.startsWith("10.")
                || host.matches("172\\.(1[6-9]|2\\d|3[01])\\..*")) ? "local" : "openai";
    }
    private static EndpointRequest toRequest(StoredEndpoint value) { return new EndpointRequest(value.provider(), value.baseUrl(), value.model(), value.apiKey()); }
    private static SettingsRequest toRequest(StoredSettings value) { return new SettingsRequest(toRequest(value.chat()), toRequest(value.embedding()), value.dimensions()); }
    private static EndpointView view(StoredEndpoint value) { return new EndpointView(value.provider(), value.baseUrl(), value.model(), value.apiKey() != null && !value.apiKey().isBlank()); }
    private static SettingsView view(StoredSettings value) { return new SettingsView(view(value.chat()), view(value.embedding()), value.dimensions()); }
}
