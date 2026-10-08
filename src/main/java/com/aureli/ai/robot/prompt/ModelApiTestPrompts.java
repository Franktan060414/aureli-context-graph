package com.aureli.ai.robot.prompt;

import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.prompt.Prompt;

import java.util.List;

/** 模型 API 连通性测试使用的固定提示词。 */
public final class ModelApiTestPrompts {

    private static final String SYSTEM_PROMPT = """
            你正在响应一次 API 连接测试。
            请直接、简短地确认你已收到测试消息，不要调用工具，不要添加说明或 Markdown 格式。
            """;

    private static final String USER_PROMPT = "这是一条来自 Aureli 的 API 连接测试消息，请回复“连接成功”。";

    private ModelApiTestPrompts() {
    }

    public static Prompt connectionTest() {
        return new Prompt(List.of(new SystemMessage(SYSTEM_PROMPT), new UserMessage(USER_PROMPT)));
    }
}
