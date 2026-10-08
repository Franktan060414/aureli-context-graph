package com.aureli.ai.robot.model.vo.customerService;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public record FuseTilesReqVO(
        @NotBlank @Size(max = 128) String tileId,
        @NotNull @Size(min = 2, max = 1000) List<@NotBlank @Size(max = 128) String> sourceTileIds,
        @NotBlank(message = "请先创建或选择图谱") @Size(max = 128) String mapId) {
    public FuseTilesReqVO(String tileId, List<String> sourceTileIds) { this(tileId, sourceTileIds, null); }
}
