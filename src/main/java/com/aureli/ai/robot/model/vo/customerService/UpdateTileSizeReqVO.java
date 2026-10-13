package com.aureli.ai.robot.model.vo.customerService;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

public record UpdateTileSizeReqVO(
        @NotBlank(message = "请先创建或选择图谱") String mapId,
        @NotBlank(message = "Tile ID 不能为空") String tileId,
        @Min(value = 200, message = "宽度不能小于 200") @Max(value = 4000, message = "宽度不能超过 4000") Integer width,
        @Min(value = 160, message = "高度不能小于 160") @Max(value = 4000, message = "高度不能超过 4000") Integer height) {}
