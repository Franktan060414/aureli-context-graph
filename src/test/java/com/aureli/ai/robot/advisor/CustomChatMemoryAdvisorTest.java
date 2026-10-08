package com.aureli.ai.robot.advisor;

import com.aureli.ai.robot.domain.dos.TileEdgeDO;
import com.aureli.ai.robot.domain.dos.TileMessageDO;
import com.aureli.ai.robot.domain.dos.TileDO;
import com.aureli.ai.robot.domain.mapper.TileEdgeMapper;
import com.aureli.ai.robot.domain.mapper.TileMessageMapper;
import com.aureli.ai.robot.domain.mapper.TileMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.ai.chat.client.ChatClientRequest;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisorChain;
import org.springframework.ai.chat.messages.MessageType;
import org.springframework.ai.chat.prompt.Prompt;
import reactor.core.publisher.Flux;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** 验证真实消息注入边界：继承来源、隔离兄弟、保留显式双向关联。 */
class CustomChatMemoryAdvisorTest {

    private static final String ROOT = "tile-muwq95qd-edc470";
    private static final String ULCER = "tile-muwq9fac-71d88d";
    private static final String FOOD = "tile-muwq9o3x-8fffb7";

    private final TileEdgeMapper edges = mock(TileEdgeMapper.class);
    private final TileMessageMapper messages = mock(TileMessageMapper.class);
    private final TileMapper tiles = mock(TileMapper.class);
    private final StreamAdvisorChain chain = mock(StreamAdvisorChain.class);
    private final List<TileEdgeDO> graph = new ArrayList<>();
    private final List<TileMessageDO> history = new ArrayList<>();

    private void edge(String source, String target, String direction) {
        graph.add(TileEdgeDO.builder().sourceTileId(source).targetTileId(target)
                .direction(direction).relationType("EXTENDS").build());
    }

    private void history(String tileId, String question, String answer) {
        history.add(TileMessageDO.builder().tileId(tileId).role("user").content(question).build());
        history.add(TileMessageDO.builder().tileId(tileId).role("assistant").content(answer).build());
    }

    private void siblingGraph() {
        edge(ROOT, ULCER, "DIRECTED");
        edge(ROOT, FOOD, "DIRECTED");
        history(ROOT, "你好", "你好！我是 Aurelia。");
        history(ULCER, "我有溃疡", "之前讨论过溃疡。");
        history(FOOD, "你建议我吃些什么？", "之前讨论过饮食。");
    }

    private Prompt read(Collection<String> selected, int depth) {
        // 模拟 selectRelatedEdges 的真实语义：返回所有入边和出边，由 Advisor 判断可见方向。
        when(edges.selectRelatedEdges(anyString())).thenAnswer(call -> {
            String id = call.getArgument(0);
            return graph.stream().filter(edge -> Objects.equals(id, edge.getSourceTileId())
                    || Objects.equals(id, edge.getTargetTileId())).toList();
        });
        when(edges.selectWithinTileIds(anyCollection())).thenAnswer(call -> {
            Collection<String> ids = call.getArgument(0);
            return graph.stream().filter(edge -> ids.contains(edge.getSourceTileId())
                    && ids.contains(edge.getTargetTileId())).toList();
        });
        when(messages.selectByTileIds(anyCollection())).thenAnswer(call -> {
            Collection<String> ids = call.getArgument(0);
            return history.stream().filter(message -> ids.contains(message.getTileId())).toList();
        });
        when(chain.nextStream(any())).thenReturn(Flux.empty());

        var request = new ChatClientRequest(new Prompt("当前问题"), Map.of());
        new CustomChatMemoryAdvisor(messages, edges, tiles, selected, depth)
                .adviseStream(request, chain).collectList().block();

        var captured = ArgumentCaptor.forClass(ChatClientRequest.class);
        verify(chain).nextStream(captured.capture());
        Prompt prompt = captured.getValue().prompt();
        assertEquals("当前问题", prompt.getUserMessage().getText());
        return prompt;
    }

    private void assertScope(String... expected) {
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<String>> captured = ArgumentCaptor.forClass(Collection.class);
        verify(messages).selectByTileIds(captured.capture());
        assertEquals(Set.of(expected), Set.copyOf(captured.getValue()));
        assertEquals(expected.length, captured.getValue().size());
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 3, 100})
    void extendingCommonParentDoesNotReadEitherExistingChild(int depth) {
        siblingGraph();

        Prompt prompt = read(List.of(ROOT), depth);

        assertScope(ROOT);
        assertEquals(2, prompt.getUserMessages().size());
        assertTrue(prompt.getUserMessages().get(0).getText().endsWith("\n你好"));
        assertEquals(List.of(MessageType.USER, MessageType.ASSISTANT, MessageType.USER),
                prompt.getInstructions().stream().map(message -> message.getMessageType()).toList());
        assertFalse(prompt.getContents().contains("溃疡"));
        assertFalse(prompt.getContents().contains("饮食"));
        assertFalse(prompt.getContents().contains(ULCER));
        assertFalse(prompt.getContents().contains(FOOD));
    }

    @ParameterizedTest
    @ValueSource(strings = {ULCER, FOOD})
    void childInheritsParentWithoutReadingSiblingOrItsOwnDescendants(String selected) {
        siblingGraph();
        edge(selected, "grandchild", "DIRECTED");
        history("grandchild", "孙节点私有内容", "孙节点回答");

        Prompt prompt = read(List.of(selected), 3);

        assertScope(ROOT, selected);
        assertTrue(prompt.getContents().contains("你好！我是 Aurelia。"));
        assertFalse(prompt.getContents().contains("孙节点"));
        assertFalse(prompt.getContents().contains("grandchild"));
        assertFalse(prompt.getContents().contains(selected.equals(ULCER) ? FOOD : ULCER));
        assertFalse(prompt.getContents().contains(selected.equals(ULCER) ? "饮食" : "溃疡"));
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 1, 2, 3})
    void depthCountsAncestorEdgesStartingAtExplicitlySelectedNode(int depth) {
        edge("ancestor", "parent", "DIRECTED");
        edge("parent", "selected", "DIRECTED");

        read(List.of("selected"), depth);

        if (depth == 0) {
            assertScope("selected");
            verifyNoInteractions(edges);
        } else if (depth == 1) {
            assertScope("selected", "parent");
        } else {
            assertScope("selected", "parent", "ancestor");
        }
    }

    @Test
    void explicitlySelectingBothSiblingsSharesTheirHistoryAndDeduplicatesParent() {
        siblingGraph();

        Prompt prompt = read(List.of(ULCER, FOOD, ULCER), 3);

        assertScope(ROOT, ULCER, FOOD);
        assertTrue(prompt.getContents().contains("我有溃疡"));
        assertTrue(prompt.getContents().contains("你建议我吃些什么？"));
        assertEquals(1, prompt.getUserMessages().stream()
                .filter(message -> message.getText().endsWith("\n你好")).count());
    }

    @ParameterizedTest
    @ValueSource(strings = {"source", "target"})
    void explicitUndirectedRelationshipRemainsReadableFromEitherEndpoint(String selected) {
        edge("source", "target", "UNDIRECTED");
        edge("target", "private-child", "DIRECTED");

        read(List.of(selected), 3);

        assertScope("source", "target");
    }

    @Test
    void cyclicAncestorRelationshipsTerminateWithoutDuplicateMessages() {
        edge("a", "b", "DIRECTED");
        edge("b", "a", "DIRECTED");
        history("a", "问题 A", "回答 A");
        history("b", "问题 B", "回答 B");

        Prompt prompt = read(List.of("a"), 100);

        assertScope("a", "b");
        assertEquals(6, prompt.getInstructions().size());
        assertEquals(1, prompt.getUserMessages().stream()
                .filter(message -> message.getText().startsWith("【Tile 关系参考")).count());
        verify(edges).selectRelatedEdges("a");
        verify(edges).selectRelatedEdges("b");
    }

    @Test
    void mergedTileInheritsAllSelectedSourcesAndTheirAncestors() {
        siblingGraph();
        edge(ULCER, "merged", "DIRECTED");
        edge(FOOD, "merged", "DIRECTED");

        read(List.of("merged"), 3);

        assertScope("merged", ROOT, ULCER, FOOD);
    }

    @Test
    void blankSelectionDoesNotReadAnyOtherTile() {
        siblingGraph();

        Prompt prompt = read(List.of("", " "), 3);

        assertScope();
        verifyNoInteractions(edges);
        verifyNoInteractions(tiles);
        assertEquals(List.of("当前问题"), prompt.getInstructions().stream()
                .map(message -> message.getText()).collect(Collectors.toList()));
    }

    @Test
    void eachHistoricalMessageCarriesItsSourceWeightWithoutReorderingOrChangingCurrentQuestion() {
        history("normal", "普通问题", "普通回答");
        history("important", "重要问题", "重要回答");
        history("critical", "关键问题", "关键回答");
        when(tiles.selectByTileIds(anyCollection())).thenReturn(List.of(
                TileDO.builder().tileId("normal").weight(1).build(),
                TileDO.builder().tileId("important").weight(2).build(),
                TileDO.builder().tileId("critical").weight(3).build()));

        Prompt prompt = read(List.of("normal", "important", "critical"), 0);

        assertScope("normal", "important", "critical");
        var injected = prompt.getInstructions();
        String[] ids = {"normal", "important", "critical"};
        String[] labels = {"普通", "重要", "非常重要"};
        for (int i = 0; i < 6; i++) {
            assertEquals(i % 2 == 0 ? MessageType.USER : MessageType.ASSISTANT,
                    injected.get(i).getMessageType());
            assertTrue(injected.get(i).getText().contains("ID=" + ids[i / 2]));
            assertTrue(injected.get(i).getText().contains("权重=" + (i / 2 + 1) + "（" + labels[i / 2] + "）"));
            assertTrue(injected.get(i).getText().endsWith(history.get(i).getContent()));
        }
        verify(tiles).selectByTileIds(Set.of("normal", "important", "critical"));
        assertEquals("当前问题", injected.get(6).getText());
        assertEquals("普通问题", history.get(0).getContent());
    }

    @Test
    void missingOrNullWeightFallsBackToNormal() {
        history("missing", "旧问题", "旧回答");
        history("null-weight", "另一问题", "另一回答");
        when(tiles.selectByTileIds(anyCollection())).thenReturn(List.of(
                TileDO.builder().tileId("null-weight").weight(null).build()));

        Prompt prompt = read(List.of("missing", "null-weight"), 0);

        prompt.getInstructions().stream().limit(4).forEach(message ->
                assertTrue(message.getText().contains("权重=1（普通）")));
    }
    @Test
    void selectedNotesContributeTheirFullTextButUnparsedFilesAreNotReadAsText() {
        when(tiles.selectByTileIds(anyCollection())).thenReturn(List.of(
                TileDO.builder().tileId("note").tileType("NOTE").title("计划")
                        .content("周五完成草稿\n周六复核").weight(2).build(),
                TileDO.builder().tileId("file").tileType("FILE").fileName("draft.docx")
                        .fileData(new byte[]{80, 75}).build()));
        Prompt prompt = read(List.of("note", "file"), 0);
        assertTrue(prompt.getContents().contains("周五完成草稿\n周六复核"));
        assertTrue(prompt.getContents().contains("计划"));
        assertFalse(prompt.getContents().contains("draft.docx"));
        assertEquals(2, prompt.getUserMessages().size());
        verify(tiles, never()).selectFileData(anyString());
    }

    @Test
    void selectedTilesRetainAllRelationTypesAtZeroDepthWithoutReadingOutsideEndpoints() {
        history("a", "方案 A", "原始结论");
        history("b", "方案 B", "不同结论");
        graph.add(TileEdgeDO.builder().sourceTileId("a").targetTileId("b").direction("DIRECTED")
                .relationType("SUPPORTS").weight(new BigDecimal("0.8")).description("补充证据").build());
        graph.add(TileEdgeDO.builder().sourceTileId("a").targetTileId("b").direction("UNDIRECTED")
                .relationType("CONTRADICTS").weight(new BigDecimal("0.4")).description("存在分歧").build());
        edge("outside", "b", "DIRECTED");

        Prompt prompt = read(List.of("a", "b"), 0);

        assertScope("a", "b");
        verify(edges, never()).selectRelatedEdges(anyString());
        String relations = prompt.getUserMessages().get(2).getText();
        assertTrue(relations.contains("\"sourceTileId\":\"a\""));
        assertTrue(relations.contains("\"targetTileId\":\"b\""));
        assertTrue(relations.contains("\"relationType\":\"SUPPORTS\""));
        assertTrue(relations.contains("\"relationType\":\"CONTRADICTS\""));
        assertTrue(relations.contains("\"direction\":\"DIRECTED\""));
        assertTrue(relations.contains("\"direction\":\"UNDIRECTED\""));
        assertTrue(relations.contains("\"edgeWeight\":0.8"));
        assertTrue(relations.contains("补充证据"));
        assertTrue(relations.contains("存在分歧"));
        assertFalse(prompt.getContents().contains("outside"));
        assertEquals("方案 A", history.get(0).getContent());
    }

    @Test
    void boundaryEdgesAndCustomRelationNamesAreKeptWithoutExpandingTheMemoryScope() {
        edge("hidden", "parent", "DIRECTED");
        graph.add(TileEdgeDO.builder().sourceTileId("parent").targetTileId("selected").direction("DIRECTED")
                .relationType("用于比较").description("第二行\n包含 \"引用\"").build());

        Prompt prompt = read(List.of("selected"), 1);

        assertScope("selected", "parent");
        assertTrue(prompt.getContents().contains("\"relationType\":\"用于比较\""));
        assertTrue(prompt.getContents().contains("第二行\\n包含 \\\"引用\\\""));
        assertFalse(prompt.getContents().contains("hidden"));
    }


    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"研究.docx", "研究.pdf"})
    void selectedParsedDocumentContributesStoredBodyWithSourceAndWeightWithoutReadingBinary(String fileName) {
        String text = "第一段正文\n名称\t说明\n算法\t调度方法";
        when(tiles.selectByTileIds(anyCollection())).thenReturn(List.of(
                TileDO.builder().tileId("file").tileType("FILE").fileName(fileName)
                        .content(text).weight(3).fileData(new byte[]{80, 75}).build()));
        Prompt prompt = read(List.of("file"), 0);
        assertScope("file");
        assertEquals(2, prompt.getInstructions().size());
        var document = prompt.getInstructions().getFirst();
        assertEquals(MessageType.USER, document.getMessageType());
        assertTrue(document.getText().contains("ID=file"));
        assertTrue(document.getText().contains("权重=3"));
        assertTrue(document.getText().endsWith("文件正文：" + fileName + "\n" + text));
        assertEquals("当前问题", prompt.getInstructions().getLast().getText());
        verify(tiles, never()).selectFileData(anyString());
    }

    @Test
    void parsedFileAncestorIsReadThroughTheSelectedNoteWithoutReadingOtherFiles() {
        edge("document", "note", "DIRECTED");
        edge("document", "other-file", "DIRECTED");
        when(tiles.selectByTileIds(anyCollection())).thenAnswer(call -> {
            Collection<String> ids = call.getArgument(0);
            return List.of(
                    TileDO.builder().tileId("document").tileType("FILE").fileName("来源.docx").content("来源文档正文").build(),
                    TileDO.builder().tileId("note").tileType("NOTE").title("摘记").content("关联便签正文").build(),
                    TileDO.builder().tileId("other-file").tileType("FILE").fileName("其他.docx").content("其他文件不应读入").build())
                    .stream().filter(tile -> ids.contains(tile.getTileId())).toList();
        });
        Prompt prompt = read(List.of("note"), 1);
        assertScope("note", "document");
        assertTrue(prompt.getContents().contains("来源文档正文"));
        assertTrue(prompt.getContents().contains("关联便签正文"));
        assertFalse(prompt.getContents().contains("其他文件不应读入"));
        verify(tiles, never()).selectFileData(anyString());
    }
}
