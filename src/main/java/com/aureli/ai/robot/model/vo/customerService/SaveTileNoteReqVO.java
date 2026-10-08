package com.aureli.ai.robot.model.vo.customerService;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;

public record SaveTileNoteReqVO(
        @NotBlank @Size(max = 128) String tileId,
        @NotBlank @Size(max = 255) String title,
        @NotBlank @Size(max = 100000) String content,
        @Size(max = 1000) List<@NotBlank @Size(max = 128) String> relatedTileIds) {
    public SaveTileNoteReqVO(String tileId, String title, String content) {
        this(tileId, title, content, null);
    }
}
