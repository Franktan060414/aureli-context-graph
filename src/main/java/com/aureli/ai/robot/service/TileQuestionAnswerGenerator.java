package com.aureli.ai.robot.service;

import com.aureli.ai.robot.advisor.CustomerServiceAdvisor;
import com.aureli.ai.robot.service.model.ModelApiSettingsService;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.stereotype.Service;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/** 按原提问的知识检索规则生成完整答案，保存由组事务负责。 */
@Service
public class TileQuestionAnswerGenerator {
    private final ModelApiSettingsService settings;
    private final VectorStore vectors;
    public TileQuestionAnswerGenerator(ModelApiSettingsService settings, VectorStore vectors) {
        this.settings = settings;
        this.vectors = vectors;
    }
    public String answer(String question, List<Message> memory) {
        var model = settings.chatModel();
        var messages = new ArrayList<>(memory);
        messages.add(new UserMessage(question));
        var chunks = ChatClient.create(model).prompt().messages(messages)
                .advisors(new CustomerServiceAdvisor(vectors, model))
                .stream().content().collectList().block(Duration.ofMinutes(2));
        String answer = chunks == null ? "" : String.join("", chunks).trim();
        if (answer.isBlank() || answer.length() > 100000)
            throw new IllegalStateException("模型未返回有效答案");
        return answer;
    }
}
