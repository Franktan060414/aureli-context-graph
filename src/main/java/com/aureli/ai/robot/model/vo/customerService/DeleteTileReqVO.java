package com.aureli.ai.robot.model.vo.customerService;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** 删除单个 Tile 及其消息和关系。 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class DeleteTileReqVO {

    @NotBlank(message = "Tile ID 不能为空")
    private String tileId;
    @NotBlank(message = "请先创建或选择图谱")
    private String mapId;
}
