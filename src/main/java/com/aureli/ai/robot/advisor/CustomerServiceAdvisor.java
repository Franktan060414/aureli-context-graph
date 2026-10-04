package com.aureli.ai.robot.advisor;

import com.aureli.ai.robot.prompt.CustomerServicePrompts;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClientRequest;
import org.springframework.ai.chat.client.ChatClientResponse;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisor;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisorChain;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import reactor.core.publisher.Flux;

import java.util.List;

/**
 * @Date: 2026/8/23 17:09
 * @Version: v1.0.0
 * @Description: 智能客服 Advisor
 **/
@Slf4j
public class CustomerServiceAdvisor implements StreamAdvisor {

    private final VectorStore vectorStore;

    public CustomerServiceAdvisor(VectorStore vectorStore) {
        this.vectorStore = vectorStore;
    }

    @Override
    public Flux<ChatClientResponse> adviseStream(ChatClientRequest chatClientRequest, StreamAdvisorChain streamAdvisorChain) {
        // 获取用户输入的提示词
        Prompt prompt = chatClientRequest.prompt();
        UserMessage userMessage = prompt.getUserMessage();

        // 查询向量库
        // 检索与查询相似的文档
        List<Document> documents = vectorStore.similaritySearch(SearchRequest.builder()
                .query(userMessage.getText()) // 查询的关键词
                .topK(3) // 查询相似度最高的 3 条文档
                .build());

        // 构建向量查询结果上下文信息
        String context = buildContext(documents);

        // 填充提示词占位符，转换为 Prompt 提示词对象
        Prompt newPrompt = CustomerServicePrompts.ragAnswer(userMessage.getText(), context, prompt.getOptions());

        log.info("## 重新构建的增强提示词: {}", newPrompt.getUserMessage().getText());

        // 重新构建 ChatClientRequest，设置重新构建的 “增强提示词”
        ChatClientRequest newChatClientRequest = ChatClientRequest.builder()
                .prompt(newPrompt)
                .build();

        return streamAdvisorChain.nextStream(newChatClientRequest);
    }

    /**
     * 构建上下文
     * @param documents
     * @return
     */
    private String buildContext(List<Document> documents) {
        StringBuilder contextTemp = new StringBuilder();

        for (Document document : documents) {
            contextTemp.append(CustomerServicePrompts.knowledgeDocument(document.getText()));
        }

        return contextTemp.toString();
    }

    @Override
    public String getName() {
        // 获取类名称
        return this.getClass().getSimpleName();
    }

    @Override
    public int getOrder() {
        return 1; // order 值越小，越先执行
    }
}
