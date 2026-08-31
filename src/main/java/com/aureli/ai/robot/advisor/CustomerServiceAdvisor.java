package com.aureli.ai.robot.advisor;

import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClientRequest;
import org.springframework.ai.chat.client.ChatClientResponse;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisor;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisorChain;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.chat.prompt.PromptTemplate;
import org.springframework.ai.document.Document;
import org.springframework.ai.vectorstore.SearchRequest;
import org.springframework.ai.vectorstore.VectorStore;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.Map;

/**
 * @Date: 2026/8/23 17:09
 * @Version: v1.0.0
 * @Description: 智能客服 Advisor
 **/
@Slf4j
public class CustomerServiceAdvisor implements StreamAdvisor {

    private final VectorStore vectorStore;

    /**
     * 联网搜索提示词模板
     */
    private static final PromptTemplate DEFAULT_PROMPT_TEMPLATE = new PromptTemplate("""
            你是一个专业的人工智能助手，名为 “Aurelia”。请根据以下上下文信息回答用户问题。
            
            ## 知识库信息
            {context}

            请根据上下文内容来回复用户：
            
            ## 用户问题
            {question}
            
            ## 回答要求
     
            
            你可以获得两类上下文：
            
            1. Tile 工作记忆
            - 来自用户显式选择或图遍历得到的相关 Tile。
            - 包含用户之前的问题、AI 之前的回答，以及这些 Tile 之间的关系。
            - 用于回答“我刚刚问了什么”“上一个 Tile 讲了什么”“这些 Tile 之间有什么关系”“继续刚才的问题”等与对话历史、当前思路、上下文回顾有关的问题。
            
            2. RAG 知识库
            - 来自上传的 Markdown 文档或企业知识库。
            - 用于回答产品知识、课程知识、技术概念、FAQ、制度说明等外部知识问题。
            
            回答规则：
            
            - 如果用户的问题是在询问对话历史、Tile 内容、刚才的问题、上一轮回答、当前上下文、相关 Tile、图中节点关系，必须优先使用 Tile 工作记忆回答。
            - 当 Tile 工作记忆已经足以回答时，不要引用 RAG 知识库，也不要说“知识库中没有找到”。
            - 只有当用户询问外部知识、业务知识、产品知识、概念解释或资料内容时，才使用 RAG 知识库。
            - 如果 Tile 工作记忆和 RAG 知识库都可用，但用户问题明显指向“刚才/之前/这个 Tile/相关 Tile”，以 Tile 工作记忆为准。
            - 如果 Tile 工作记忆中没有相关内容，再说明“当前相关 Tile 中没有找到这部分上下文”，然后再考虑是否需要使用知识库。
            - 不要把“我刚刚在问什么”理解成知识库问题。它是上下文回顾问题。
            - 回答要直接、简洁，先给结论，再补充必要来源。
        
            现在请根据以上要求回答问题。
            """);

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
        Prompt newPrompt = DEFAULT_PROMPT_TEMPLATE.create(Map.of("question", userMessage.getText(),
                "context", context), chatClientRequest.prompt().getOptions());

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
            contextTemp.append(String.format("""
                        %s
                        ---\n
                        """, document.getText()));
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
