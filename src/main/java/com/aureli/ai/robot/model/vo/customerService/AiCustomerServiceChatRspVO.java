package com.aureli.ai.robot.model.vo.customerService;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * @Date: 2026/8/30
 * @Version: v1.0.0
 * @Description: Tile 客服流式响应
 **/
@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class AiCustomerServiceChatRspVO {

    private String v;
    /** Terminal event emitted only after successful persistence. */
    private Boolean done;
    /** Public failure message; never contains upstream credentials. */
    private String error;

}
