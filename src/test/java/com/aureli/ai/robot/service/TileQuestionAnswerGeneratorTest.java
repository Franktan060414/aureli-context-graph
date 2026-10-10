package com.aureli.ai.robot.service;

import com.aureli.ai.robot.service.model.ModelApiSettingsService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.model.*;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.chat.prompt.ChatOptions;
import org.springframework.ai.vectorstore.VectorStore;
import reactor.core.publisher.Flux;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class TileQuestionAnswerGeneratorTest {
    ChatResponse reply(String text) { return new ChatResponse(List.of(new Generation(new AssistantMessage(text)))); }
    @Test void usesExistingKnowledgeDecisionAndPreservesApprovedContextWithoutSaving() {
        var settings = mock(ModelApiSettingsService.class);
        var model = mock(ChatModel.class);
        when(model.getOptions()).thenReturn(ChatOptions.builder().build());
        var vectors = mock(VectorStore.class);
        when(settings.chatModel()).thenReturn(model);
        when(model.call(any(Prompt.class))).thenReturn(reply("DIRECT"));
        when(model.stream(any(Prompt.class))).thenReturn(Flux.just(reply("完整"), reply("答案")));
        var generator = new TileQuestionAnswerGenerator(settings, vectors);
        String answer = generator.answer("已确认的子问题", List.of(new UserMessage("原问题：保留已有接口"), new AssistantMessage("原回答")));
        assertEquals("完整答案", answer);
        var prompt = ArgumentCaptor.forClass(Prompt.class); verify(model).stream(prompt.capture());
        assertEquals("已确认的子问题", prompt.getValue().getUserMessage().getText());
        assertTrue(prompt.getValue().getInstructions().toString().contains("保留已有接口"));
        assertTrue(prompt.getValue().getInstructions().toString().contains("原回答"));
        verifyNoInteractions(vectors);
    }
    @Test void incompleteOrEmptyGenerationIsRejected() {
        var settings = mock(ModelApiSettingsService.class);
        var model = mock(ChatModel.class); when(settings.chatModel()).thenReturn(model);
        when(model.getOptions()).thenReturn(ChatOptions.builder().build());
        when(model.call(any(Prompt.class))).thenReturn(reply("DIRECT"));
        var generator = new TileQuestionAnswerGenerator(settings, mock(VectorStore.class));
        when(model.stream(any(Prompt.class))).thenReturn(Flux.empty());
        assertThrows(IllegalStateException.class, () -> generator.answer("问题", List.of()));
        when(model.stream(any(Prompt.class))).thenReturn(Flux.just(reply("部分答案")), Flux.error(new IllegalStateException("broken")));
        generator.answer("问题", List.of());
        assertThrows(IllegalStateException.class, () -> generator.answer("问题", List.of()));
    }
}
