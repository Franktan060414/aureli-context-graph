package com.aureli.ai.robot.model.vo.customerService;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class UpdateTileWeightReqVO {
    @NotBlank(message = "Tile ID 不能为空")
    private String tileId;

    @NotNull(message = "权重不能为空")
    @Min(value = 1, message = "权重必须为 1、2 或 3")
    @Max(value = 3, message = "权重必须为 1、2 或 3")
    private Integer weight;
}
