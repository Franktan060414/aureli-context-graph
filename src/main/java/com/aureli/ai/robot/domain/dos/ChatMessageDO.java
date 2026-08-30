package com.aureli.ai.robot.domain.dos;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * @Date: 2026/8/20 18:30
 * @Version: v1.0.0
 * @Description: 聊天消息 DO 实体类
 **/
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@TableName("t_chat_message")
public class ChatMessageDO {

    @TableId(type = IdType.AUTO)
    private Long id;
    private String chatUuid;
    private String content;
    private String role;
    private LocalDateTime createTime;

}
