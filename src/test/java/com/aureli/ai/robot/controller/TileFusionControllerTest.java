package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.dos.*;
import com.aureli.ai.robot.domain.mapper.*;
import com.aureli.ai.robot.model.vo.customerService.FuseTilesReqVO;
import com.aureli.ai.robot.service.TileFusionService;
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

class TileFusionControllerTest {
    private TileMapper tiles;
    private TileMessageMapper messages;
    private TileEdgeMapper edges;
    private ChatModel model;
    private TileFusionService service;
    private MockMvc mvc;
    private final String fullAnswer = "完整回答，保留关键条件。".repeat(150);

    private TileDO qa(String id, int weight) {
        return TileDO.builder().tileId(id).tileType("QA").weight(weight)
                .userMessage("问题 " + id).answerSummary("截断摘要").build();
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
        var tx = mock(TransactionTemplate.class);
        when(tx.execute(any())).thenAnswer(call -> ((TransactionCallback<?>) call.getArgument(0))
                .doInTransaction(new SimpleTransactionStatus()));
        service = new TileFusionService(tiles, messages, edges, settings, tx);
        mvc = MockMvcBuilders.standaloneSetup(new TileFusionController(service)).build();
        when(tiles.selectCount(any())).thenReturn(0L);
        when(tiles.selectList(any())).thenReturn(List.of(qa("a", 1), qa("b", 2),
                TileDO.builder().tileId("note").tileType("NOTE").content("便签秘密").weight(3).build(),
                TileDO.builder().tileId("file").tileType("FILE").content("文件秘密").weight(3).build()));
        when(messages.selectList(any())).thenReturn(List.of(
                TileMessageDO.builder().tileId("a").role("assistant").content(fullAnswer).build(),
                TileMessageDO.builder().tileId("b").role("assistant").content("互补回答").build()));
        when(model.call(any(Prompt.class))).thenReturn(reply("{\"userMessage\":\"融合问题\",\"answer\":\"融合回答\"}"));
    }

    @Test void mixedSelectionFusesOnlyDistinctQaWithFullAnswersAndHighestQaWeight() throws Exception {
        mvc.perform(post("/customer-service/tile/fusion").contentType(MediaType.APPLICATION_JSON)
                .content("{\"tileId\":\"fused\",\"sourceTileIds\":[\"a\",\"note\",\" a \",\"file\",\"b\"]}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.tiles[0].message").value("融合问题"))
                .andExpect(jsonPath("$.data.tiles[0].answer").value("融合回答"))
                .andExpect(jsonPath("$.data.tiles[0].weight").value(2))
                .andExpect(jsonPath("$.data.tiles[0].tileType").value("QA"))
                .andExpect(jsonPath("$.data.tiles[0].relatedTileIds.length()").value(2))
                .andExpect(jsonPath("$.data.edges.length()").value(2))
                .andExpect(jsonPath("$.data.edges[0].relationType").value("FUSES"));
        var prompt = ArgumentCaptor.forClass(Prompt.class);
        verify(model).call(prompt.capture());
        String sourceData = prompt.getValue().getUserMessage().getText();
        assertTrue(sourceData.contains(fullAnswer));
        assertFalse(sourceData.contains("截断摘要"));
        assertFalse(sourceData.contains("note"));
        assertFalse(sourceData.contains("file"));
        assertTrue(prompt.getValue().getSystemMessage().getText().contains("不能强行统一"));
        var saved = ArgumentCaptor.forClass(TileDO.class);
        verify(tiles).insert(saved.capture());
        assertEquals("融合问题", saved.getValue().getUserMessage());
        assertEquals(2, saved.getValue().getWeight());
        var chat = ArgumentCaptor.forClass(TileMessageDO.class);
        verify(messages, times(2)).insert(chat.capture());
        assertEquals(List.of("user", "assistant"), chat.getAllValues().stream().map(TileMessageDO::getRole).toList());
        assertEquals(List.of("融合问题", "融合回答"), chat.getAllValues().stream().map(TileMessageDO::getContent).toList());
        verify(edges, times(2)).insert(any(TileEdgeDO.class));
        verify(tiles, never()).updateById(any(TileDO.class));
        verify(tiles, never()).delete(any());
    }

    @ParameterizedTest @ValueSource(strings = {
        "[\"a\",\"a\"]", "[\"note\",\"file\"]", "[\"a\",\"note\",\"file\"]", "[\"a\",\"missing\"]"
    })
    void fewerThanTwoDistinctQaOrMissingSourceDoesNotCallModel(String ids) throws Exception {
        mvc.perform(post("/customer-service/tile/fusion").contentType(MediaType.APPLICATION_JSON)
                .content("{\"tileId\":\"fused\",\"sourceTileIds\":" + ids + "}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.success").value(false));
        verifyNoInteractions(model);
        verify(tiles, never()).insert(any(TileDO.class));
        verifyNoInteractions(edges);
    }

    @ParameterizedTest @ValueSource(strings = {
        "{}", "{\"userMessage\":\" \",\"answer\":\"回答\"}", "{\"userMessage\":\"问题\"}",
        "{\"userMessage\":123,\"answer\":\"回答\"}", "不是 JSON"
    })
    void invalidModelOutputDoesNotCreatePartialTile(String json) throws Exception {
        when(model.call(any(Prompt.class))).thenReturn(reply(json));
        mvc.perform(post("/customer-service/tile/fusion").contentType(MediaType.APPLICATION_JSON)
                .content("{\"tileId\":\"fused\",\"sourceTileIds\":[\"a\",\"b\"]}"))
                .andExpect(status().isInternalServerError()).andExpect(jsonPath("$.success").value(false));
        verify(tiles, never()).insert(any(TileDO.class));
        verify(messages, never()).insert(any(TileMessageDO.class));
        verifyNoInteractions(edges);
    }

    @Test void sourceChangesDuringGenerationPreventSavingStaleContent() {
        when(tiles.selectList(any())).thenReturn(List.of(qa("a", 1), qa("b", 2)), List.of(qa("a", 3), qa("b", 2)));
        var error = assertThrows(IllegalArgumentException.class,
                () -> service.fuse(new FuseTilesReqVO("fused", List.of("a", "b"))));
        assertTrue(error.getMessage().contains("已发生变化"));
        verify(tiles, never()).insert(any(TileDO.class));
    }

    @Test void modelFailureLeavesSourcesAndWorkspaceUnchanged() {
        when(model.call(any(Prompt.class))).thenThrow(new IllegalStateException("secret credential"));
        var error = assertThrows(IllegalStateException.class,
                () -> service.fuse(new FuseTilesReqVO("fused", List.of("a", "b"))));
        assertFalse(error.getMessage().contains("secret"));
        verify(tiles, never()).insert(any(TileDO.class));
        verify(messages, never()).insert(any(TileMessageDO.class));
        verifyNoInteractions(edges);
    }

    @Test void incompleteQaIsRejectedBeforeCallingModel() {
        var incomplete = qa("b", 3);
        incomplete.setAnswerSummary(null);
        when(tiles.selectList(any())).thenReturn(List.of(qa("a", 1), incomplete));
        when(messages.selectList(any())).thenReturn(List.of());
        assertThrows(IllegalArgumentException.class, () -> service.fuse(new FuseTilesReqVO("fused", List.of("a", "b"))));
        verifyNoInteractions(model);
    }

    @Test void supportsLegacyQaAndFencedJsonAndPersistsEntireFusedAnswer() {
        var legacy = qa("a", 3);
        legacy.setTileType(null);
        when(tiles.selectList(any())).thenReturn(List.of(legacy, qa("b", 1)));
        when(model.call(any(Prompt.class))).thenReturn(reply("```json\n{\"userMessage\":\"融合问题\",\"answer\":\"" + fullAnswer + "\"}\n```"));
        assertEquals(3, service.fuse(new FuseTilesReqVO("fused", List.of("a", "b"))).tile().getWeight());
        var chat = ArgumentCaptor.forClass(TileMessageDO.class);
        verify(messages, times(2)).insert(chat.capture());
        assertEquals(fullAnswer, chat.getAllValues().get(1).getContent());
    }

    @ParameterizedTest @ValueSource(strings = {
        "{\"tileId\":\"fused\",\"sourceTileIds\":null}",
        "{\"tileId\":\"fused\",\"sourceTileIds\":[\"a\"]}",
        "{\"tileId\":\"fused\",\"sourceTileIds\":[\"a\",\" \"]}",
        "{\"tileId\":\" \",\"sourceTileIds\":[\"a\",\"b\"]}"
    })
    void invalidRequestIsRejectedBeforeDatabaseAccess(String json) throws Exception {
        mvc.perform(post("/customer-service/tile/fusion").contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(tiles, messages, edges, model);
    }

    @Test void existingTargetIdDoesNotOverwriteAnExistingTile() {
        when(tiles.selectCount(any())).thenReturn(1L);
        assertThrows(IllegalArgumentException.class, () -> service.fuse(new FuseTilesReqVO("fused", List.of("a", "b"))));
        verifyNoInteractions(model);
        verify(tiles, never()).insert(any(TileDO.class));
    }
}
