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
        ReflectionTestUtils.setField(controller, "modelApiSettings", settings);
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
    @Test void synchronousRetrievalFailureIsPublicSseErrorWithoutUpstreamDetails() {
        when(model.call(any(Prompt.class))).thenReturn(new ChatResponse(List.of(
                new Generation(new AssistantMessage("RAG_REQUIRED")))));
        when(vectors.similaritySearch(any(org.springframework.ai.vectorstore.SearchRequest.class)))
                .thenThrow(new IllegalStateException("private-upstream-detail"));
        var events = run();
        assertNotNull(events.get(0).getError());
        assertFalse(events.get(0).getError().contains("private-upstream-detail"));
        assertFalse(events.stream().anyMatch(event -> Boolean.TRUE.equals(event.getDone())));
        verify(vectors).similaritySearch(any(org.springframework.ai.vectorstore.SearchRequest.class));
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
