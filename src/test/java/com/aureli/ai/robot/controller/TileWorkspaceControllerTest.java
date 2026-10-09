package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.dos.TileDO;
import com.aureli.ai.robot.domain.dos.TileEdgeDO;
import com.aureli.ai.robot.domain.dos.TileMessageDO;
import com.aureli.ai.robot.domain.mapper.TileMapper;
import com.aureli.ai.robot.domain.mapper.TileEdgeMapper;
import com.aureli.ai.robot.domain.mapper.TileMessageMapper;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class TileWorkspaceControllerTest {
    @ParameterizedTest
    @ValueSource(ints = {1, 2, 3})
    void restoresFullLatestAnswerAndAssociatedParentsWithoutDuplicatingSources(int weight) {
        TileMapper tiles = mock(TileMapper.class);
        TileEdgeMapper edges = mock(TileEdgeMapper.class);
        TileMessageMapper messages = mock(TileMessageMapper.class);
        String fullAnswer = "完整回答，".repeat(100);
        when(tiles.selectList(any())).thenReturn(List.of(
                TileDO.builder().mapId("map-test").tileId("root").userMessage("独立问题").answerSummary("截断摘要").build(),
                TileDO.builder().mapId("map-test").tileId("child").userMessage("关联问题").answerSummary("摘要").weight(weight).build()));
        when(edges.selectList(any())).thenReturn(List.of(
                TileEdgeDO.builder().mapId("map-test").edgeId("one").sourceTileId("root").targetTileId("child")
                        .direction("UNDIRECTED").relationType("EXTENDS").build(),
                TileEdgeDO.builder().mapId("map-test").edgeId("two").sourceTileId("root").targetTileId("child")
                        .direction("DIRECTED").relationType("SUPPORTS").build(),
                TileEdgeDO.builder().mapId("map-test").edgeId("fusion").sourceTileId("root").targetTileId("child")
                        .direction("DIRECTED").relationType("FUSES").build(),
                TileEdgeDO.builder().mapId("map-test").edgeId("split").sourceTileId("root").targetTileId("child")
                        .direction("DIRECTED").relationType("DIVIDES").build()));
        when(messages.selectList(any())).thenReturn(List.of(
                TileMessageDO.builder().mapId("map-test").tileId("root").content("旧回答").build(),
                TileMessageDO.builder().mapId("map-test").tileId("root").content(fullAnswer).build()));
        var response = new TileWorkspaceController(tiles, edges, messages, new com.aureli.ai.robot.reader.TileFileContentReader(), mock(com.aureli.ai.robot.domain.mapper.LabelMapper.class)).workspace("map-test");
        assertEquals("no-store", response.getHeaders().getCacheControl());
        var data = response.getBody().getData();
        assertEquals(fullAnswer, data.tiles().get(0).answer());
        assertEquals("root", data.tiles().get(0).kind());
        assertEquals(List.of("root"), data.tiles().get(1).relatedTileIds());
        assertEquals("memory", data.tiles().get(1).kind());
        assertEquals("摘要", data.tiles().get(1).answer());
        assertEquals(1, data.tiles().get(0).weight());
        assertEquals(weight, data.tiles().get(1).weight());
        assertEquals("UNDIRECTED", data.edges().get(0).direction());
        assertEquals(List.of("RELATES", "EXTENDS", "FUSES", "DIVIDES"),
                data.edges().stream().map(TileWorkspaceController.Edge::relationType).toList());
    }
}
