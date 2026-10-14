package com.aureli.ai.robot.service;

import com.aureli.ai.robot.domain.MemoryCategory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.*;
import org.springframework.ai.chat.prompt.Prompt;
import org.mockito.ArgumentCaptor;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MemoryClassificationServiceTest {
    final ChatModel model = mock(ChatModel.class);
    ChatResponse reply(String text) { return new ChatResponse(List.of(new Generation(new AssistantMessage(text)))); }

    @ParameterizedTest @EnumSource(MemoryCategory.class)
    void acceptsOnlyFixedCategoriesAndCallsModelOnce(MemoryCategory category) {
        when(model.call(any(Prompt.class))).thenReturn(reply(category.name()));
        assertEquals(category, new MemoryClassificationService().classify(model, "这个项目必须离线运行"));
        var prompt = ArgumentCaptor.forClass(Prompt.class);
        verify(model).call(prompt.capture());
        assertEquals("这个项目必须离线运行", prompt.getValue().getUserMessage().getText());
        assertEquals(16, prompt.getValue().getOptions().getMaxTokens());
        assertTrue(prompt.getValue().getContents().contains("询问、建议、假设不能当成规则"));
        verifyNoMoreInteractions(model);
    }

    @ParameterizedTest @NullAndEmptySource @ValueSource(strings = {" ", "DECISION because...", "```PREFERENCE```", "{\"category\":\"PROJECT_RULE\"}", "DIRECT"})
    void malformedOutputFallsBackToUnknown(String value) {
        when(model.call(any(Prompt.class))).thenReturn(value == null ? null : reply(value));
        assertEquals(MemoryCategory.UNKNOWN, new MemoryClassificationService().classify(model, "待分类的问题"));
    }

    @Test void failuresAndTimeoutsAreOptional() {
        when(model.call(any(Prompt.class))).thenThrow(new IllegalStateException("private-upstream-error"));
        assertEquals(MemoryCategory.UNKNOWN, new MemoryClassificationService().classify(model, "问题"));
        var released = new CountDownLatch(1);
        when(model.call(any(Prompt.class))).thenAnswer(call -> {
            released.await();
            return reply("DECISION");
        });
        try {
            assertEquals(MemoryCategory.UNKNOWN,
                    new MemoryClassificationService(Duration.ofMillis(50)).classify(model, "问题"));
        } finally { released.countDown(); }
    }

    @Test void categoryMatrixAndBonusesPreservePriorityWithoutCriticalBonus() {
        assertEquals(1.0, MemoryCategory.DECISION.applicability(MemoryCategory.PROJECT_RULE));
        assertEquals(0.8, MemoryCategory.DECISION.applicability(MemoryCategory.DISCUSSION));
        double normal = MemoryCategory.DISCUSSION.score(1, 4, false, MemoryCategory.UNKNOWN);
        double important = MemoryCategory.DISCUSSION.score(2, 4, false, MemoryCategory.UNKNOWN);
        double critical = MemoryCategory.DISCUSSION.score(3, 4, false, MemoryCategory.UNKNOWN);
        assertEquals(0.175, important - normal, 0.00001);
        assertEquals(0.175, critical - important, 0.00001);
        assertTrue(MemoryCategory.UNKNOWN.score(1, 1, true, MemoryCategory.UNKNOWN)
                > MemoryCategory.UNKNOWN.score(3, 2, false, MemoryCategory.PROJECT_RULE));
        assertTrue(MemoryCategory.UNKNOWN.score(1, 3, false, MemoryCategory.UNKNOWN)
                > MemoryCategory.UNKNOWN.score(3, 4, false, MemoryCategory.PROJECT_RULE));
    }
}
