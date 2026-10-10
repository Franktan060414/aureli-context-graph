package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.dos.*;
import com.aureli.ai.robot.domain.mapper.*;
import com.aureli.ai.robot.model.vo.customerService.AiCustomerServiceChatReqVO;
import com.aureli.ai.robot.service.*;
import com.aureli.ai.robot.service.model.ModelApiSettingsService;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.*;
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

class TileQuestionPlanControllerTest {
    TileMapper tiles;
    TileMessageMapper messages;
    TileEdgeMapper edges;
    MapMapper maps;
    ChatModel model;
    TileQuestionAnswerGenerator generator;
    TileQuestionPlanService service;
    MockMvc mvc;
    final String proposed = "{\"suggested\":true,\"reason\":\"建模与改进可以独立研究\",\"questions\":[\"如何建模？\",\"如何改进算法？\"]}";
    AiCustomerServiceChatReqVO request() {
        return AiCustomerServiceChatReqVO.builder().mapId("map-a").tileId("root-new")
                .message("如何建模，以及如何改进算法？请保留现有接口。")
                .relatedTileIds(List.of()).memoryDepth(3).build();
    }
    ChatResponse reply(String text) { return new ChatResponse(List.of(new Generation(new AssistantMessage(text)))); }
    @BeforeEach void setUp() {
        for (Class<?> type : List.of(TileDO.class, TileMessageDO.class, TileEdgeDO.class, MapDO.class))
            TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), type);
        tiles = mock(TileMapper.class); messages = mock(TileMessageMapper.class); edges = mock(TileEdgeMapper.class);
        maps = mock(MapMapper.class); model = mock(ChatModel.class); generator = mock(TileQuestionAnswerGenerator.class);
        var settings = mock(ModelApiSettingsService.class); when(settings.chatModel()).thenReturn(model);
        var tx = mock(TransactionTemplate.class);
        when(tx.execute(any())).thenAnswer(call -> ((TransactionCallback<?>) call.getArgument(0)).doInTransaction(new SimpleTransactionStatus()));
        service = new TileQuestionPlanService(tiles, messages, edges, maps, settings, generator, tx);
        mvc = MockMvcBuilders.standaloneSetup(new TileQuestionPlanController(service)).build();
        when(maps.selectCount(any())).thenReturn(1L);
        when(model.call(any(Prompt.class))).thenReturn(reply(proposed));
        when(generator.answer(anyString(), anyList())).thenAnswer(call -> "完整回答：" + call.getArgument(0));
    }
    void noWrites() {
        verify(tiles, never()).insert(any(TileDO.class));
        verify(messages, never()).insert(any(TileMessageDO.class));
        verify(edges, never()).insert(any(TileEdgeDO.class));
    }
    @Test void planningCreatesNoTilesAnswersOrRelations() throws Exception {
        mvc.perform(post("/customer-service/tile/question/plan").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"map-a\",\"tileId\":\"root-new\",\"message\":\"如何建模并改进算法？\"}"))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.suggested").value(true))
                .andExpect(jsonPath("$.data.questions[0]").value("如何建模？"))
                .andExpect(jsonPath("$.data.planId").isNotEmpty());
        verifyNoInteractions(generator, messages, edges);
        noWrites();
    }
    @Test void simpleQuestionHasNoConfirmationPlan() {
        when(model.call(any(Prompt.class))).thenReturn(reply("{\"suggested\":false,\"reason\":\"单一概念\",\"questions\":[]}"));
        var proposal = service.prepare(request());
        assertFalse(proposal.suggested()); assertNull(proposal.planId()); assertTrue(proposal.questions().isEmpty());
        verifyNoInteractions(generator); noWrites();
    }
    @ParameterizedTest @ValueSource(strings = {"CANCEL", "DECLINE"})
    void cancelledAndDeclinedPlansCannotGenerateChildren(String action) {
        String id = service.prepare(request()).planId();
        assertNull(service.decide("map-a", id, action));
        assertNull(service.decide("map-a", id, action));
        assertThrows(TileQuestionPlanService.PlanException.class, () -> service.decide("map-a", id, "EXECUTE"));
        verifyNoInteractions(generator); noWrites();
    }
    @Test void confirmedPlanIsFrozenAndDuplicateExecutionReturnsSameResult() {
        var proposal = service.prepare(request());
        var result = service.decide("map-a", proposal.planId(), "EXECUTE");
        assertSame(result, service.decide("map-a", proposal.planId(), "EXECUTE"));
        assertEquals(List.of(request().getMessage(), "如何建模？", "如何改进算法？"), result.tiles().stream().map(TileWorkspaceController.Node::message).toList());
        assertEquals(3, result.tiles().size()); assertEquals(2, result.edges().size());
        assertTrue(result.edges().stream().allMatch(edge -> edge.relationType().equals("DIVIDES") && edge.sourceTileId().equals("root-new")));
        assertEquals(List.of("root-new"), result.tiles().get(1).relatedTileIds());
        verify(model, times(1)).call(any(Prompt.class));
        verify(generator, times(3)).answer(anyString(), anyList());
        verify(tiles, times(3)).insert(any(TileDO.class)); verify(messages, times(6)).insert(any(TileMessageDO.class));
        var context = ArgumentCaptor.forClass(List.class);
        verify(generator).answer(eq("如何建模？"), context.capture());
        assertTrue(context.getValue().toString().contains("请保留现有接口"));
        assertTrue(context.getValue().toString().contains("完整回答"));
    }
    @Test void failedChildLeavesNoNodesAndCanRetryTheSamePlan() {
        String id = service.prepare(request()).planId();
        when(generator.answer(eq("如何改进算法？"), anyList())).thenThrow(new IllegalStateException("offline"));
        assertThrows(IllegalStateException.class, () -> service.decide("map-a", id, "EXECUTE"));
        noWrites();
        when(generator.answer(eq("如何改进算法？"), anyList())).thenReturn("改进方法");
        assertEquals(3, service.decide("map-a", id, "EXECUTE").tiles().size());
        verify(model, times(1)).call(any(Prompt.class));
    }
    @Test void emptyAnswerNeverReachesPersistence() {
        String id = service.prepare(request()).planId();
        when(generator.answer(eq("如何改进算法？"), anyList())).thenReturn(" ");
        assertThrows(IllegalStateException.class, () -> service.decide("map-a", id, "EXECUTE")); noWrites();
    }
    @ParameterizedTest @ValueSource(strings = {"{}", "null", "not-json", "{\"suggested\":true,\"reason\":\"理由\",\"questions\":[\"一个问题\"]}",
            "{\"suggested\":true,\"reason\":\"理由\",\"questions\":[\"问题\",\" 问题 \"]}",
            "{\"suggested\":false,\"reason\":\"理由\",\"questions\":[\"不该出现\"]}"})
    void invalidModelOutputIsNotAnApprovedPlan(String output) {
        when(model.call(any(Prompt.class))).thenReturn(reply(output));
        assertThrows(TileQuestionPlanService.PlanningUnavailable.class, () -> service.prepare(request()));
        verifyNoInteractions(generator); noWrites();
    }
    @Test void modelFailureIsSafeFallbackResponseWithoutLeakingCredentials() throws Exception {
        when(model.call(any(Prompt.class))).thenThrow(new IllegalStateException("secret API key"));
        mvc.perform(post("/customer-service/tile/question/plan").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"map-a\",\"tileId\":\"root-new\",\"message\":\"问题\"}"))
                .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.errorCode").value("QUESTION_PLANNING_UNAVAILABLE"))
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("secret")))); noWrites();
    }
    @Test void missingMapOrExistingRootStopsBeforeModel() {
        when(maps.selectCount(any())).thenReturn(0L);
        assertThrows(IllegalArgumentException.class, () -> service.prepare(request()));
        when(maps.selectCount(any())).thenReturn(1L); when(tiles.selectCount(any())).thenReturn(1L);
        assertThrows(TileQuestionPlanService.PlanException.class, () -> service.prepare(request()));
        verifyNoInteractions(model, generator); noWrites();
    }
    @Test void wrongMapExpiredPlanAndInvalidDecisionCannotExecute() throws Exception {
        String id = service.prepare(request()).planId();
        assertThrows(IllegalArgumentException.class, () -> service.decide("map-b", id, "EXECUTE"));
        assertThrows(TileQuestionPlanService.PlanException.class, () -> service.decide("map-a", "unknown", "EXECUTE"));
        mvc.perform(post("/customer-service/tile/question/decision").contentType(MediaType.APPLICATION_JSON)
                .content("{\"mapId\":\"map-a\",\"planId\":\"" + id + "\",\"action\":\"OTHER\"}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(generator); noWrites();
    }
    @Test void changedSelectedContextInvalidatesPlanAndPlanningUsesOnlyApprovedMemory() {
        var input = request(); input.setRelatedTileIds(List.of("chosen"));
        TileDO source = TileDO.builder().mapId("map-a").tileId("chosen").weight(2).userMessage("已选择问题").build();
        when(tiles.selectByTileIds(eq("map-a"), anyCollection())).thenReturn(List.of(source));
        when(messages.selectByTileIds(eq("map-a"), anyCollection())).thenReturn(List.of(TileMessageDO.builder()
                .tileId("chosen").role("assistant").content("选择的完整回答").build()));
        String id = service.prepare(input).planId();
        var prompt = ArgumentCaptor.forClass(Prompt.class); verify(model).call(prompt.capture());
        assertTrue(prompt.getValue().getUserMessage().getText().contains("选择的完整回答"));
        source.setWeight(3);
        assertThrows(TileQuestionPlanService.PlanException.class, () -> service.decide("map-a", id, "EXECUTE"));
        verifyNoInteractions(generator); noWrites();
    }
    @Test void contextChangedDuringGenerationPreventsAllWrites() {
        String id = service.prepare(request()).planId();
        when(generator.answer(eq("如何改进算法？"), anyList())).thenAnswer(call -> {
            when(maps.selectCount(any())).thenReturn(0L); return "回答";
        });
        assertThrows(IllegalArgumentException.class, () -> service.decide("map-a", id, "EXECUTE")); noWrites();
    }
}
