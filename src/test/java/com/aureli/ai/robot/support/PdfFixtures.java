package com.aureli.ai.robot.support;

import org.apache.pdfbox.cos.COSName;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDStream;
import org.apache.pdfbox.pdmodel.encryption.AccessPermission;
import org.apache.pdfbox.pdmodel.encryption.StandardProtectionPolicy;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.pdmodel.graphics.image.LosslessFactory;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

/** Self-contained PDF fixtures; no installed fonts or external documents needed. */
public final class PdfFixtures {
    private PdfFixtures() {}

    public static final String TEXT = "测试正文\nFirst page bottom\nSecond page text";

    public static byte[] textAndImage() throws Exception {
        try (var document = new PDDocument()) {
            var font = new PDType1Font(Standard14Fonts.FontName.HELVETICA);
            var unicodeFont = new PDType1Font(Standard14Fonts.FontName.HELVETICA);
            // Glyph codes and the Unicode text are deliberately different, as in embedded CJK fonts.
            String cmap = """
                    /CIDInit /ProcSet findresource begin
                    12 dict begin
                    begincmap
                    /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
                    /CMapName /TestUnicode def
                    /CMapType 2 def
                    1 begincodespacerange
                    <00> <FF>
                    endcodespacerange
                    4 beginbfchar
                    <41> <6D4B>
                    <42> <8BD5>
                    <43> <6B63>
                    <44> <6587>
                    endbfchar
                    endcmap
                    CMapName currentdict /CMap defineresource pop
                    end
                    end
                    """;
            unicodeFont.getCOSObject().setItem(COSName.TO_UNICODE,
                    new PDStream(document, new ByteArrayInputStream(cmap.getBytes(StandardCharsets.US_ASCII))));
            var page = new PDPage();
            document.addPage(page);
            try (var content = new PDPageContentStream(document, page)) {
                // Write the lower line first to verify reading order uses position.
                writeLine(content, font, "First page bottom", 680);
                writeLine(content, unicodeFont, "ABCD", 720);
                content.drawImage(LosslessFactory.createFromImage(document, new BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB)), 50, 600, 30, 30);
                content.addRect(50, 550, 30, 30);
                content.stroke();
            }
            var secondPage = new PDPage();
            document.addPage(secondPage);
            try (var content = new PDPageContentStream(document, secondPage)) {
                writeLine(content, font, "Second page text", 720);
            }
            document.getDocumentInformation().setSubject("Metadata is not page text");
            return save(document);
        }
    }

    public static byte[] imageOnly() throws Exception {
        try (var document = new PDDocument()) {
            var page = new PDPage();
            document.addPage(page);
            try (var content = new PDPageContentStream(document, page)) {
                content.drawImage(LosslessFactory.createFromImage(document, new BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB)), 50, 600, 30, 30);
            }
            return save(document);
        }
    }

    public static byte[] encrypted(String userPassword) throws Exception {
        try (var document = new PDDocument()) {
            document.addPage(new PDPage());
            var permissions = new AccessPermission();
            permissions.setCanExtractContent(false);
            var policy = new StandardProtectionPolicy("owner-password", userPassword, permissions);
            policy.setEncryptionKeyLength(128);
            document.protect(policy);
            return save(document);
        }
    }

    private static void writeLine(PDPageContentStream content, PDType1Font font, String text, float y) throws Exception {
        content.beginText();
        content.setFont(font, 12);
        content.newLineAtOffset(50, y);
        content.showText(text);
        content.endText();
    }

    private static byte[] save(PDDocument document) throws Exception {
        var output = new ByteArrayOutputStream();
        document.save(output);
        return output.toByteArray();
    }
}
