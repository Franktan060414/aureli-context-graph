package com.aureli.ai.robot.reader;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.poi.xwpf.usermodel.IBodyElement;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFTable;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.List;
import java.util.Locale;
import java.util.StringJoiner;

/** 提取图谱文件的纯文本正文，不解析图片、不执行 OCR。 */
@Component
public class TileFileContentReader {
    /**
     * DOCX 按正文顺序提取段落和表格，PDF 按页和文字位置提取文字。
     * 其他附件格式返回 null，仍可保存和下载；有效但没有文字的文档返回空字符串。
     * 损坏或加密的文档抛出异常。
     */
    public String extractContent(String fileName, byte[] fileData) throws IOException {
        if (fileName == null) return null;
        String name = fileName.toLowerCase(Locale.ROOT);
        if (name.endsWith(".pdf")) return readPdf(fileData);
        if (!name.endsWith(".docx")) return null;
        try (var document = new XWPFDocument(new ByteArrayInputStream(fileData))) {
            return readBody(document.getBodyElements()).strip();
        } catch (IOException | RuntimeException exception) {
            throw new IOException("DOCX 正文解析失败，请上传完整且未加密的 .docx 文件", exception);
        }
    }

    private String readPdf(byte[] fileData) throws IOException {
        try (var document = Loader.loadPDF(fileData)) {
            if (document.isEncrypted()) throw new IOException("不支持加密的 PDF");
            var stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);
            stripper.setLineSeparator("\n");
            stripper.setPageEnd("\n");
            return stripper.getText(document).strip();
        } catch (IOException | RuntimeException exception) {
            throw new IOException("PDF 文字解析失败，请上传完整且未加密的 .pdf 文件", exception);
        }
    }

    private String readBody(List<IBodyElement> elements) {
        var body = new StringJoiner("\n");
        for (IBodyElement element : elements) {
            if (element instanceof XWPFParagraph paragraph) {
                body.add(paragraph.getText());
            } else if (element instanceof XWPFTable table) {
                for (var row : table.getRows()) {
                    var cells = new StringJoiner("\t");
                    for (var cell : row.getTableCells()) cells.add(readBody(cell.getBodyElements()));
                    body.add(cells.toString());
                }
            }
        }
        return body.toString();
    }
}
