package com.aureli.ai.robot.support;

import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.wp.usermodel.HeaderFooterType;
import org.apache.poi.util.Units;
import org.apache.poi.xwpf.usermodel.Document;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.Base64;

public final class DocxFixtures {
    private DocxFixtures() {}
    public static final String TEXT = "正文标题\n第一段 中文 Ω 😀\n同段换行\t制表文本\n名称\t说明\n算法\t中文单元格\n末段链接正文";

    public static byte[] textAndTable() throws Exception {
        try (var document = new XWPFDocument(); var output = new ByteArrayOutputStream()) {
            document.createParagraph().createRun().setText("正文标题");
            var run = document.createParagraph().createRun();
            run.setText("第一段 中文 Ω 😀");
            run.addBreak();
            run.setText("同段换行");
            run.addTab();
            run.setText("制表文本");
            var table = document.createTable(2, 2);
            table.getRow(0).getCell(0).setText("名称");
            table.getRow(0).getCell(1).setText("说明");
            table.getRow(1).getCell(0).setText("算法");
            table.getRow(1).getCell(1).setText("中文单元格");
            var paragraph = document.createParagraph();
            paragraph.createRun().setText("末段");
            paragraph.createHyperlinkRun("https://example.invalid/").setText("链接正文");
            document.createHeader(HeaderFooterType.DEFAULT).createParagraph().createRun().setText("页眉不是正文");
            // A real embedded PNG exercises the image skip path without OCR.
            byte[] png = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=");
            document.createParagraph().createRun().addPicture(new ByteArrayInputStream(png), Document.PICTURE_TYPE_PNG,
                    "ignored.png", Units.toEMU(1), Units.toEMU(1));
            document.write(output);
            return output.toByteArray();
        }
    }

    public static byte[] emptyDocument() throws Exception {
        try (var document = new XWPFDocument(); var output = new ByteArrayOutputStream()) {
            document.createParagraph();
            document.write(output);
            return output.toByteArray();
        }
    }
}
