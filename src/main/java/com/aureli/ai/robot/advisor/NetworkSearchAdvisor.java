package com.aureli.ai.robot.advisor;

import com.aureli.ai.robot.model.dto.SearchResultDTO;
import com.aureli.ai.robot.service.SearXNGService;
import com.aureli.ai.robot.service.SearchResultContentFetcherService;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.ai.chat.client.ChatClientRequest;
import org.springframework.ai.chat.client.ChatClientResponse;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisor;
import org.springframework.ai.chat.client.advisor.api.StreamAdvisorChain;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.chat.prompt.PromptTemplate;
import reactor.core.publisher.Flux;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * @Author: 犬小哈
 * @Date: 2026/8/20 21:13
 * @Version: v1.0.0
 * @Description: 联网搜索 Advisor
 **/
@Slf4j
public class NetworkSearchAdvisor implements StreamAdvisor {

    private final SearXNGService searXNGService;
    private final SearchResultContentFetcherService searchResultContentFetcherService;

    /**
     * 联网搜索提示词模板
     */
    private static final PromptTemplate DEFAULT_PROMPT_TEMPLATE = new PromptTemplate("""
            ## 用户问题
            {question}
            
            ## 上下文
            上下文信息如下，由以下符号包围:
            ---------------------
            {context}
            ---------------------
            
            请根据上下文内容来回复用户：
            
            ## 任务要求
            
            1. 综合分析上下文内容，提取与用户问题直接相关的核心信息
            2. 特别关注匹配度较高的结果
            3. 对矛盾信息进行交叉验证，优先采用多个来源证实的信息
            4. 请避免使用诸如 “根据上下文……” 或 “所提供的信息……” 这类表述
            5. 当上下文内容不足或存在知识缺口时，再考虑使用本身已拥有的先验知识
            6. 在关键信息后标注对应的来源，包含编号与页面跳转链接，格式如 [<a href="https://www.douyin.com/shipin/7532759629252544512" target="_blank">来源1</a>]
            """);

    public NetworkSearchAdvisor(SearXNGService searXNGService, SearchResultContentFetcherService searchResultContentFetcherService) {
        this.searXNGService = searXNGService;
        this.searchResultContentFetcherService = searchResultContentFetcherService;
    }

    @Override
    public Flux<ChatClientResponse> adviseStream(ChatClientRequest chatClientRequest, StreamAdvisorChain streamAdvisorChain) {
        // 获取用户输入的提示词
        Prompt prompt = chatClientRequest.prompt();
        UserMessage userMessage = prompt.getUserMessage();

        // 调用 SearXNG 获取搜索结果
        List<SearchResultDTO> searchResults = searXNGService.search(userMessage.getText());

        // 并发请求，获取搜索结果页面的内容
        CompletableFuture<List<SearchResultDTO>> resultsFuture = searchResultContentFetcherService.batchFetch(searchResults, 7, TimeUnit.SECONDS);

        List<SearchResultDTO> results = resultsFuture.join();

        // 过滤掉获取失败的结果
        List<SearchResultDTO> successfulResults = results.stream()
                .filter(r -> StringUtils.isNotBlank(r.getContent()))
                .toList();

        // 构建搜索结果上下文信息
        String searchContext = buildContext(successfulResults);

        // 填充提示词占位符，转换为 Prompt 提示词对象
        Prompt newPrompt = DEFAULT_PROMPT_TEMPLATE.create(Map.of("question", userMessage.getText(),
                "context", searchContext), chatClientRequest.prompt().getOptions());

        log.info("## 重新构建的增强提示词: {}", newPrompt.getUserMessage().getText());

        // 重新构建 ChatClientRequest，设置重新构建的 “增强提示词”
        ChatClientRequest newChatClientRequest = ChatClientRequest.builder()
                .prompt(newPrompt)
                .build();

        return streamAdvisorChain.nextStream(newChatClientRequest);
    }

    /**
     * 构建上下文
     * @param successfulResults
     * @return
     */
    private String buildContext(List<SearchResultDTO> successfulResults) {
        int i = 1;
        StringBuilder contextTemp = new StringBuilder();
        for (SearchResultDTO searchResult : successfulResults) {
            contextTemp.append(String.format("""
                        ### 来源 %s | 相关性: %s
                        - 页面链接: %s 
                        - 页面文本:
                        %s
                        \n
                        """, i, searchResult.getScore(), searchResult.getUrl(), searchResult.getContent()));
            i++;
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
