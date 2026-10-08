package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.dos.TileEdgeDO;
import com.aureli.ai.robot.domain.mapper.*;
import com.aureli.ai.robot.model.vo.customerService.FuseTilesReqVO;
import com.aureli.ai.robot.service.TileFusionService;
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

/** Real PostgreSQL persistence/rollback with a fixture model; owns and removes only its temporary IDs. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@EnabledIfSystemProperty(named = "aureli.fusion.integration", matches = "true")
class TileFusionPersistenceIntegrationTest {
    @Autowired TileMapper tiles;
    @Autowired TileMessageMapper messages;
    @Autowired TileEdgeMapper edges;
    @Autowired TileWorkspaceController workspace;
    @Autowired TransactionTemplate transactions;
    @Autowired JdbcTemplate jdbc;

    @Test void fusionRoundTripAndFailedEdgeSaveRollback() {
        String prefix = "fusion-check-" + UUID.randomUUID();
        List<String> ids = List.of(prefix + "-a", prefix + "-b", prefix + "-note", prefix + "-file", prefix + "-fused", prefix + "-failed");
        String answer = "完整融合回答，包含适用条件。".repeat(150);
        var settings = mock(ModelApiSettingsService.class);
        var model = mock(ChatModel.class);
        when(settings.chatModel()).thenReturn(model);
        when(model.call(any(Prompt.class))).thenReturn(new ChatResponse(List.of(new Generation(
                new AssistantMessage("{\"userMessage\":\"融合后的用户问题\",\"answer\":\"" + answer + "\"}")))));
        try {
            for (int i = 0; i < 4; i++) {
                jdbc.update("INSERT INTO t_tile (tile_id, tile_type, user_message, answer_summary, weight) VALUES (?, ?, ?, ?, ?)",
                        ids.get(i), i < 2 ? "QA" : i == 2 ? "NOTE" : "FILE", "来源问题 " + i, "来源摘要 " + i, i == 0 ? 1 : 3);
                if (i < 2) jdbc.update("INSERT INTO t_tile_message (tile_id, role, content) VALUES (?, 'assistant', ?)", ids.get(i), "来源完整回答 " + i);
            }
            var service = new TileFusionService(tiles, messages, edges, settings, transactions);
            var fused = service.fuse(new FuseTilesReqVO(ids.get(4), ids.subList(0, 4)));
            assertEquals(3, fused.tile().getWeight());
            assertEquals(2, fused.edges().size());
            var restored = workspace.workspace().getBody().getData().tiles().stream()
                    .filter(tile -> tile.id().equals(ids.get(4))).findFirst().orElseThrow();
            assertEquals("融合后的用户问题", restored.message());
            assertEquals(answer, restored.answer());
            assertEquals(ids.subList(0, 2), restored.relatedTileIds());
            assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile_message WHERE tile_id = ?", Integer.class, ids.get(4)));
            assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile_edge WHERE target_tile_id = ? AND relation_type = 'FUSES'", Integer.class, ids.get(4)));
            for (int i = 0; i < 4; i++) assertEquals("来源问题 " + i,
                    jdbc.queryForObject("SELECT user_message FROM t_tile WHERE tile_id = ?", String.class, ids.get(i)));

            // Force a late failure AFTER the node and both chat messages have been inserted.
            var brokenEdges = mock(TileEdgeMapper.class);
            doThrow(new IllegalStateException("fixture edge save failure")).when(brokenEdges).insert(any(TileEdgeDO.class));
            var failingService = new TileFusionService(tiles, messages, brokenEdges, settings, transactions);
            assertThrows(IllegalStateException.class, () -> failingService.fuse(new FuseTilesReqVO(ids.get(5), ids.subList(0, 2))));
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile WHERE tile_id = ?", Integer.class, ids.get(5)));
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile_message WHERE tile_id = ?", Integer.class, ids.get(5)));
        } finally {
            for (String id : ids) jdbc.update("DELETE FROM t_tile WHERE tile_id = ?", id);
        }
        for (String id : ids) assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile WHERE tile_id = ?", Integer.class, id));
    }
}
