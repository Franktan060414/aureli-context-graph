package com.aureli.ai.robot.advisor;

import com.aureli.ai.robot.prompt.CustomerServicePrompts;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClientRequest;
import org.springframework.ai.chat.client.ChatClientResponse;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisor;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisorChain;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

import java.util.List;

/** 先读取 Tile 工作记忆，再判定是否需要检索专业资料。 */
@Slf4j
public class CustomerServiceAdvisor implements StreamAdvisor {

    private final VectorStore vectorStore;
    private final ChatModel chatModel;

    public CustomerServiceAdvisor(VectorStore vectorStore, ChatModel chatModel) {
        this.vectorStore = vectorStore;
        this.chatModel = chatModel;
    }

    @Override
    public Flux<ChatClientResponse> adviseStream(ChatClientRequest request, StreamAdvisorChain chain) {
        // 判定与向量检索是阻塞调用；内部判定结果不进入回答流或消息持久化。
        return Mono.fromCallable(() -> augment(request))
                .subscribeOn(Schedulers.boundedElastic())
                .flatMapMany(chain::nextStream);
    }

    private ChatClientRequest augment(ChatClientRequest request) {
        Prompt prompt = request.prompt();
        String context = "";
        if (requiresKnowledge(prompt)) {
            List<Document> documents = vectorStore.similaritySearch(SearchRequest.builder()
                    .query(prompt.getUserMessage().getText())
                    .topK(3)
                    .build());
            if (documents != null) {
                StringBuilder content = new StringBuilder();
                for (Document document : documents) {
                    if (document.getText() != null && !document.getText().isBlank()) {
                        content.append(CustomerServicePrompts.knowledgeDocument(document.getText()));
                    }
                }
                context = content.toString();
            }
        }
        return request.mutate()
                .prompt(CustomerServicePrompts.ragAnswer(prompt, context))
                .build();
    }

    private boolean requiresKnowledge(Prompt prompt) {
        try {
            ChatResponse response = chatModel.call(CustomerServicePrompts.knowledgeDecision(prompt));
            if (response == null || response.getResult() == null) {
                return false;
            }
            String decision = response.getResult().getOutput().getText();
            // 只有明确的肯定标记才检索；含糊回答或额外说明均按不检索处理。
            return decision != null && CustomerServicePrompts.RAG_REQUIRED.equals(decision.trim());
        } catch (RuntimeException error) {
            log.warn("知识检索判定失败，继续使用工作记忆与通用回答能力", error);
            return false;
        }
    }

    @Override
    public String getName() {
        return getClass().getSimpleName();
    }

    @Override
    public int getOrder() {
        return 2;
    }
}
