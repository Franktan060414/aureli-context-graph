package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.dos.TileDO;
import com.aureli.ai.robot.domain.mapper.*;
import com.aureli.ai.robot.model.vo.customerService.AiCustomerServiceChatReqVO;
import com.aureli.ai.robot.service.*;
import com.aureli.ai.robot.service.model.ModelApiSettingsService;
import com.aureli.ai.robot.service.search.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.*;
import org.springframework.ai.chat.prompt.ChatOptions;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.*;
import reactor.core.publisher.Flux;
import java.time.Duration;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Exercises the actual planning-to-stream handoff with a shared backend classifier. */
class ClassificationReuseTest {
    final ChatModel model = mock(ChatModel.class);
    final TileMapper tiles = mock(TileMapper.class);
    final TileMessageMapper messages = mock(TileMessageMapper.class);
    final TileEdgeMapper edges = mock(TileEdgeMapper.class);
    final MapMapper maps = mock(MapMapper.class);
    TileQuestionPlanService planning;
    AiCustomerServiceController completion;
    final String simple = "{\"suggested\":false,\"reason\":\"单一任务\",\"questions\":[]}";
    final String split = "{\"suggested\":true,\"reason\":\"两个独立任务\",\"questions\":[\"如何设计存储？\",\"如何实现接口？\"]}";

    ChatResponse reply(String text) { return new ChatResponse(List.of(new Generation(new AssistantMessage(text)))); }
    AiCustomerServiceChatReqVO request() {
        return AiCustomerServiceChatReqVO.builder().mapId("map-a").tileId("new-tile")
                .message("这个项目必须完全离线运行").relatedTileIds(List.of()).build();
    }

    @BeforeEach void setup() {
        var settings = mock(ModelApiSettingsService.class);
        when(settings.chatModel()).thenReturn(model);
        when(model.getOptions()).thenReturn(ChatOptions.builder().model("fixture").build());
        when(model.stream(any(Prompt.class))).thenReturn(Flux.just(reply("完整回答")));
        when(maps.selectCount(any())).thenReturn(1L);
        var transaction = mock(TransactionTemplate.class);
        when(transaction.execute(any())).thenAnswer(call -> ((TransactionCallback<?>)call.getArgument(0))
                .doInTransaction(new SimpleTransactionStatus()));
        var general = MemoryTestSupport.settings();
        var classifier = new MemoryClassificationService();
        planning = new TileQuestionPlanService(tiles, messages, edges, maps, settings,
                mock(TileQuestionAnswerGenerator.class), transaction, general, classifier);
        completion = new AiCustomerServiceController();
        ReflectionTestUtils.setField(completion, "modelApiSettings", settings);
        ReflectionTestUtils.setField(completion, "generalSettings", general);
        ReflectionTestUtils.setField(completion, "memoryClassification", classifier);
        ReflectionTestUtils.setField(completion, "tileMapper", tiles);
        ReflectionTestUtils.setField(completion, "tileMessageMapper", messages);
        ReflectionTestUtils.setField(completion, "tileEdgeMapper", edges);
        ReflectionTestUtils.setField(completion, "transactionTemplate", transaction);
        ReflectionTestUtils.setField(completion, "vectorStore", mock(VectorStore.class));
        var tavily = mock(TavilySettingsService.class);
        when(tavily.snapshot()).thenReturn(new TavilySettingsRepository.Settings(false, TavilySettingsService.DEFAULT_URL, ""));
        ReflectionTestUtils.setField(completion, "tavilySettings", tavily);
        ReflectionTestUtils.setField(completion, "tavilySearch", mock(TavilyMcpSearchService.class));
    }

    void completeAndCheck(String expectedCategory) {
        var events = completion.tileChat(request()).collectList().block(Duration.ofSeconds(5));
        assertEquals("完整回答", events.getFirst().getV());
        assertTrue(events.getLast().getDone());
        var saved = ArgumentCaptor.forClass(TileDO.class);
        verify(tiles).insert(saved.capture());
        assertEquals(expectedCategory, saved.getValue().getMemoryCategory());
        var calls = ArgumentCaptor.forClass(Prompt.class);
        verify(model, times(3)).call(calls.capture()); // classification, planning, knowledge routing
        assertEquals(1, calls.getAllValues().stream().filter(prompt -> prompt.getSystemMessage().getText()
                .contains("内部记忆用途分类器")).count());
        verify(messages, times(2)).insert(any(com.aureli.ai.robot.domain.dos.TileMessageDO.class));
    }

    @Test void noSplitReusesPlanningClassificationDuringOrdinaryCompletion() {
        when(model.call(any(Prompt.class))).thenReturn(reply("PROJECT_RULE"), reply(simple), reply("DIRECT"));
        assertFalse(planning.prepare(request()).suggested());
        completeAndCheck("PROJECT_RULE");
    }

    @Test void decliningSplitReusesClassificationWithoutExposingItToTheBrowser() {
        when(model.call(any(Prompt.class))).thenReturn(reply("PROJECT_RULE"), reply(split), reply("DIRECT"));
        var proposal = planning.prepare(request());
        assertTrue(proposal.suggested());
        String json = tools.jackson.databind.json.JsonMapper.builder().build().writeValueAsString(proposal);
        assertFalse(json.contains("PROJECT_RULE")); assertFalse(json.contains("memoryCategory"));
        assertNull(planning.decide("map-a", proposal.planId(), "DECLINE"));
        completeAndCheck("PROJECT_RULE");
    }

    @Test void failedPlanningStillReusesTheEarlierClassification() {
        when(model.call(any(Prompt.class))).thenReturn(reply("PROJECT_RULE"))
                .thenThrow(new IllegalStateException("planning unavailable")).thenReturn(reply("DIRECT"));
        assertThrows(TileQuestionPlanService.PlanningUnavailable.class, () -> planning.prepare(request()));
        completeAndCheck("PROJECT_RULE");
    }

    @Test void failedClassificationDoesNotRunAgainOnFallbackCompletion() {
        when(model.call(any(Prompt.class))).thenThrow(new IllegalStateException("classification unavailable"))
                .thenReturn(reply(simple), reply("DIRECT"));
        assertFalse(planning.prepare(request()).suggested());
        completeAndCheck("UNKNOWN");
    }
}
