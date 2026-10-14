package com.aureli.ai.robot.service;

import com.aureli.ai.robot.domain.MemoryCategory;
import com.aureli.ai.robot.prompt.MemoryClassificationPrompts;
import com.google.common.cache.Cache;
import com.google.common.cache.CacheBuilder;
import com.google.common.base.Ticker;
import com.google.common.hash.Hashing;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import java.time.Duration;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;

@Service
@Slf4j
public class MemoryClassificationService {
    private final Duration timeout;
    private final Cache<RequestKey, MemoryCategory> classifications;
    public MemoryClassificationService() { this(Duration.ofSeconds(8)); }
    MemoryClassificationService(Duration timeout) { this(timeout, Ticker.systemTicker()); }
    MemoryClassificationService(Duration timeout, Ticker ticker) {
        this.timeout = timeout;
        this.classifications = CacheBuilder.newBuilder().maximumSize(1000)
                .expireAfterWrite(30, TimeUnit.MINUTES).ticker(ticker).build();
    }

    /** Planning, fallback completion and retries share one bounded, server-owned classification. */
    public MemoryCategory classifyForTile(ChatModel model, String question, String mapId, String tileId) {
        if (question == null || question.isBlank()) return MemoryCategory.UNKNOWN;
        if (mapId == null || mapId.isBlank() || tileId == null || tileId.isBlank()) return classify(model, question);
        var key = new RequestKey(new ModelIdentity(model), mapId, tileId,
                Hashing.sha256().hashString(question, StandardCharsets.UTF_8).toString());
        try {
            // Cache.get coalesces concurrent callers. Cache UNKNOWN too, so fallback does not wait twice.
            return classifications.get(key, () -> classify(model, question));
        } catch (ExecutionException error) {
            log.warn("问答记忆分类复用失败，使用 UNKNOWN 并继续回答。");
            return MemoryCategory.UNKNOWN;
        }
    }

    private record RequestKey(ModelIdentity model, String mapId, String tileId, String questionHash) {}
    private record ModelIdentity(ChatModel value) {
        @Override public boolean equals(Object other) {
            return other instanceof ModelIdentity identity && value == identity.value;
        }
        @Override public int hashCode() { return System.identityHashCode(value); }
    }

    public MemoryCategory classify(ChatModel model, String question) {
        if (question == null || question.isBlank()) return MemoryCategory.UNKNOWN;
        try {
            var response = Mono.fromCallable(() -> model.call(MemoryClassificationPrompts.classification(question)))
                    .subscribeOn(Schedulers.boundedElastic()).block(timeout);
            if (response == null || response.getResult() == null) return MemoryCategory.UNKNOWN;
            return MemoryCategory.normalize(response.getResult().getOutput().getText());
        } catch (RuntimeException error) {
            // Classification is optional; upstream errors may contain credentials or user content.
            log.warn("问答记忆分类失败或超时，使用 UNKNOWN 并继续回答。");
            return MemoryCategory.UNKNOWN;
        }
    }
}
