package com.aureli.ai.robot.reader;

import com.aureli.ai.robot.support.DocxFixtures;
import com.aureli.ai.robot.support.PdfFixtures;
import org.junit.jupiter.api.Test;
import java.io.IOException;
import static org.junit.jupiter.api.Assertions.*;

class TileFileContentReaderTest {
    private final TileFileContentReader reader = new TileFileContentReader();

    @Test
    void extractsBodyParagraphsAndTablesInOrderWithUnicodeBreaksTabsAndHyperlinks() throws Exception {
        assertEquals(DocxFixtures.TEXT, reader.extractContent("测试.DOCX", DocxFixtures.textAndTable()));
    }

    @Test
    void emptyDocumentIsValidButHasNoExtractedText() throws Exception {
        assertEquals("", reader.extractContent("empty.docx", DocxFixtures.emptyDocument()));
    }

    @Test
    void damagedDocxProducesActionableErrorRatherThanBinaryGibberish() {
        var error = assertThrows(IOException.class, () -> reader.extractContent("damaged.docx", new byte[]{80, 75, 3, 4}));
        assertTrue(error.getMessage().contains("DOCX 正文解析失败"));
    }

    @Test
    void pdfExtractsUnicodeAcrossPagesInReadingOrderAndIgnoresImagesAndGraphics() throws Exception {
        assertEquals(PdfFixtures.TEXT, reader.extractContent("测试.PDF", PdfFixtures.textAndImage()));
    }

    @Test
    void imageOnlyPdfRemainsValidWithoutOcr() throws Exception {
        assertEquals("", reader.extractContent("scan.pdf", PdfFixtures.imageOnly()));
    }

    @Test
    void damagedAndEncryptedPdfsProduceActionableErrors() throws Exception {
        var error = assertThrows(IOException.class, () -> reader.extractContent("broken.pdf", new byte[]{37, 80, 68, 70}));
        assertTrue(error.getMessage().contains("PDF 文字解析失败"));
        for (String password : new String[]{"password", ""}) {
            byte[] bytes = PdfFixtures.encrypted(password);
            error = assertThrows(IOException.class, () -> reader.extractContent("locked.pdf", bytes));
            assertTrue(error.getMessage().contains("未加密"));
        }
    }

    @Test
    void otherAttachmentsRemainDownloadableWithoutTryingToDecodeTheirBytes() throws Exception {
        assertNull(reader.extractContent("image.png", new byte[]{0, -1}));
        assertNull(reader.extractContent("legacy.doc", new byte[]{0, -1}));
    }
}
