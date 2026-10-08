package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.model.vo.customerService.SaveTileNoteReqVO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import java.util.ArrayList;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

/** Opt-in PostgreSQL round-trip; cleans only the nodes owned by this test. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@EnabledIfSystemProperty(named = "aureli.artifacts.integration", matches = "true")
class TileArtifactPersistenceIntegrationTest {
    @Autowired TileWorkspaceController controller;
    @Autowired JdbcTemplate jdbc;

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"docx", "pdf"})
    void notesAndBinaryAttachmentsPersistWithoutCreatingChatOrKnowledgeRecords(String format) throws Exception {
        String noteId = "artifact-check-" + UUID.randomUUID();
        var owned = new ArrayList<String>();
        boolean pdf = "pdf".equals(format);
        byte[] bytes = pdf ? com.aureli.ai.robot.support.PdfFixtures.textAndImage()
                : com.aureli.ai.robot.support.DocxFixtures.textAndTable();
        String text = pdf ? com.aureli.ai.robot.support.PdfFixtures.TEXT : com.aureli.ai.robot.support.DocxFixtures.TEXT;
        try {
            owned.add(noteId);
            assertTrue(controller.createNote(new SaveTileNoteReqVO(noteId, "测试便签", "第一行\n第二行")).isSuccess());
            assertTrue(controller.updateNote(new SaveTileNoteReqVO(noteId, "新标题", "更新正文")).isSuccess());
            var file = controller.uploadFile(new MockMultipartFile("file", "附件." + format,
                    pdf ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes), null).getData();
            owned.add(file.id());
            assertEquals(text, jdbc.queryForObject("SELECT content FROM t_tile WHERE tile_id = ?", String.class, file.id()));
            assertArrayEquals(bytes, jdbc.queryForObject("SELECT file_data FROM t_tile WHERE tile_id = ?", byte[].class, file.id()));
            // Verifies the real MyBatis mapping rather than a mocked download.
            assertArrayEquals(bytes, controller.downloadFile(file.id()).getBody());
            var snapshot = controller.workspace().getBody().getData();
            var note = snapshot.tiles().stream().filter(n -> n.id().equals(noteId)).findFirst().orElseThrow();
            assertEquals("NOTE", note.tileType());
            assertEquals("新标题", note.message());
            assertEquals("更新正文", note.content());
            var restoredFile = snapshot.tiles().stream().filter(n -> n.id().equals(file.id())).findFirst().orElseThrow();
            assertEquals("FILE", restoredFile.tileType());
            assertEquals(text, restoredFile.content());
            for (String id : owned) assertEquals(0, jdbc.queryForObject(
                    "SELECT COUNT(*) FROM t_tile_message WHERE tile_id = ?", Integer.class, id));
        } finally {
            for (String id : owned) jdbc.update("DELETE FROM t_tile WHERE tile_id = ?", id);
        }
        for (String id : owned) assertEquals(0, jdbc.queryForObject(
                "SELECT COUNT(*) FROM t_tile WHERE tile_id = ?", Integer.class, id));
    }

    @Test
    void artifactLinksPersistAndEditingParentsPreservesMetadataAndOutgoingLinks() throws Exception {
        String prefix = "context-check-" + UUID.randomUUID();
        var owned = new ArrayList<String>();
        try {
            String parentA = prefix + "-a", parentB = prefix + "-b", noteId = prefix + "-note";
            owned.addAll(java.util.List.of(parentA, parentB, noteId));
            for (String id : java.util.List.of(parentA, parentB))
                assertTrue(controller.createNote(new SaveTileNoteReqVO(id, "关联来源", "上下文")).isSuccess());
            var note = controller.createNote(new SaveTileNoteReqVO(noteId, "关联便签", "正文",
                    java.util.List.of(parentA, " " + parentA + " ", parentB))).getData();
            assertEquals(java.util.List.of(parentA, parentB), note.relatedTileIds());
            assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile_edge WHERE target_tile_id = ?", Integer.class, noteId));
            jdbc.update("UPDATE t_tile_edge SET direction = 'UNDIRECTED', weight = 0.7, description = '保留备注' WHERE source_tile_id = ? AND target_tile_id = ?", parentA, noteId);
            var file = controller.uploadFile(new MockMultipartFile("file", "关联附件.docx", null, com.aureli.ai.robot.support.DocxFixtures.textAndTable()),
                    java.util.List.of(noteId)).getData();
            owned.add(file.id());
            var changed = controller.updateNote(new SaveTileNoteReqVO(noteId, "更新标题", "更新正文", java.util.List.of(parentA))).getData();
            assertEquals(java.util.List.of(parentA), changed.relatedTileIds());
            assertEquals("保留备注", jdbc.queryForObject("SELECT description FROM t_tile_edge WHERE source_tile_id = ? AND target_tile_id = ?", String.class, parentA, noteId));
            assertEquals("UNDIRECTED", jdbc.queryForObject("SELECT direction FROM t_tile_edge WHERE source_tile_id = ? AND target_tile_id = ?", String.class, parentA, noteId));
            assertThrows(RuntimeException.class, () -> controller.updateNote(new SaveTileNoteReqVO(noteId, "不可保存", "不可保存", java.util.List.of(prefix + "-missing"))));
            assertEquals("更新标题", jdbc.queryForObject("SELECT title FROM t_tile WHERE tile_id = ?", String.class, noteId));
            assertThrows(RuntimeException.class, () -> controller.updateNote(new SaveTileNoteReqVO(noteId, "自身", "正文", java.util.List.of(noteId))));
            // Older callers omit the field; that must preserve the current links.
            controller.updateNote(new SaveTileNoteReqVO(noteId, "旧接口更新", "正文"));
            var snapshot = controller.workspace().getBody().getData();
            assertEquals(java.util.List.of(parentA), snapshot.tiles().stream().filter(n -> n.id().equals(noteId)).findFirst().orElseThrow().relatedTileIds());
            assertEquals(java.util.List.of(noteId), snapshot.tiles().stream().filter(n -> n.id().equals(file.id())).findFirst().orElseThrow().relatedTileIds());
            controller.updateNote(new SaveTileNoteReqVO(noteId, "清空关联", "正文", java.util.List.of()));
            assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile_edge WHERE target_tile_id = ?", Integer.class, noteId));
            assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM t_tile_edge WHERE source_tile_id = ? AND target_tile_id = ?", Integer.class, noteId, file.id()));
        } finally {
            for (String id : owned) jdbc.update("DELETE FROM t_tile WHERE tile_id = ?", id);
        }
    }
}
