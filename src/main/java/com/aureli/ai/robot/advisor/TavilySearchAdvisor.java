package com.aureli.ai.robot.advisor;

import com.aureli.ai.robot.prompt.TavilySearchPrompts;
import com.aureli.ai.robot.service.search.TavilyMcpSearchService;
import com.aureli.ai.robot.service.search.TavilySettingsService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClientRequest;
import org.springframework.ai.chat.client.ChatClientResponse;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisor;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisorChain;
import org.springframework.ai.chat.model.ChatModel;
import tools.jackson.databind.json.JsonMapper;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/** One bounded MCP search per answer, after memory and RAG, before streaming/persistence. */
@Slf4j
public class TavilySearchAdvisor implements StreamAdvisor {
    private final TavilySettingsService settings;
    private final TavilyMcpSearchService search;
    private final ChatModel model;
    private static final JsonMapper JSON = JsonMapper.builder().build();

    public TavilySearchAdvisor(TavilySettingsService settings, TavilyMcpSearchService search, ChatModel model) {
        this.settings = settings;
        this.search = search;
        this.model = model;
    }
    @Override public int getOrder() { return 3; }
    @Override public String getName() { return getClass().getSimpleName(); }
    @Override public Flux<ChatClientResponse> adviseStream(ChatClientRequest request, StreamAdvisorChain chain) {
        return Mono.fromCallable(() -> augment(request)).subscribeOn(Schedulers.boundedElastic())
                .flatMapMany(chain::nextStream);
    }
    private ChatClientRequest augment(ChatClientRequest request) {
        var active = settings.snapshot();
        // Disabled means no routing model call, connection, discovery or search.
        if (!active.enabled()) return request;
        try {
            var response = model.call(TavilySearchPrompts.decision(request.prompt()));
            if (response == null || response.getResult() == null)
                throw new IllegalStateException("Missing routing response");
            var decision = JSON.readTree(response.getResult().getOutput().getText());
            if (!decision.isObject() || !decision.path("search").isBoolean())
                throw new IllegalArgumentException("Invalid routing response");
            if (!decision.path("search").asBoolean()) return request;
            var query = decision.path("query");
            if (!query.isString() || query.asString().isBlank() || query.asString().length() > 500)
                throw new IllegalArgumentException("Invalid search query");
            String result = search.search(active, query.asString().trim());
            return request.mutate().prompt(TavilySearchPrompts.answer(request.prompt(), result)).build();
        } catch (RuntimeException error) {
            // Upstream messages may contain credentials or user data; never log the cause.
            log.warn("联网检索未完成，继续依据已有上下文回答。");
            return request.mutate().prompt(TavilySearchPrompts.unavailable(request.prompt())).build();
        }
    }
}
