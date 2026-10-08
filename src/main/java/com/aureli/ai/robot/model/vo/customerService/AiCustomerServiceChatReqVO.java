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
    @NotBlank(message = "请先创建或选择图谱")
    private String mapId;

    /**
     * 兼容旧版父 Tile ID。为空表示从画布空白处提问，不共享任何工作记忆。
     */
    private String parentTileId;

    /**
     * 显式选择的上下文来源 Tile。沿有向边向上追溯来源，不读取其子分支；无向边双向读取。
     */
    private List<String> relatedTileIds;

    /**
     * 从所选来源继续追溯的最大边数。0 表示只读取直接选择的 Tile。
     */
    private Integer memoryDepth;

    /**
     * 边方向：DIRECTED / UNDIRECTED。
     */
    private String edgeDirection;

    /**
     * 兼容旧客户端的字段，值不参与保存；普通关系由方向固定为 EXTENDS 或 RELATES。
     * FUSES / DEVIDES 只能通过专用融合 / 拆分接口创建。
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
