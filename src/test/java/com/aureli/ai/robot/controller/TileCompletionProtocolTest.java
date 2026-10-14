package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.mapper.*;
import com.aureli.ai.robot.domain.dos.TileDO;
import com.aureli.ai.robot.model.vo.customerService.*;
import com.aureli.ai.robot.service.model.ModelApiSettingsService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.*;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.*;
import reactor.core.publisher.Flux;
import java.time.Duration;
import java.util.List;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;

class TileCompletionProtocolTest {
    private final ChatModel model = mock(ChatModel.class);
    private final VectorStore vectors = mock(VectorStore.class);
    private final TransactionTemplate transaction = mock(TransactionTemplate.class);
    private final TileMessageMapper messages = mock(TileMessageMapper.class);
    private final TileMapper tiles = mock(TileMapper.class);
    private AiCustomerServiceController controller() {
        when(model.getOptions()).thenReturn(org.springframework.ai.chat.prompt.ChatOptions.builder().model("test-model").build());
        var settings = mock(ModelApiSettingsService.class);
        when(settings.chatModel()).thenReturn(model);
        var controller = new AiCustomerServiceController();
        ReflectionTestUtils.setField(controller, "generalSettings", com.aureli.ai.robot.service.MemoryTestSupport.settings());
        ReflectionTestUtils.setField(controller, "memoryClassification", com.aureli.ai.robot.service.MemoryTestSupport.classifier());
        ReflectionTestUtils.setField(controller, "modelApiSettings", settings);
        var tavily = mock(com.aureli.ai.robot.service.search.TavilySettingsService.class);
        when(tavily.snapshot()).thenReturn(new com.aureli.ai.robot.service.search.TavilySettingsRepository.Settings(
                false, com.aureli.ai.robot.service.search.TavilySettingsService.DEFAULT_URL, ""));
        ReflectionTestUtils.setField(controller, "tavilySettings", tavily);
        ReflectionTestUtils.setField(controller, "tavilySearch", mock(com.aureli.ai.robot.service.search.TavilyMcpSearchService.class));
        ReflectionTestUtils.setField(controller, "vectorStore", vectors);
        ReflectionTestUtils.setField(controller, "tileMapper", tiles);
        ReflectionTestUtils.setField(controller, "tileEdgeMapper", mock(TileEdgeMapper.class));
        ReflectionTestUtils.setField(controller, "tileMessageMapper", messages);
        ReflectionTestUtils.setField(controller, "transactionTemplate", transaction);
        return controller;
    }
    private List<AiCustomerServiceChatRspVO> run() {
        return controller().tileChat(AiCustomerServiceChatReqVO.builder().mapId("map-test")
                .tileId("protocol-test").message("问题").relatedTileIds(List.of()).build())
                .collectList().block(Duration.ofSeconds(5));
    }
    private void answer() {
        when(model.stream(any(Prompt.class))).thenReturn(Flux.just(
                new ChatResponse(List.of(new Generation(new AssistantMessage("完整回答"))))));
    }
    @Test void successAcknowledgesOnlyAfterMessagesAreSaved() {
        answer();
        when(transaction.execute(any())).thenAnswer(call -> ((TransactionCallback<?>) call.getArgument(0))
                .doInTransaction(new SimpleTransactionStatus()));
        var events = run();
        assertEquals("完整回答", events.get(0).getV());
        assertTrue(events.get(events.size()-1).getDone());
        verify(messages, times(2)).insert(any(com.aureli.ai.robot.domain.dos.TileMessageDO.class));
        var savedTile = ArgumentCaptor.forClass(TileDO.class);
        verify(tiles).insert(savedTile.capture());
        assertEquals(1, savedTile.getValue().getWeight());
    }

    @Test void classificationIsPersistedButNeverAppearsInTheAnswerOrPublicTile() {
        answer();
        when(model.call(any(Prompt.class))).thenAnswer(call -> {
            Prompt prompt = call.getArgument(0);
            String reply = prompt.getSystemMessage().getText().contains("内部记忆用途分类器") ? "PROJECT_RULE" : "DIRECT";
            return new ChatResponse(List.of(new Generation(new AssistantMessage(reply))));
        });
        when(transaction.execute(any())).thenAnswer(call -> ((TransactionCallback<?>)call.getArgument(0))
                .doInTransaction(new SimpleTransactionStatus()));
        var actual = controller();
        ReflectionTestUtils.setField(actual, "memoryClassification", new com.aureli.ai.robot.service.MemoryClassificationService());
        var events = actual.tileChat(AiCustomerServiceChatReqVO.builder().mapId("map-test").tileId("classified")
                .message("这个项目必须离线运行").build()).collectList().block(Duration.ofSeconds(5));
        assertEquals("完整回答", events.getFirst().getV());
        assertTrue(events.getLast().getDone());
        var saved = ArgumentCaptor.forClass(TileDO.class);
        verify(tiles).insert(saved.capture());
        assertEquals("PROJECT_RULE", saved.getValue().getMemoryCategory());
        String json = tools.jackson.databind.json.JsonMapper.builder().build().writeValueAsString(saved.getValue());
        assertFalse(json.contains("memoryCategory")); assertFalse(json.contains("PROJECT_RULE"));
        verify(model, times(2)).call(any(Prompt.class)); // classification, then existing knowledge routing
        var persisted = ArgumentCaptor.forClass(com.aureli.ai.robot.domain.dos.TileMessageDO.class);
        verify(messages, times(2)).insert(persisted.capture());
        assertEquals(List.of("这个项目必须离线运行", "完整回答"), persisted.getAllValues().stream()
                .map(com.aureli.ai.robot.domain.dos.TileMessageDO::getContent).toList());
    }
    @ParameterizedTest
    @ValueSource(ints = {2, 3})
    void regeneratingAnExistingTilePreservesItsWeight(int weight) {
        answer();
        when(tiles.selectOne(any())).thenReturn(TileDO.builder().mapId("map-test").id(42L)
                .tileId("protocol-test").weight(weight).build());
        when(transaction.execute(any())).thenAnswer(call -> ((TransactionCallback<?>) call.getArgument(0))
                .doInTransaction(new SimpleTransactionStatus()));

        var events = run();

        assertTrue(events.get(events.size() - 1).getDone());
        var savedTile = ArgumentCaptor.forClass(TileDO.class);
        verify(tiles).updateById(savedTile.capture());
        assertEquals(weight, savedTile.getValue().getWeight());
        verify(tiles, never()).insert(any(TileDO.class));
    }
    @Test void persistenceFailureDoesNotSendSuccessfulTerminalEvent() {
        answer();
        when(transaction.execute(any())).thenReturn(false);
        var events = run();
        assertEquals("完整回答", events.get(0).getV());
        assertNotNull(events.get(events.size()-1).getError());
        assertFalse(events.stream().anyMatch(event -> Boolean.TRUE.equals(event.getDone())));
    }
    @Test void synchronousAnswerFailureIsPublicSseErrorWithoutUpstreamDetails() {
        when(model.stream(any(Prompt.class))).thenThrow(new IllegalStateException("private-upstream-detail"));
        var events = run();
        assertNotNull(events.get(0).getError());
        assertFalse(events.get(0).getError().contains("private-upstream-detail"));
        assertFalse(events.stream().anyMatch(event -> Boolean.TRUE.equals(event.getDone())));
        verifyNoInteractions(vectors);
        verifyNoInteractions(messages);
    }
    @Test void retryCannotOverwriteTileOwnedByAnotherMap() {
        answer();
        when(tiles.selectOne(any())).thenReturn(TileDO.builder().mapId("map-test").id(42L)
                .mapId("map-b").tileId("protocol-test").userMessage("B private").build());
        when(transaction.execute(any())).thenAnswer(call -> ((TransactionCallback<?>) call.getArgument(0))
                .doInTransaction(new SimpleTransactionStatus()));
        var events = run();
        assertFalse(events.stream().anyMatch(event -> Boolean.TRUE.equals(event.getDone())));
        assertNotNull(events.getLast().getError());
        verify(tiles, never()).updateById(any(TileDO.class));
        verify(tiles, never()).insert(any(TileDO.class));
        verifyNoInteractions(messages);
    }

    @Test void streamPersistsQuestionAndAnswerInCapturedMap() {
        answer();
        when(transaction.execute(any())).thenAnswer(call -> ((TransactionCallback<?>) call.getArgument(0))
                .doInTransaction(new SimpleTransactionStatus()));
        var events = controller().tileChat(AiCustomerServiceChatReqVO.builder().mapId("map-test")
                .tileId("map-a-tile").mapId("map-a").message("A question").build())
                .collectList().block(Duration.ofSeconds(5));
        assertTrue(events.getLast().getDone());
        var tile = ArgumentCaptor.forClass(TileDO.class);
        verify(tiles).insert(tile.capture());
        assertEquals("map-a", tile.getValue().getMapId());
        var savedMessages = ArgumentCaptor.forClass(com.aureli.ai.robot.domain.dos.TileMessageDO.class);
        verify(messages, times(2)).insert(savedMessages.capture());
        assertTrue(savedMessages.getAllValues().stream().allMatch(message -> "map-a".equals(message.getMapId())));
    }

}
