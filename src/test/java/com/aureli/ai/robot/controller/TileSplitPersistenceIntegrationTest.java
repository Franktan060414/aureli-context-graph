package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.dos.TileEdgeDO;
import com.aureli.ai.robot.domain.mapper.*;
import com.aureli.ai.robot.model.vo.customerService.SplitTileReqVO;
import com.aureli.ai.robot.service.TileSplitService;
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

/** 只创建和清理测试自有图谱，验证多子节点持久化与整体回滚。 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@EnabledIfSystemProperty(named = "aureli.split.integration", matches = "true")
class TileSplitPersistenceIntegrationTest {
    @Autowired TileMapper tiles;
    @Autowired TileMessageMapper messages;
    @Autowired TileEdgeMapper edges;
    @Autowired TileWorkspaceController workspace;
    @Autowired TransactionTemplate transactions;
    @Autowired JdbcTemplate jdbc;

    @Test void splitRoundTripRejectionIsolationAndLateFailureRollback() {
        String mapId = "split-test-map-" + UUID.randomUUID(), otherMap = "split-test-other-" + UUID.randomUUID();
        String source = "split-test-source-" + UUID.randomUUID();
        String fullAnswer = "完整回答，包含实施步骤与适用条件。".repeat(100);
        var settings = mock(ModelApiSettingsService.class);
        var model = mock(ChatModel.class);
        when(settings.chatModel()).thenReturn(model);
        String accepted = "{\"splittable\":true,\"reason\":\"两个方向可独立展开\"}";
        String generated = "{\"tiles\":[{\"userMessage\":\"核心目标是什么？\",\"answer\":\"" + fullAnswer
                + "\"},{\"userMessage\":\"实施步骤是什么？\",\"answer\":\"步骤和条件\"}]}";
        when(model.call(any(Prompt.class))).thenReturn(reply(accepted), reply(generated));
        jdbc.update("INSERT INTO t_map(map_id, name) VALUES (?, '拆分测试图谱'), (?, '隔离测试图谱')", mapId, otherMap);
        try {
            jdbc.update("INSERT INTO t_tile(map_id, tile_id, tile_type, user_message, answer_summary, weight) VALUES (?, ?, 'QA', '原始问题', '截断摘要', 2)", mapId, source);
            jdbc.update("INSERT INTO t_tile_message(map_id, tile_id, role, content) VALUES (?, ?, 'assistant', ?)", mapId, source, fullAnswer);
            var service = new TileSplitService(tiles, messages, edges, settings, transactions);
            assertThrows(IllegalArgumentException.class, () -> service.split(new SplitTileReqVO(source, null, otherMap)));
            verifyNoInteractions(model);

            var request = new SplitTileReqVO(source, "按方向细分", mapId);
            var result = service.split(request);
            clearInvocations(model);
            assertThrows(TileSplitService.AlreadySplitException.class, () -> service.split(request));
            verifyNoInteractions(model);
            var restored = workspace.workspace(mapId).getBody().getData();
            assertEquals(3, restored.tiles().size());
            for (var child : result.children()) {
                var node = restored.tiles().stream().filter(tile -> tile.id().equals(child.tile().getTileId())).findFirst().orElseThrow();
                assertEquals(child.answer(), node.answer());
                assertEquals(List.of(source), node.relatedTileIds());
                assertEquals(2, node.weight());
                assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile_message WHERE tile_id = ?", Integer.class, node.id()));
            }
            assertEquals(fullAnswer, restored.tiles().stream().filter(tile -> tile.id().equals(source)).findFirst().orElseThrow().answer());
            assertEquals(2, restored.edges().size());
            assertTrue(restored.edges().stream().allMatch(edge -> edge.relationType().equals("DIVIDES") && edge.sourceTileId().equals(source)));

            when(model.call(any(Prompt.class))).thenReturn(reply("{\"splittable\":false,\"reason\":\"没有进一步细分价值\"}"));
            assertThrows(TileSplitService.NotSplittableException.class, () -> service.split(new SplitTileReqVO(source, null, mapId)));
            assertEquals(3, count("t_tile", mapId));
            assertEquals(5, count("t_tile_message", mapId));
            assertEquals(2, count("t_tile_edge", mapId));

            // Fail on the SECOND child edge, after the first child was completely saved.
            when(model.call(any(Prompt.class))).thenReturn(reply(accepted), reply(generated));
            var brokenEdges = mock(TileEdgeMapper.class);
            when(brokenEdges.insert(any(TileEdgeDO.class))).thenAnswer(call -> edges.insert((TileEdgeDO) call.getArgument(0)))
                    .thenThrow(new IllegalStateException("fixture failure on second child"));
            var failing = new TileSplitService(tiles, messages, brokenEdges, settings, transactions);
            assertThrows(IllegalStateException.class, () -> failing.split(new SplitTileReqVO(source, null, mapId)));
            assertEquals(3, count("t_tile", mapId));
            assertEquals(5, count("t_tile_message", mapId));
            assertEquals(2, count("t_tile_edge", mapId));
            assertEquals(0, count("t_tile", otherMap));
        } finally {
            jdbc.update("DELETE FROM t_map WHERE map_id IN (?, ?)", mapId, otherMap);
        }
    }

    private int count(String table, String mapId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE map_id = ?", Integer.class, mapId);
    }

    @Test void legacySplitRelationsUpgradeWithoutChangingOrdinaryExtensions() throws Exception {
        String mapId = "split-upgrade-map-" + UUID.randomUUID();
        String source = "split-upgrade-source-" + UUID.randomUUID();
        String split = "tile-split-" + UUID.randomUUID() + "-0";
        String ordinary = "ordinary-child-" + UUID.randomUUID();
        String legacy = "legacy-child-" + UUID.randomUUID();
        jdbc.update("INSERT INTO t_map(map_id, name) VALUES (?, '拆分升级测试图谱')", mapId);
        try {
            for (String id : List.of(source, split, ordinary, legacy))
                jdbc.update("INSERT INTO t_tile(map_id, tile_id, tile_type, user_message, answer_summary) VALUES (?, ?, 'QA', '问题', '回答')", mapId, id);
            jdbc.update("INSERT INTO t_tile_edge(map_id, edge_id, source_tile_id, target_tile_id, direction, relation_type, description) VALUES (?, ?, ?, ?, 'DIRECTED', 'EXTENDS', '手动拆分：按步骤')", mapId, "edge-" + UUID.randomUUID(), source, split);
            jdbc.update("INSERT INTO t_tile_edge(map_id, edge_id, source_tile_id, target_tile_id, direction, relation_type, description) VALUES (?, ?, ?, ?, 'DIRECTED', 'EXTENDS', '手动拆分')", mapId, "edge-" + UUID.randomUUID(), source, ordinary);
            jdbc.update("INSERT INTO t_tile_edge(map_id, edge_id, source_tile_id, target_tile_id, direction, relation_type, description) VALUES (?, ?, ?, ?, 'DIRECTED', 'DEVIDES', '手动拆分')", mapId, "edge-" + UUID.randomUUID(), source, legacy);
            String schema = new org.springframework.core.io.ClassPathResource("schema.sql").getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
            String upgrade = schema.substring(schema.indexOf("-- 拆分关系升级："), schema.indexOf("-- 拆分关系升级结束"));
            jdbc.execute(upgrade);
            jdbc.execute(upgrade);
            assertEquals("DIVIDES", jdbc.queryForObject("SELECT relation_type FROM t_tile_edge WHERE target_tile_id = ?", String.class, split));
            assertEquals("EXTENDS", jdbc.queryForObject("SELECT relation_type FROM t_tile_edge WHERE target_tile_id = ?", String.class, ordinary));
            assertEquals("DIVIDES", jdbc.queryForObject("SELECT relation_type FROM t_tile_edge WHERE target_tile_id = ?", String.class, legacy));
            var restored = workspace.workspace(mapId).getBody().getData();
            assertTrue(restored.edges().stream().anyMatch(edge -> edge.targetTileId().equals(split) && edge.relationType().equals("DIVIDES")));
        } finally {
            jdbc.update("DELETE FROM t_map WHERE map_id = ?", mapId);
        }
    }
    private ChatResponse reply(String text) {
        return new ChatResponse(List.of(new Generation(new AssistantMessage(text))));
    }
}
