package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.dos.TileDO;
import com.aureli.ai.robot.domain.mapper.TileMapper;
import com.aureli.ai.robot.domain.mapper.TileEdgeMapper;
import com.aureli.ai.robot.domain.mapper.TileMessageMapper;
import com.aureli.ai.robot.model.vo.customerService.SaveTileNoteReqVO;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockMultipartFile;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class TileArtifactControllerTest {
    @org.junit.jupiter.api.BeforeAll
    static void initializeMapperMetadata() {
        var assistant = new org.apache.ibatis.builder.MapperBuilderAssistant(
                new com.baomidou.mybatisplus.core.MybatisConfiguration(), "artifact-test");
        com.baomidou.mybatisplus.core.metadata.TableInfoHelper.initTableInfo(assistant, TileDO.class);
        com.baomidou.mybatisplus.core.metadata.TableInfoHelper.initTableInfo(assistant, com.aureli.ai.robot.domain.dos.TileEdgeDO.class);
    }

    private final TileMapper tiles = mock(TileMapper.class);
    private final TileEdgeMapper edges = mock(TileEdgeMapper.class);
    private final TileMessageMapper messages = mock(TileMessageMapper.class);
    private final TileWorkspaceController controller = new TileWorkspaceController(tiles, edges, messages, new com.aureli.ai.robot.reader.TileFileContentReader(), mock(com.aureli.ai.robot.domain.mapper.LabelMapper.class));

    @Test
    void missingMapCannotReadOrWriteWorkspace() throws Exception {
        var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new com.aureli.ai.robot.exception.GlobalExceptionHandler()).build();
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/customer-service/tile/workspace"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.success").value(false))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.message").value("请先创建或选择图谱，并传入 mapId"));
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/customer-service/tile/note")
                .contentType("application/json").content("{\"tileId\":\"unassigned\",\"title\":\"便签\",\"content\":\"内容\"}"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.success").value(false));
        assertThrows(IllegalArgumentException.class, () -> controller.workspace(null));
        verifyNoInteractions(tiles, edges, messages);
    }

    @Test
    void noteIsSavedWithoutChatMessagesAndRestoredFromItsOwnContent() {
        String text = "便签正文\n".repeat(100);
        var result = controller.createNote(new SaveTileNoteReqVO("note-1", " 标题 ", text, null, "map-test"));
        assertEquals("NOTE", result.getData().tileType());
        assertEquals("标题", result.getData().message());
        assertEquals(text, result.getData().content());
        var captured = ArgumentCaptor.forClass(TileDO.class);
        verify(tiles).insert(captured.capture());
        assertEquals("NOTE", captured.getValue().getTileType());
        verifyNoInteractions(messages);
        when(tiles.selectList(any())).thenReturn(List.of(captured.getValue()));
        when(edges.selectList(any())).thenReturn(List.of());
        when(messages.selectList(any())).thenReturn(List.of());
        var restored = controller.workspace("map-test").getBody().getData().tiles().getFirst();
        assertEquals(text, restored.answer());
        assertEquals("note", restored.kind());
    }

    @Test
    void filePreservesBytesAndDownloadsAsAttachmentWithoutInlineExecution() throws Exception {
        byte[] bytes = com.aureli.ai.robot.support.DocxFixtures.textAndTable();
        var result = controller.uploadFile(new MockMultipartFile("file", "C:\\docs\\测试.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes), null, "map-test");
        var captured = ArgumentCaptor.forClass(TileDO.class);
        verify(tiles).insert(captured.capture());
        TileDO file = captured.getValue();
        assertEquals("测试.docx", result.getData().fileName());
        assertEquals("FILE", result.getData().tileType());
        assertEquals(com.aureli.ai.robot.support.DocxFixtures.TEXT, result.getData().content());
        assertEquals(com.aureli.ai.robot.support.DocxFixtures.TEXT, file.getContent());
        assertArrayEquals(bytes, file.getFileData());
        when(tiles.selectOne(any())).thenReturn(file);
        when(tiles.selectFileData("map-test", file.getTileId())).thenReturn(file);
        var download = controller.downloadFile(file.getTileId(), "map-test");
        assertArrayEquals(bytes, download.getBody());
        assertTrue(download.getHeaders().getFirst("Content-Disposition").startsWith("attachment;"));
        assertEquals("nosniff", download.getHeaders().getFirst("X-Content-Type-Options"));
        assertEquals("application/octet-stream", download.getHeaders().getContentType().toString());
        verifyNoInteractions(messages);
    }

    @Test
    void emptyAndOversizedFilesNeverInsertAnything() throws Exception {
        assertFalse(controller.uploadFile(new MockMultipartFile("file", "empty.docx", null, new byte[0]), null, "map-test").isSuccess());
        assertFalse(controller.uploadFile(new MockMultipartFile("file", "large.docx", null, new byte[10 * 1024 * 1024 + 1]), null, "map-test").isSuccess());
        verifyNoInteractions(tiles);
    }

    @Test
    void updateCannotOverwriteAnExistingQuestionOrFile() {
        when(tiles.update(isNull(), any())).thenReturn(0);
        assertFalse(controller.updateNote(new SaveTileNoteReqVO("qa-1", "title", "text", null, "map-test")).isSuccess());
        verify(tiles, never()).insert(any(TileDO.class));
        verify(tiles, never()).selectOne(any());
    }

    @Test
    void missingAttachmentReturns404() {
        assertEquals(404, controller.downloadFile("missing", "map-test").getStatusCode().value());
        verify(tiles, never()).selectFileData(anyString(), anyString());
    }

    @Test
    void multipartContextFieldsBindAndCreateOneEdgePerSelectedNode() throws Exception {
        when(tiles.selectList(any())).thenReturn(List.of(TileDO.builder().mapId("map-test").tileId("qa-parent").build(),
                TileDO.builder().mapId("map-test").tileId("note-parent").build()));
        when(edges.selectList(any())).thenReturn(List.of());
        var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(controller).build();
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart("/customer-service/tile/file")
                .param("mapId", "map-test").file(new MockMultipartFile("file", "test.docx", null, com.aureli.ai.robot.support.DocxFixtures.textAndTable()))
                .param("relatedTileIds", "qa-parent", "note-parent"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.data.relatedTileIds[0]").value("qa-parent"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.data.relatedTileIds[1]").value("note-parent"));
        verify(edges, times(2)).insert(any(com.aureli.ai.robot.domain.dos.TileEdgeDO.class));
    }

    @Test
    void nonexistentContextRejectsTheEntireCreation() {
        when(tiles.selectList(any())).thenReturn(List.of());
        assertThrows(RuntimeException.class, () -> controller.createNote(
                new SaveTileNoteReqVO("note", "title", "content", List.of("missing"), "map-test")));
        verify(tiles, never()).insert(any(TileDO.class));
        verifyNoInteractions(edges);
    }

    @Test
    void malformedDocxIsRejectedBeforeAnyNodeOrEdgeIsSaved() throws Exception {
        var result = controller.uploadFile(new MockMultipartFile("file", "broken.docx", null, new byte[]{80, 75}), List.of("parent"), "map-test");
        assertFalse(result.isSuccess());
        assertTrue(result.getMessage().contains("DOCX 正文解析失败"));
        verifyNoInteractions(tiles, edges, messages);
    }

    @Test
    void pdfUploadStoresTextAndLinksAndRestoresOriginalBytesForDownload() throws Exception {
        byte[] bytes = com.aureli.ai.robot.support.PdfFixtures.textAndImage();
        String text = com.aureli.ai.robot.support.PdfFixtures.TEXT;
        var parent = TileDO.builder().mapId("map-test").tileId("parent").tileType("NOTE").build();
        when(tiles.selectList(any())).thenReturn(List.of(parent));
        when(edges.selectList(any())).thenReturn(List.of());
        var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(controller).build();
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart("/customer-service/tile/file")
                .param("mapId", "map-test").file(new MockMultipartFile("file", "测试.PDF", "application/pdf", bytes))
                .param("relatedTileIds", "parent"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.success").value(true))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.data.content").value(text))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.data.relatedTileIds[0]").value("parent"));
        var captured = ArgumentCaptor.forClass(TileDO.class);
        verify(tiles).insert(captured.capture());
        TileDO pdf = captured.getValue();
        assertEquals(text, pdf.getContent());
        assertArrayEquals(bytes, pdf.getFileData());
        var link = ArgumentCaptor.forClass(com.aureli.ai.robot.domain.dos.TileEdgeDO.class);
        verify(edges).insert(link.capture());
        assertEquals(pdf.getTileId(), link.getValue().getTargetTileId());
        when(tiles.selectList(any())).thenReturn(List.of(pdf));
        when(edges.selectList(any())).thenReturn(List.of(link.getValue()));
        when(messages.selectList(any())).thenReturn(List.of());
        var restored = controller.workspace("map-test").getBody().getData().tiles().getFirst();
        assertEquals(text, restored.content());
        assertEquals("FILE", restored.tileType());
        assertEquals("测试.PDF", restored.fileName());
        assertEquals(List.of("parent"), restored.relatedTileIds());
        when(tiles.selectOne(any())).thenReturn(pdf);
        when(tiles.selectFileData("map-test", pdf.getTileId())).thenReturn(pdf);
        assertArrayEquals(bytes, controller.downloadFile(pdf.getTileId(), "map-test").getBody());
    }

    @Test
    void imageOnlyPdfSavesOriginalAttachmentWithEmptyContent() throws Exception {
        byte[] bytes = com.aureli.ai.robot.support.PdfFixtures.imageOnly();
        var result = controller.uploadFile(new MockMultipartFile("file", "scan.pdf", "application/pdf", bytes), null, "map-test");
        assertTrue(result.isSuccess());
        assertEquals("", result.getData().content());
        var captured = ArgumentCaptor.forClass(TileDO.class);
        verify(tiles).insert(captured.capture());
        assertArrayEquals(bytes, captured.getValue().getFileData());
    }

    @Test
    void damagedAndEncryptedPdfsAreRejectedBeforeAnyNodeOrEdgeIsSaved() throws Exception {
        for (byte[] bytes : List.of(new byte[]{37, 80, 68, 70}, com.aureli.ai.robot.support.PdfFixtures.encrypted("password"))) {
            var result = controller.uploadFile(new MockMultipartFile("file", "broken.pdf", "application/pdf", bytes), List.of("parent"), "map-test");
            assertFalse(result.isSuccess());
            assertTrue(result.getMessage().contains("PDF 文字解析失败"));
        }
        verifyNoInteractions(tiles, edges, messages);
    }

    @Test
    void unsupportedAttachmentStillSavesOriginalBinaryWithNoTextContent() throws Exception {
        var result = controller.uploadFile(new MockMultipartFile("file", "image.png", "image/png", new byte[]{0, -1}), null, "map-test");
        assertTrue(result.isSuccess());
        assertNull(result.getData().content());
        var captured = ArgumentCaptor.forClass(TileDO.class);
        verify(tiles).insert(captured.capture());
        assertArrayEquals(new byte[]{0, -1}, captured.getValue().getFileData());
    }
}
