package com.aureli.ai.robot.model.vo.customerService;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.UUID;

public record SplitTileReqVO(
        @NotBlank @Size(max = 128) String sourceTileId,
        @Size(max = 2000) String requirements,
        @NotBlank(message = "请先创建或选择图谱") @Size(max = 128) String mapId,
        @Size(max = 64) @Pattern(regexp = "[A-Za-z0-9-]+") String splitId) {
    public SplitTileReqVO(String sourceTileId, String requirements, String mapId) {
        this(sourceTileId, requirements, mapId, UUID.randomUUID().toString());
    }
}
