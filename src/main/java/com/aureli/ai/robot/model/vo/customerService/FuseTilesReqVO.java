package com.aureli.ai.robot.model.vo.customerService;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public record FuseTilesReqVO(
        @NotBlank @Size(max = 128) String tileId,
        @NotNull @Size(min = 2, max = 1000) List<@NotBlank @Size(max = 128) String> sourceTileIds) {
}
