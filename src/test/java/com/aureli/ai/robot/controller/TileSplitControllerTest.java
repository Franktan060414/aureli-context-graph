package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.dos.*;
import com.aureli.ai.robot.domain.mapper.*;
import com.aureli.ai.robot.model.vo.customerService.SplitTileReqVO;
import com.aureli.ai.robot.service.TileSplitService;
import com.aureli.ai.robot.service.model.ModelApiSettingsService;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.*;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.support.*;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class TileSplitControllerTest {
    private TileMapper tiles;
    private TileMessageMapper messages;
    private TileEdgeMapper edges;
    private ChatModel model;
    private TileSplitService service;
    private MockMvc mvc;
    private final String fullAnswer = "完整回答，包含目标用户、实施步骤和适用条件。".repeat(100);
    private final String decision = "{\"splittable\":true,\"reason\":\"用户需求与实施步骤可以独立展开。\"}";
    private final String generation = "{\"tiles\":[{\"userMessage\":\"面向哪些用户？\",\"answer\":\"具体用户与需求\"},"
            + "{\"userMessage\":\"如何实施？\",\"answer\":\"步骤与适用条件\"}]}";

    private TileDO source() {
        return TileDO.builder().mapId("map-test").tileId("source").tileType("QA").weight(2)
                .userMessage("分析用户需求并制定实施方案").answerSummary("截断摘要").build();
    }
    private ChatResponse reply(String text) {
        return new ChatResponse(List.of(new Generation(new AssistantMessage(text))));
    }
    @BeforeEach void setUp() {
        for (Class<?> type : List.of(TileDO.class, TileMessageDO.class, TileEdgeDO.class))
            TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), type);
        tiles = mock(TileMapper.class);
        messages = mock(TileMessageMapper.class);
        edges = mock(TileEdgeMapper.class);
        model = mock(ChatModel.class);
        var settings = mock(ModelApiSettingsService.class);
        when(settings.chatModel()).thenReturn(model);
        var transactions = mock(TransactionTemplate.class);
        when(transactions.execute(any())).thenAnswer(call -> ((TransactionCallback<?>) call.getArgument(0))
                .doInTransaction(new SimpleTransactionStatus()));
        service = new TileSplitService(tiles, messages, edges, settings, transactions);
        mvc = MockMvcBuilders.standaloneSetup(new TileSplitController(service)).build();
        when(tiles.selectOne(any())).thenReturn(source());
        when(messages.selectList(any())).thenReturn(List.of(
                TileMessageDO.builder().mapId("map-test").tileId("source").role("assistant").content(fullAnswer).build()));
        when(model.call(any(Prompt.class))).thenReturn(reply(decision), reply(generation));
    }
    private void noWrites() {
        verify(tiles, never()).insert(any(TileDO.class));
        verify(messages, never()).insert(any(TileMessageDO.class));
        verifyNoInteractions(edges);
    }

    @Test void evaluatesBeforeGeneratingAndPersistsDistinctChildrenWithFullSourceAndRequirements() throws Exception {
        mvc.perform(post("/customer-service/tile/split").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"map-test\",\"sourceTileId\":\" source \",\"requirements\":\" 面向初学者 \"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.tiles.length()").value(2))
                .andExpect(jsonPath("$.data.tiles[0].message").value("面向哪些用户？"))
                .andExpect(jsonPath("$.data.tiles[0].answer").value("具体用户与需求"))
                .andExpect(jsonPath("$.data.tiles[0].weight").value(2))
                .andExpect(jsonPath("$.data.tiles[0].relatedTileIds[0]").value("source"))
                .andExpect(jsonPath("$.data.edges.length()").value(2))
                .andExpect(jsonPath("$.data.edges[0].relationType").value("DIVIDES"))
                .andExpect(jsonPath("$.data.edges[0].description").value("手动拆分：面向初学者"));
        var prompts = ArgumentCaptor.forClass(Prompt.class);
        verify(model, times(2)).call(prompts.capture());
        assertTrue(prompts.getAllValues().getFirst().getSystemMessage().getText().contains("先判断"));
        for (var prompt : prompts.getAllValues()) {
            assertTrue(prompt.getUserMessage().getText().contains(fullAnswer));
            assertTrue(prompt.getUserMessage().getText().contains("面向初学者"));
            assertFalse(prompt.getUserMessage().getText().contains("截断摘要"));
        }
        var saved = ArgumentCaptor.forClass(TileDO.class);
        verify(tiles, times(2)).insert(saved.capture());
        assertNotEquals(saved.getAllValues().get(0).getTileId(), saved.getAllValues().get(1).getTileId());
        assertTrue(saved.getAllValues().stream().allMatch(tile -> tile.getMapId().equals("map-test") && tile.getWeight() == 2));
        verify(messages, times(4)).insert(any(TileMessageDO.class));
        verify(edges, times(2)).insert(any(TileEdgeDO.class));
        verify(tiles, never()).updateById(any(TileDO.class));
        verify(tiles, never()).delete(any());
    }

    @Test void rejectedValueReturnsSpecificReasonWithoutGeneratingOrWritingAnything() throws Exception {
        when(model.call(any(Prompt.class))).thenReturn(reply("{\"splittable\":false,\"reason\":\"当前只是一个简单定义，没有两个可独立展开的子问题。\"}"));
        mvc.perform(post("/customer-service/tile/split").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"map-test\",\"sourceTileId\":\"source\"}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.errorCode").value("TILE_NOT_SPLITTABLE"))
                .andExpect(jsonPath("$.message").value("拆分失败：当前只是一个简单定义，没有两个可独立展开的子问题。"));
        verify(model).call(any(Prompt.class));
        noWrites();
    }

    @ParameterizedTest @ValueSource(strings = { "{}", "null", "[]", "不是 JSON", "{\"splittable\":\"true\",\"reason\":\"理由\"}",
            "{\"splittable\":true}", "{\"splittable\":false,\"reason\":\" \"}" })
    void invalidDecisionNeverFallsThroughToGeneration(String json) throws Exception {
        when(model.call(any(Prompt.class))).thenReturn(reply(json));
        mvc.perform(post("/customer-service/tile/split").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"map-test\",\"sourceTileId\":\"source\"}"))
                .andExpect(status().isInternalServerError()).andExpect(jsonPath("$.success").value(false));
        verify(model).call(any(Prompt.class));
        noWrites();
    }

    @ParameterizedTest @ValueSource(strings = { "{}", "null", "不是 JSON", "{\"tiles\":[]}",
            "{\"tiles\":[{\"userMessage\":\"问题\",\"answer\":\"回答\"}]}",
            "{\"tiles\":[{\"userMessage\":\"问题\",\"answer\":\"回答\"},{\"userMessage\":\" 问题 \",\"answer\":\"另一回答\"}]}",
            "{\"tiles\":[{\"userMessage\":\"问题\",\"answer\":\"回答\"},{\"userMessage\":42,\"answer\":\"回答\"}]}",
            "{\"tiles\":[{\"userMessage\":\"问题\",\"answer\":\"回答\"},{\"userMessage\":\"另一个问题\",\"answer\":\" \"}]}" })
    void malformedOrDuplicateChildrenNeverCreatePartialTiles(String json) {
        when(model.call(any(Prompt.class))).thenReturn(reply(decision), reply(json));
        assertThrows(IllegalStateException.class, () -> service.split(new SplitTileReqVO("source", "", "map-test")));
        noWrites();
    }

    @Test void sourceChangedDuringModelCallsDoesNotSaveStaleResults() {
        var updated = source();
        updated.setWeight(3);
        when(tiles.selectOne(any())).thenReturn(source(), updated);
        var error = assertThrows(IllegalArgumentException.class, () -> service.split(new SplitTileReqVO("source", null, "map-test")));
        assertTrue(error.getMessage().contains("已发生变化"));
        noWrites();
    }

    @Test void fullAnswerChangedDuringModelCallsDoesNotSaveStaleResults() {
        when(messages.selectList(any())).thenReturn(List.of(TileMessageDO.builder().content(fullAnswer).build()),
                List.of(TileMessageDO.builder().content("更新后的回答").build()));
        assertThrows(IllegalArgumentException.class, () -> service.split(new SplitTileReqVO("source", null, "map-test")));
        noWrites();
    }

    @ParameterizedTest @ValueSource(strings = { "NOTE", "FILE" })
    void artifactsAreRejectedBeforeModelAccess(String type) {
        var tile = source(); tile.setTileType(type);
        when(tiles.selectOne(any())).thenReturn(tile);
        assertThrows(IllegalArgumentException.class, () -> service.split(new SplitTileReqVO("source", null, "map-test")));
        verifyNoInteractions(model, messages, edges);
    }

    @Test void missingSourceOrIncompleteAnswerIsRejectedBeforeCallingModel() {
        when(tiles.selectOne(any())).thenReturn(null);
        assertThrows(IllegalArgumentException.class, () -> service.split(new SplitTileReqVO("source", null, "map-test")));
        var incomplete = source(); incomplete.setAnswerSummary(null);
        when(tiles.selectOne(any())).thenReturn(incomplete);
        when(messages.selectList(any())).thenReturn(List.of());
        assertThrows(IllegalArgumentException.class, () -> service.split(new SplitTileReqVO("source", null, "map-test")));
        verifyNoInteractions(model);
        noWrites();
    }

    @Test void upstreamFailureDoesNotExposeCredentialsOrWriteAnything() throws Exception {
        when(model.call(any(Prompt.class))).thenThrow(new IllegalStateException("secret API credential"));
        mvc.perform(post("/customer-service/tile/split").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"map-test\",\"sourceTileId\":\"source\"}"))
                .andExpect(status().isInternalServerError())
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("secret"))));
        noWrites();
    }

    @Test void legacyQaFencedJsonAndOptionalRequirementsAreSupported() {
        var legacy = source(); legacy.setTileType(null);
        when(tiles.selectOne(any())).thenReturn(legacy);
        when(model.call(any(Prompt.class))).thenReturn(reply("```json\n" + decision + "\n```"), reply("```\n" + generation + "\n```"));
        var result = service.split(new SplitTileReqVO("source", null, "map-test"));
        assertEquals(2, result.children().size());
        assertEquals("手动拆分", result.edges().getFirst().getDescription());
    }

    @ParameterizedTest @ValueSource(strings = { "{}", "{\"mapId\":\"map-test\"}",
            "{\"sourceTileId\":\"source\"}", "{\"mapId\":\"map-test\",\"sourceTileId\":\" \"}",
            "{\"mapId\":\"map-test\",\"sourceTileId\":[\"a\",\"b\"]}" })
    void invalidRequestsCannotReachDatabaseOrModel(String json) throws Exception {
        mvc.perform(post("/customer-service/tile/split").contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(tiles, messages, edges, model);
    }

    @Test void overlongRequirementsAreRejected() throws Exception {
        mvc.perform(post("/customer-service/tile/split").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"map-test\",\"sourceTileId\":\"source\",\"requirements\":\"" + "字".repeat(2001) + "\"}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(tiles, messages, edges, model);
    }

    @Test void retryOfSavedOperationDoesNotCallModelOrCreateAnotherGroup() throws Exception {
        when(tiles.selectCount(any())).thenReturn(2L);
        mvc.perform(post("/customer-service/tile/split").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"map-test\",\"sourceTileId\":\"source\",\"splitId\":\"same-operation\"}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.errorCode").value("TILE_SPLIT_ALREADY_SAVED"))
                .andExpect(jsonPath("$.message").value("本次拆分已保存，请先同步图谱查看结果；重复提交不会创建新节点。"));
        verifyNoInteractions(model);
        noWrites();
    }

    @Test void tooManyChildrenAreRejectedAndDoNotCreatePartialResults() {
        String five = "{\"tiles\":[" + java.util.stream.IntStream.range(0, 5)
                .mapToObj(index -> "{\"userMessage\":\"问题" + index + "\",\"answer\":\"回答\"}")
                .collect(java.util.stream.Collectors.joining(",")) + "]}";
        when(model.call(any(Prompt.class))).thenReturn(reply(decision), reply(five));
        assertThrows(IllegalStateException.class, () -> service.split(new SplitTileReqVO("source", null, "map-test")));
        noWrites();
    }
}
