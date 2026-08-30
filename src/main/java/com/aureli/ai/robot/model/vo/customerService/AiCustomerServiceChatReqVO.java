package com.aureli.ai.robot.model.vo.customerService;

import jakarta.validation.constraints.NotBlank;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * @Author: 犬小哈
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
     * 父 Tile ID。为空表示从画布空白处提问，不共享任何工作记忆。
     */
    private String parentTileId;

}
