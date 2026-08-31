package com.aureli.ai.robot.model.vo.customerService;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

/**
 * @Date: 2026/8/23 17:08
 * @Version: v1.0.0
 * @Description: AI 智能客服聊天
 **/
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class AiCustomerServiceChatReqVO {

    @NotBlank(message = "用户消息不能为空")
    private String message;

    /**
     * 当前 Tile ID
     */
    @NotBlank(message = "Tile ID 不能为空")
    private String tileId;

    /**
     * 兼容旧版父 Tile ID。为空表示从画布空白处提问，不共享任何工作记忆。
     */
    private String parentTileId;

    /**
     * 相关 Tile ID 列表。新 Tile 会从这些相关 Tile 出发遍历图记忆。
     */
    private List<String> relatedTileIds;

    /**
     * 图记忆遍历深度。0 表示只读取直接相关 Tile。
     */
    private Integer memoryDepth;

    /**
     * 边方向：DIRECTED / UNDIRECTED。
     */
    private String edgeDirection;

    /**
     * 关系类型，例如 EXTENDS、RELATED、CONTRADICTS、SUPPORTS。
     */
    private String relationType;

    /**
     * 关系权重，范围 0 到 1。
     */
    private BigDecimal edgeWeight;

    /**
     * 关系说明。
     */
    private String edgeDescription;

}
