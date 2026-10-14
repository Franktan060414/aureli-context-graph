package com.aureli.ai.robot.advisor;

import com.aureli.ai.robot.domain.MemoryCategory;
import com.aureli.ai.robot.domain.dos.*;
import com.aureli.ai.robot.domain.mapper.*;
import com.aureli.ai.robot.prompt.CustomerServicePrompts;
import com.aureli.ai.robot.service.MemoryTokenBudget;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class GraphMemorySelectionTest {
    final TileMapper tiles = mock(TileMapper.class);
    final TileMessageMapper messages = mock(TileMessageMapper.class);
    final TileEdgeMapper edges = mock(TileEdgeMapper.class);
    final List<TileDO> nodes = new ArrayList<>();
    final List<TileMessageDO> history = new ArrayList<>();
    final List<TileEdgeDO> graph = new ArrayList<>();

    @BeforeEach void setup() {
        when(edges.selectRelatedEdgesBatch(eq("map-a"), anyCollection())).thenAnswer(call -> {
            Collection<String> ids = call.getArgument(1);
            return graph.stream().filter(edge -> ids.contains(edge.getTargetTileId())
                    || ids.contains(edge.getSourceTileId())).toList();
        });
        when(tiles.selectByTileIds(eq("map-a"), anyCollection())).thenAnswer(call -> {
            Collection<String> ids = call.getArgument(1);
            return nodes.stream().filter(tile -> ids.contains(tile.getTileId())).toList();
        });
        when(messages.selectByTileIds(eq("map-a"), anyCollection())).thenAnswer(call -> {
            Collection<String> ids = call.getArgument(1);
            return history.stream().filter(message -> ids.contains(message.getTileId())).toList();
        });
    }

    void node(String id, int weight, MemoryCategory category, String answer) {
        nodes.add(TileDO.builder().mapId("map-a").tileId(id).weight(weight).memoryCategory(category.name()).build());
        history.add(TileMessageDO.builder().mapId("map-a").tileId(id).role("user").content("QUESTION_" + id).build());
        history.add(TileMessageDO.builder().mapId("map-a").tileId(id).role("assistant").content(answer).build());
    }
    void edge(String source, String target) {
        graph.add(TileEdgeDO.builder().mapId("map-a").sourceTileId(source).targetTileId(target).direction("DIRECTED").build());
    }
    List<Message> read(List<String> selected, MemoryCategory category, int budget) {
        var result = new CustomChatMemoryAdvisor(messages, edges, tiles, selected, List.of(), "map-a", category, budget)
                .memoryMessages();
        assertTrue(MemoryTokenBudget.tokens(result) <= budget);
        return result;
    }
    String text(List<Message> memory) { return memory.stream().map(Message::getText).collect(java.util.stream.Collectors.joining("\n")); }
    int fullTokens(String... ids) {
        return (int) MemoryTokenBudget.tokens(history.stream().filter(message -> List.of(ids).contains(message.getTileId()))
                .map(message -> (Message)new UserMessage(CustomerServicePrompts.tileMemory(message.getTileId(), 1, message.getContent()))).toList());
    }

    @Test void smallGraphIncludesEveryReachableAncestorEvenBeyondThreeLayers() {
        for (int i = 1; i <= 7; i++) {
            node("n" + i, 1, MemoryCategory.UNKNOWN, "ANSWER_" + i);
            if (i > 1) edge("n" + i, "n" + (i - 1));
        }
        edge("n7", "sibling");
        node("sibling", 3, MemoryCategory.PROJECT_RULE, "PRIVATE_SIBLING");
        var memory = read(List.of("n1"), MemoryCategory.DISCUSSION, 8000);
        assertEquals(14, memory.size());
        assertTrue(text(memory).contains("ANSWER_7"));
        assertFalse(text(memory).contains("PRIVATE_SIBLING"));
        assertEquals(history.subList(0, 14).stream().map(TileMessageDO::getRole).toList(),
                memory.stream().map(message -> message.getMessageType().getValue()).toList());
    }

    @Test void categoryMatrixChangesSelectionAmongEquallyDistantOldTiles() {
        for (String id : List.of("root", "middle", "near")) node(id, 1, MemoryCategory.DISCUSSION, "short");
        edge("middle", "root"); edge("near", "middle");
        node("preference", 1, MemoryCategory.PREFERENCE, "PREFERENCE_DETAIL ".repeat(300));
        node("decision", 1, MemoryCategory.DECISION, "DECISION_DETAIL ".repeat(300));
        edge("preference", "near"); edge("decision", "near");
        int budget = fullTokens("root", "middle", "near") + 180;
        String preference = text(read(List.of("root"), MemoryCategory.PREFERENCE, budget));
        assertTrue(preference.contains("QUESTION_preference"));
        assertFalse(preference.contains("QUESTION_decision"));
        String discussion = text(read(List.of("root"), MemoryCategory.DISCUSSION, budget));
        assertTrue(discussion.contains("QUESTION_decision"));
        assertFalse(discussion.contains("QUESTION_preference"));
    }

    @Test void thirdLayerOutranksOldCriticalTileAndFourthLayerIsNotTreatedAsRecent() {
        node("root", 1, MemoryCategory.UNKNOWN, "short");
        node("second", 1, MemoryCategory.UNKNOWN, "short");
        node("third", 1, MemoryCategory.UNKNOWN, "THIRD_DETAIL ".repeat(500));
        node("fourth", 3, MemoryCategory.PROJECT_RULE, "CRITICAL_FOURTH");
        edge("second", "root"); edge("third", "second"); edge("fourth", "third");
        String output = text(read(List.of("root"), MemoryCategory.PROJECT_RULE,
                fullTokens("root", "second") + 180));
        assertTrue(output.contains("QUESTION_third"));
        assertFalse(output.contains("CRITICAL_FOURTH"));
    }

    @Test void multipleExplicitSourcesKeepTheirRolesAndGetFairExcerptsBeforeAncestors() {
        node("a", 1, MemoryCategory.UNKNOWN, "A_BODY ".repeat(1000));
        node("b", 1, MemoryCategory.UNKNOWN, "B_BODY ".repeat(1000));
        node("old", 3, MemoryCategory.PROJECT_RULE, "OLD_BODY"); edge("old", "a");
        var memory = read(List.of("b", "a", "a"), MemoryCategory.DISCUSSION, 600);
        String output = text(memory);
        assertTrue(output.contains("QUESTION_a")); assertTrue(output.contains("QUESTION_b"));
        assertTrue(output.contains("A_BODY")); assertTrue(output.contains("B_BODY"));
        assertTrue(output.contains("其余内容未读取"));
        assertEquals(List.of(MessageType.USER, MessageType.ASSISTANT, MessageType.USER, MessageType.ASSISTANT),
                memory.stream().map(Message::getMessageType).toList());
        assertFalse(output.contains("OLD_BODY"));
    }

    @Test void largeRelationDescriptionsAreBudgetedAndJsonEntriesAreNeverCut() {
        node("a", 1, MemoryCategory.UNKNOWN, "short"); node("b", 1, MemoryCategory.UNKNOWN, "short");
        var relation = TileEdgeDO.builder().mapId("map-a").sourceTileId("a").targetTileId("b")
                .direction("DIRECTED").description("huge description ".repeat(2000)).build();
        graph.add(relation);
        when(edges.selectWithinTileIds(eq("map-a"), anyCollection())).thenReturn(List.of(relation));
        var memory = read(List.of("a", "b"), MemoryCategory.UNKNOWN, 500);
        String output = text(memory);
        assertTrue(output.contains("QUESTION_a")); assertTrue(output.contains("QUESTION_b"));
        assertTrue(output.contains("部分关系"));
        String json = memory.getLast().getText().split("\n", 3)[1];
        assertDoesNotThrow(() -> tools.jackson.databind.json.JsonMapper.builder().build().readTree(json));
    }

    @Test void emptySelectionMakesNoDatabaseReadsAndTinyBudgetIsEnforced() {
        assertTrue(read(List.of(), MemoryCategory.UNKNOWN, 8000).isEmpty());
        verifyNoInteractions(tiles, messages, edges);
        node("a", 1, MemoryCategory.UNKNOWN, "some answer");
        assertTrue(read(List.of("a"), MemoryCategory.UNKNOWN, 1).isEmpty());
    }

    @Test void legacyQuestionAndAnswerPreviewAreIncludedButNotPresentedAsAFullAnswer() {
        nodes.add(TileDO.builder().mapId("map-a").tileId("legacy").userMessage("旧问题")
                .answerSummary("旧回答预览").build());
        var memory = read(List.of("legacy"), MemoryCategory.DISCUSSION, 8000);
        assertEquals(List.of(MessageType.USER, MessageType.ASSISTANT), memory.stream().map(Message::getMessageType).toList());
        assertTrue(text(memory).contains("旧问题"));
        assertTrue(text(memory).contains("旧回答预览"));
        assertTrue(text(memory).contains("数据库仅保留回答摘录"));
    }

    @Test void shortestReadablePathWinsEvenWhenALongerPathIsDiscoveredInTheSameGraph() {
        for (String id : List.of("root", "long1", "long2", "long3", "short"))
            node(id, 1, MemoryCategory.DISCUSSION, "short");
        edge("long1", "root"); edge("long2", "long1"); edge("long3", "long2");
        edge("short", "root");
        node("shared", 1, MemoryCategory.UNKNOWN, "SHARED_DETAIL ".repeat(300));
        edge("shared", "long3"); edge("shared", "short");
        node("far", 3, MemoryCategory.PROJECT_RULE, "FAR_DETAIL"); edge("far", "long3");
        String memory = text(read(List.of("root"), MemoryCategory.PROJECT_RULE,
                fullTokens("root", "long1", "short", "long2") + 180));
        assertTrue(memory.contains("QUESTION_shared"));
        assertFalse(memory.contains("FAR_DETAIL"));
    }

    @Test void foreignMapEdgesAreIgnoredAndUndirectedCyclesTerminate() {
        node("a", 1, MemoryCategory.UNKNOWN, "A"); node("b", 1, MemoryCategory.UNKNOWN, "B");
        graph.add(TileEdgeDO.builder().mapId("map-a").sourceTileId("b").targetTileId("a").direction("UNDIRECTED").build());
        graph.add(TileEdgeDO.builder().mapId("map-b").sourceTileId("foreign").targetTileId("b").direction("DIRECTED").build());
        var memory = read(List.of("a"), MemoryCategory.UNKNOWN, 8000);
        assertEquals(4, memory.size());
        verify(edges, times(2)).selectRelatedEdgesBatch(eq("map-a"), anyCollection());
        verify(tiles, never()).selectByTileIds(eq("map-b"), anyCollection());
    }
}
