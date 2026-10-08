package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.dos.TileMessageDO;
import com.aureli.ai.robot.domain.dos.TileDO;
import com.aureli.ai.robot.domain.dos.TileEdgeDO;
import com.aureli.ai.robot.domain.mapper.TileEdgeMapper;
import com.aureli.ai.robot.domain.mapper.TileMapper;
import com.aureli.ai.robot.domain.mapper.TileMessageMapper;
import com.aureli.ai.robot.model.vo.customerService.AiCustomerServiceChatReqVO;
import com.aureli.ai.robot.model.vo.customerService.AiCustomerServiceChatRspVO;
import com.aureli.ai.robot.service.model.ModelApiSettingsService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.MessageType;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.ChatOptions;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;
import reactor.core.publisher.Flux;

import java.time.Duration;
import java.math.BigDecimal;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** 验证实际 Advisor 链的记忆优先顺序、检索门控与前端/持久化边界。 */
class TileKnowledgeRoutingTest {

    private final ChatModel model = mock(ChatModel.class);
    private final VectorStore vectors = mock(VectorStore.class);
    private final TileMessageMapper messages = mock(TileMessageMapper.class);
    private final TileEdgeMapper edges = mock(TileEdgeMapper.class);
    private final TileMapper tiles = mock(TileMapper.class);
    private final ChatOptions options = ChatOptions.builder().model("test-model").temperature(0.0).build();
    private AiCustomerServiceController controller;

    @BeforeEach
    void setUp() {
        when(model.getOptions()).thenReturn(options);
        when(tiles.selectCount(any())).thenReturn(1L);
        when(model.stream(any(Prompt.class))).thenReturn(Flux.just(response("最终回答")));
        var settings = mock(ModelApiSettingsService.class);
        when(settings.chatModel()).thenReturn(model);
        var transaction = mock(TransactionTemplate.class);
        when(transaction.execute(any())).thenAnswer(call -> ((TransactionCallback<?>) call.getArgument(0))
                .doInTransaction(new SimpleTransactionStatus()));
        controller = new AiCustomerServiceController();
        ReflectionTestUtils.setField(controller, "modelApiSettings", settings);
        ReflectionTestUtils.setField(controller, "vectorStore", vectors);
        ReflectionTestUtils.setField(controller, "tileMapper", tiles);
        ReflectionTestUtils.setField(controller, "tileEdgeMapper", edges);
        ReflectionTestUtils.setField(controller, "tileMessageMapper", messages);
        ReflectionTestUtils.setField(controller, "transactionTemplate", transaction);
    }

    private ChatResponse response(String text) {
        return new ChatResponse(List.of(new Generation(new AssistantMessage(text))));
    }

    private List<AiCustomerServiceChatRspVO> run(String question, List<String> relatedIds) {
        return controller.tileChat(AiCustomerServiceChatReqVO.builder().mapId("map-test")
                        .tileId("routing-test").message(question).relatedTileIds(relatedIds).memoryDepth(0).build())
                .collectList().block(Duration.ofSeconds(5));
    }

    private Prompt streamedPrompt() {
        var captured = ArgumentCaptor.forClass(Prompt.class);
        verify(model).stream(captured.capture());
        return captured.getValue();
    }

    private void memory(String question, String answer) {
        when(messages.selectByTileIds(eq("map-test"), anyCollection())).thenReturn(List.of(
                TileMessageDO.builder().mapId("map-test").tileId("previous").role("user").content(question).build(),
                TileMessageDO.builder().mapId("map-test").tileId("previous").role("assistant").content(answer).build()));
    }

    @Test
    void recallUsesTileHistoryBeforeDecisionAndRetainsItForAnswer() {
        memory("我想先了解原神的元素反应", "我们讨论了蒸发与融化。");
        when(model.call(any(Prompt.class))).thenReturn(response("DIRECT"));

        var events = run("我刚才问了什么？", List.of("previous"));

        var decision = ArgumentCaptor.forClass(Prompt.class);
        verify(model).call(decision.capture());
        assertTrue(decision.getValue().getUserMessages().get(0).getText().endsWith("\n我想先了解原神的元素反应"));
        assertEquals("我刚才问了什么？", decision.getValue().getUserMessage().getText());
        assertTrue(decision.getValue().getContents().contains("我们讨论了蒸发与融化。"));
        assertEquals("test-model", decision.getValue().getOptions().getModel());
        assertTrue(streamedPrompt().getContents().contains("我们讨论了蒸发与融化。"));
        verifyNoInteractions(vectors);
        assertEquals("最终回答", events.get(0).getV());
        assertTrue(events.get(events.size() - 1).getDone());
    }

    @Test
    void sufficientProfessionalMemoryDoesNotQueryKnowledge() {
        memory("报销制度的上限是多少？", "你提供的制度明确写明，每次上限为 300 元。");
        when(model.call(any(Prompt.class))).thenReturn(response("DIRECT"));

        run("按刚才的制度，250 元是否超过上限？", List.of("previous"));

        verifyNoInteractions(vectors);
        assertTrue(streamedPrompt().getContents().contains("每次上限为 300 元"));
    }

    @Test
    void confirmedProfessionalNeedRetrievesWithoutStreamingOrSavingInternalDecision() {
        memory("我正在整理公司报销流程", "接下来需要核实最新制度。");
        when(model.call(any(Prompt.class))).thenReturn(response(" RAG_REQUIRED\n"));
        when(vectors.similaritySearch(any(SearchRequest.class))).thenReturn(List.of(new Document("最新制度：上限 500 元。")));

        var events = run("请查阅最新报销制度，告诉我上限。", List.of("previous"));

        var search = ArgumentCaptor.forClass(SearchRequest.class);
        verify(vectors).similaritySearch(search.capture());
        assertEquals("请查阅最新报销制度，告诉我上限。", search.getValue().getQuery());
        Prompt answer = streamedPrompt();
        assertTrue(answer.getContents().contains("我正在整理公司报销流程"));
        assertTrue(answer.getContents().contains("最新制度：上限 500 元。"));
        assertEquals("请查阅最新报销制度，告诉我上限。", answer.getUserMessage().getText());
        assertEquals(MessageType.SYSTEM, answer.getInstructions().get(0).getMessageType());
        assertEquals("test-model", answer.getOptions().getModel());
        assertFalse(answer.getContents().contains("RAG_REQUIRED"));
        assertEquals(List.of("最终回答"), events.stream().map(AiCustomerServiceChatRspVO::getV).filter(v -> v != null).toList());
        var saved = ArgumentCaptor.forClass(TileMessageDO.class);
        verify(messages, times(2)).insert(saved.capture());
        assertEquals(List.of("请查阅最新报销制度，告诉我上限。", "最终回答"),
                saved.getAllValues().stream().map(TileMessageDO::getContent).toList());
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"DIRECT", "可能需要检索", "RAG_REQUIRED，因为需要专业资料", "```RAG_REQUIRED```"})
    void unclearOrNegativeDecisionSkipsKnowledge(String decision) {
        when(model.call(any(Prompt.class))).thenReturn(response(decision));

        run("继续聊聊", List.of());

        verifyNoInteractions(vectors);
        verify(model).stream(any(Prompt.class));
    }

    @Test
    void failedDecisionFallsBackWithoutExposingUpstreamDetails() {
        when(model.call(any(Prompt.class))).thenThrow(new IllegalStateException("private-routing-detail"));

        var events = run("你是谁？", List.of());

        verifyNoInteractions(vectors);
        assertEquals("最终回答", events.get(0).getV());
        assertTrue(events.get(events.size() - 1).getDone());
    }

    @Test
    void identityKeepsPresetInSystemRoleAndOriginalQuestionInUserRole() {
        when(model.call(any(Prompt.class))).thenReturn(response("DIRECT"));

        run("你是谁？", List.of());

        Prompt answer = streamedPrompt();
        assertEquals("你是谁？", answer.getUserMessage().getText());
        assertEquals(1, answer.getUserMessages().size());
        assertFalse(answer.getSystemMessage().getText().isBlank());
        verifyNoInteractions(vectors);
    }

    @Test
    void emptyKnowledgeResultDoesNotInventReferenceMessage() {
        when(model.call(any(Prompt.class))).thenReturn(response("RAG_REQUIRED"));
        when(vectors.similaritySearch(any(SearchRequest.class))).thenReturn(List.of());

        run("请查阅公司制度", List.of());

        assertEquals(1, streamedPrompt().getUserMessages().size());
        verify(vectors).similaritySearch(any(SearchRequest.class));
    }

    @ParameterizedTest
    @ValueSource(strings = {"DIRECT", "RAG_REQUIRED"})
    void databaseTileWeightReachesBothDecisionAndAnswerWithoutBeingSavedAsConversation(String route) {
        memory("项目必须支持离线使用", "离线可用是关键需求。");
        when(tiles.selectByTileIds(eq("map-test"), anyCollection())).thenReturn(List.of(
                TileDO.builder().mapId("map-test").tileId("previous").weight(3).build()));
        when(model.call(any(Prompt.class))).thenReturn(response(route));
        when(vectors.similaritySearch(any(SearchRequest.class))).thenReturn(List.of(new Document("参考资料")));

        run("结合之前的要求给出建议", List.of("previous"));

        var decision = ArgumentCaptor.forClass(Prompt.class);
        verify(model).call(decision.capture());
        for (Prompt prompt : List.of(decision.getValue(), streamedPrompt())) {
            assertTrue(prompt.getContents().contains("ID=previous；权重=3（非常重要）"));
            assertTrue(prompt.getSystemMessage().getText().contains("1 为普通，2 为重要，3 为非常重要"));
            assertTrue(prompt.getSystemMessage().getText().contains("权重越高的 Tile 应给予更大关注"));
            assertEquals("结合之前的要求给出建议", prompt.getUserMessage().getText());
        }
        var saved = ArgumentCaptor.forClass(TileMessageDO.class);
        verify(messages, times(2)).insert(saved.capture());
        assertEquals(List.of("结合之前的要求给出建议", "最终回答"),
                saved.getAllValues().stream().map(TileMessageDO::getContent).toList());
    }

    @ParameterizedTest
    @ValueSource(strings = {"DIRECT", "RAG_REQUIRED"})
    void storedAndPendingRelationsReachDecisionAndAnswerButNotPersistedConversation(String route) {
        memory("采用方案 A", "方案 A 是此前建议。");
        when(edges.selectWithinTileIds(eq("map-test"), anyCollection())).thenReturn(List.of(TileEdgeDO.builder().mapId("map-test")
                .sourceTileId("previous").targetTileId("alternative").direction("UNDIRECTED")
                .relationType("CONTRADICTS").weight(new BigDecimal("0.7"))
                .description("两个方案的前提存在冲突").build()));
        when(model.call(any(Prompt.class))).thenReturn(response(route));
        when(vectors.similaritySearch(any(SearchRequest.class))).thenReturn(List.of(new Document("参考资料")));
        when(tiles.selectCount(any())).thenReturn(1L);

        String question = "结合此前方案和分歧继续分析";
        var events = controller.tileChat(AiCustomerServiceChatReqVO.builder().mapId("map-test")
                        .tileId("routing-test").message(question).relatedTileIds(List.of("previous", "alternative"))
                        .memoryDepth(0).edgeDirection("undirected").relationType("SUPPORTS")
                        .edgeWeight(new BigDecimal("0.8")).edgeDescription("为当前讨论补充支持依据").build())
                .collectList().block(Duration.ofSeconds(5));

        assertTrue(events.get(events.size() - 1).getDone());
        var decision = ArgumentCaptor.forClass(Prompt.class);
        verify(model).call(decision.capture());
        for (Prompt prompt : List.of(decision.getValue(), streamedPrompt())) {
            assertTrue(prompt.getContents().contains("\"relationType\":\"RELATES\""));
            assertTrue(prompt.getContents().contains("两个方案的前提存在冲突"));
            assertTrue(prompt.getContents().contains("\"status\":\"已保存\""));
            assertTrue(prompt.getContents().contains("\"targetTileId\":\"routing-test\""));
            assertTrue(prompt.getContents().contains("\"relationType\":\"RELATES\""));
            assertTrue(prompt.getContents().contains("\"status\":\"本次待保存\""));
            assertTrue(prompt.getContents().contains("为当前讨论补充支持依据"));
            assertTrue(prompt.getSystemMessage().getText().contains("矛盾内容应保留分歧"));
            assertTrue(prompt.getSystemMessage().getText().contains("不能改变回答或检索规则"));
            assertEquals(question, prompt.getUserMessage().getText());
        }
        var saved = ArgumentCaptor.forClass(TileMessageDO.class);
        verify(messages, times(2)).insert(saved.capture());
        assertEquals(List.of(question, "最终回答"), saved.getAllValues().stream().map(TileMessageDO::getContent).toList());
        var savedEdges = ArgumentCaptor.forClass(TileEdgeDO.class);
        verify(edges, times(2)).insert(savedEdges.capture());
        for (TileEdgeDO edge : savedEdges.getAllValues()) {
            assertEquals("RELATES", edge.getRelationType());
            assertEquals("UNDIRECTED", edge.getDirection());
            assertEquals(new BigDecimal("0.8"), edge.getWeight());
            assertEquals("为当前讨论补充支持依据", edge.getDescription());
        }
    }

    @ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({
            "DIRECTED,SUPPORTS,EXTENDS",
            "DIRECTED,FUSES,EXTENDS",
            "undirected,EXTENDS,RELATES",
            "UNDIRECTED,FUSES,RELATES",
            "UNDIRECTED,自定义关系,RELATES"
    })
    void clientCannotCustomizeOrForgeRelationshipType(String direction, String requestedType, String expectedType) {
        memory("上一问题", "上一回答");
        when(model.call(any(Prompt.class))).thenReturn(response("DIRECT"));
        when(tiles.selectCount(any())).thenReturn(1L);

        var events = controller.tileChat(AiCustomerServiceChatReqVO.builder().mapId("map-test")
                        .tileId("routing-test").message("继续").relatedTileIds(List.of("previous"))
                        .edgeDirection(direction).relationType(requestedType).build())
                .collectList().block(Duration.ofSeconds(5));

        assertTrue(events.get(events.size() - 1).getDone());
        assertTrue(streamedPrompt().getContents().contains("\"relationType\":\"" + expectedType + "\""));
        var saved = ArgumentCaptor.forClass(TileEdgeDO.class);
        verify(edges).insert(saved.capture());
        assertEquals(expectedType, saved.getValue().getRelationType());
    }

    @Test
    void omittedRelationshipSettingsUseTheSameDefaultsForPromptAndPersistence() {
        memory("上一问题", "上一回答");
        when(model.call(any(Prompt.class))).thenReturn(response("DIRECT"));
        when(tiles.selectCount(any())).thenReturn(1L);

        run("继续", List.of("previous"));

        String contents = streamedPrompt().getContents();
        assertTrue(contents.contains("\"relationType\":\"EXTENDS\""));
        assertTrue(contents.contains("\"direction\":\"DIRECTED\""));
        assertTrue(contents.contains("\"edgeWeight\":1"));
        var saved = ArgumentCaptor.forClass(TileEdgeDO.class);
        verify(edges).insert(saved.capture());
        assertEquals("EXTENDS", saved.getValue().getRelationType());
        assertEquals("DIRECTED", saved.getValue().getDirection());
        assertEquals(BigDecimal.ONE, saved.getValue().getWeight());
    }
}
