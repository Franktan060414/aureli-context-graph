package com.aureli.ai.robot.service;

import com.aureli.ai.robot.domain.MemoryCategory;
import com.aureli.ai.robot.prompt.MemoryClassificationPrompts;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import java.time.Duration;

@Service
@Slf4j
public class MemoryClassificationService {
    private final Duration timeout;
    public MemoryClassificationService() { this(Duration.ofSeconds(8)); }
    MemoryClassificationService(Duration timeout) { this.timeout = timeout; }
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
