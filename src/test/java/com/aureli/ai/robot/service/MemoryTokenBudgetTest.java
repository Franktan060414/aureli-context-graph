package com.aureli.ai.robot.service;

import com.aureli.ai.robot.prompt.CustomerServicePrompts;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.*;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class MemoryTokenBudgetTest {
    @Test void preservesSourceRoleAndUnicodeWhileEnforcingSmallBudgets() {
        Message original = new AssistantMessage(CustomerServicePrompts.tileMemory("unicode", 3,
                "中文 😀 emoji <|endoftext|> 条件：只能用于当前项目。".repeat(1000)));
        Message clipped = MemoryTokenBudget.excerpt(original, 150);
        assertNotNull(clipped);
        assertTrue(MemoryTokenBudget.tokens(clipped) <= 150);
        assertEquals(MessageType.ASSISTANT, clipped.getMessageType());
        assertTrue(clipped.getText().contains("ID=unicode"));
        assertTrue(clipped.getText().contains("其余内容未读取"));
        String text = clipped.getText();
        for (int i = 0; i < text.length(); i++) {
            if (Character.isHighSurrogate(text.charAt(i))) assertTrue(i + 1 < text.length() && Character.isLowSurrogate(text.charAt(++i)));
            else assertFalse(Character.isLowSurrogate(text.charAt(i)));
        }
        assertNull(MemoryTokenBudget.excerpt(original, 1));
    }
    @Test void fittingContentIsUnchangedAndRelationJsonIsNotSliced() {
        var shortMessage = new UserMessage("完整短内容");
        assertSame(shortMessage, MemoryTokenBudget.excerpt(shortMessage, 100));
        assertEquals(List.of(shortMessage), MemoryTokenBudget.fit(List.of(shortMessage), 100));
        var relation = new UserMessage("【Tile 关系参考：JSON】\n" + "long relation ".repeat(100));
        assertNull(MemoryTokenBudget.excerpt(relation, 30));
    }
}
