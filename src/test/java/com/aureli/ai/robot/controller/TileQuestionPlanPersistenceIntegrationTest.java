package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.dos.TileEdgeDO;
import com.aureli.ai.robot.domain.mapper.*;
import com.aureli.ai.robot.model.vo.customerService.AiCustomerServiceChatReqVO;
import com.aureli.ai.robot.service.*;
import com.aureli.ai.robot.service.model.ModelApiSettingsService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.*;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.List;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@EnabledIfSystemProperty(named = "aureli.question-plan.integration", matches = "true")
class TileQuestionPlanPersistenceIntegrationTest {
    @Autowired TileMapper tiles;
    @Autowired TileMessageMapper messages;
    @Autowired TileEdgeMapper edges;
    @Autowired MapMapper maps;
    @Autowired TileWorkspaceController workspace;
    @Autowired TransactionTemplate transactions;
    @Autowired JdbcTemplate jdbc;

    @Test void approvalRoundTripCancelAndLateEdgeFailureRollBackWholeGroup() {
        String map = "plan-test-" + UUID.randomUUID();
        var settings = mock(ModelApiSettingsService.class);
        var model = mock(ChatModel.class);
        when(settings.chatModel()).thenReturn(model);
        when(model.call(any(Prompt.class))).thenReturn(new ChatResponse(List.of(new Generation(new AssistantMessage(
                "{\"suggested\":true,\"reason\":\"两个独立目标\",\"questions\":[\"如何建模？\",\"如何验证？\"]}")))));
        var generator = mock(TileQuestionAnswerGenerator.class);
        when(generator.answer(anyString(), anyList())).thenAnswer(call -> "完整回答：" + call.getArgument(0));
        var service = new TileQuestionPlanService(tiles, messages, edges, maps, settings, generator, transactions);
        jdbc.update("INSERT INTO t_map(map_id, name) VALUES (?, '自动建议测试')", map);
        try {
            var request = AiCustomerServiceChatReqVO.builder().mapId(map).tileId("plan-root-" + UUID.randomUUID())
                    .message("如何建模并验证？").relatedTileIds(List.of()).build();
            String cancelledId = service.prepare(request).planId();
            assertEquals(0, count("t_tile", map));
            service.decide(map, cancelledId, "CANCEL");
            assertThrows(TileQuestionPlanService.PlanException.class, () -> service.decide(map, cancelledId, "EXECUTE"));
            assertEquals(0, count("t_tile", map));
            verifyNoInteractions(generator);

            String id = service.prepare(request).planId();
            var result = service.decide(map, id, "EXECUTE");
            assertSame(result, service.decide(map, id, "EXECUTE"));
            var restored = workspace.workspace(map).getBody().getData();
            assertEquals(3, restored.tiles().size());
            assertEquals(6, count("t_tile_message", map));
            assertEquals(2, restored.edges().size());
            assertTrue(restored.edges().stream().allMatch(edge -> edge.relationType().equals("DIVIDES") && edge.sourceTileId().equals(request.getTileId())));
            for (var tile : result.tiles()) assertEquals(tile.answer(), restored.tiles().stream()
                    .filter(stored -> stored.id().equals(tile.id())).findFirst().orElseThrow().answer());
            verify(generator, times(3)).answer(anyString(), anyList());

            // 第二条子连线失败：原问题、两个子问题、全部消息和连线都必须回滚。
            var brokenEdges = mock(TileEdgeMapper.class);
            when(brokenEdges.insert(any(TileEdgeDO.class))).thenAnswer(call -> edges.insert((TileEdgeDO) call.getArgument(0)))
                    .thenThrow(new IllegalStateException("fixture failure on second edge"));
            var failing = new TileQuestionPlanService(tiles, messages, brokenEdges, maps, settings, generator, transactions);
            var retry = AiCustomerServiceChatReqVO.builder().mapId(map).tileId("plan-rollback-" + UUID.randomUUID())
                    .message("如何建模并验证？").relatedTileIds(List.of()).build();
            String failedId = failing.prepare(retry).planId();
            assertThrows(IllegalStateException.class, () -> failing.decide(map, failedId, "EXECUTE"));
            assertEquals(3, count("t_tile", map)); assertEquals(6, count("t_tile_message", map)); assertEquals(2, count("t_tile_edge", map));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM t_tile WHERE tile_id = ?", Integer.class, retry.getTileId()));
        } finally { jdbc.update("DELETE FROM t_map WHERE map_id = ?", map); }
    }
    int count(String table, String map) { return jdbc.queryForObject("SELECT count(*) FROM " + table + " WHERE map_id = ?", Integer.class, map); }
}
