package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.model.vo.customerService.*;
import com.google.common.collect.Lists;
import com.aureli.ai.robot.advisor.CustomChatMemoryAdvisor;
import com.aureli.ai.robot.advisor.CustomStreamLoggerAndMessage2DBAdvisor;
import com.aureli.ai.robot.advisor.CustomerServiceAdvisor;
import com.aureli.ai.robot.aspect.ApiOperationLog;
import com.aureli.ai.robot.domain.mapper.ChatMessageMapper;
import com.aureli.ai.robot.model.vo.chat.AIResponse;
import com.aureli.ai.robot.model.vo.chat.AiChatReqVO;
import com.quanxiaoha.ai.robot.model.vo.customerService.*;
import com.aureli.ai.robot.service.CustomerService;
import com.aureli.ai.robot.utils.PageResponse;
import com.aureli.ai.robot.utils.Response;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.api.Advisor;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import reactor.core.publisher.Flux;

import java.util.List;

/**
 * @Author: 犬小哈
 * @Date: 2026/8/22 15:22
 * @Version: v1.0.0
 * @Description: AI 客服
 **/
@RestController
@RequestMapping("/customer-service")
@Slf4j
public class AiCustomerServiceController {

    @Resource
    private CustomerService customerService;

    @Resource
    private VectorStore vectorStore;
    @Resource
    private ChatMessageMapper chatMessageMapper;
    @Resource
    private TransactionTemplate transactionTemplate;

    @Value("${spring.ai.openai.base-url}")
    private String baseUrl;
    @Value("${spring.ai.openai.api-key}")
    private String apiKey;
    @Value("${customer-service.model}")
    private String model;
    @Value("${customer-service.temperature}")
    private Double temperature;


    /**
     * 问答 MD 文件上传
     * @param file
     * @return
     */
    @PostMapping(value = "/md/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Response<?> uploadMarkdownFile(@RequestPart(value = "file", required = false) MultipartFile file) {
        return customerService.uploadMarkdownFile(file);
    }

    @PostMapping("/md/delete")
    @ApiOperationLog(description = "删除 Markdown 问答文件")
    public Response<?> deleteMarkdownFile(@RequestBody @Validated DeleteMarkdownFileReqVO deleteMarkdownFileReqVO) {
        return customerService.deleteMarkdownFile(deleteMarkdownFileReqVO);
    }

    @PostMapping("/md/list")
    @ApiOperationLog(description = "Markdown 问答文件分页查询")
    public PageResponse<FindMarkdownFilePageListRspVO> findMarkdownFilePageList(@RequestBody @Validated FindMarkdownFilePageListReqVO findMarkdownFilePageListReqVO) {
        return customerService.findMarkdownFilePageList(findMarkdownFilePageListReqVO);
    }

    @PostMapping("/md/update")
    @ApiOperationLog(description = "修改 Markdown 问答文件信息")
    public Response<?> updateMarkdownFile(@RequestBody @Validated UpdateMarkdownFileReqVO updateMarkdownFileReqVO) {
        return customerService.updateMarkdownFile(updateMarkdownFileReqVO);
    }

    /**
     * 流式对话
     * @return
     */
//    @PostMapping(value = "/chat/completion", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @GetMapping(value = "/chat/completion", produces = "text/html;charset=utf-8")
    @ApiOperationLog(description = "AI 智能客服对话")
//    public Flux<String> chat(@RequestBody @Validated AiCustomerServiceChatReqVO aiChatReqVO) {
    public Flux<String> chat(@RequestParam(value = "message") String userMessage) {
        // 用户消息
//        String userMessage = aiChatReqVO.getMessage();

        // 构建 ChatModel
        ChatModel chatModel = OpenAiChatModel.builder()
                .options(OpenAiChatOptions.builder()
                        .baseUrl(baseUrl)
                        .apiKey(apiKey)
                        .build())
                .build();

        // 动态设置调用的模型名称、温度值
        ChatClient.ChatClientRequestSpec chatClientRequestSpec = ChatClient.create(chatModel)
                .prompt()
                .options(OpenAiChatOptions.builder()
                        .model(model)
                        .temperature(temperature))
                .user(userMessage); // 用户提示词

        // Advisor 集合
        List<Advisor> advisors = Lists.newArrayList();
        advisors.add(new CustomerServiceAdvisor(vectorStore)); // 检索向量库，组合增强提示词

        // 应用 Advisor 集合
        chatClientRequestSpec.advisors(advisors);

        // 流式输出
        return chatClientRequestSpec
                .stream()
                .content();
    }

    /**
     * Tile 式智能客服对话。
     * tileId 表示当前磁贴；parentTileId 为空时表示从空白处提问，不读取工作记忆。
     */
    @PostMapping(value = "/chat/tile/completion", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @ApiOperationLog(description = "Tile 式 AI 智能客服对话")
    public Flux<AIResponse> tileChat(@RequestBody @Validated AiCustomerServiceChatReqVO aiChatReqVO) {
        String userMessage = aiChatReqVO.getMessage();

        ChatModel chatModel = OpenAiChatModel.builder()
                .options(OpenAiChatOptions.builder()
                        .baseUrl(baseUrl)
                        .apiKey(apiKey)
                        .build())
                .build();

        ChatClient.ChatClientRequestSpec chatClientRequestSpec = ChatClient.create(chatModel)
                .prompt()
                .options(OpenAiChatOptions.builder()
                        .model(model)
                        .temperature(temperature))
                .user(userMessage);

        List<Advisor> advisors = Lists.newArrayList();
        advisors.add(new CustomerServiceAdvisor(vectorStore));

        String parentTileId = aiChatReqVO.getParentTileId();
        if (StringUtils.isNotBlank(parentTileId)) {
            advisors.add(new CustomChatMemoryAdvisor(chatMessageMapper, buildAiChatReqVO(userMessage, parentTileId), 2));
        }

        advisors.add(new CustomStreamLoggerAndMessage2DBAdvisor(chatMessageMapper,
                buildAiChatReqVO(userMessage, aiChatReqVO.getTileId()),
                transactionTemplate));

        chatClientRequestSpec.advisors(advisors);

        return chatClientRequestSpec
                .stream()
                .content()
                .mapNotNull(text -> AIResponse.builder().v(text).build());
    }

    private AiChatReqVO buildAiChatReqVO(String message, String chatId) {
        return AiChatReqVO.builder()
                .message(message)
                .chatId(chatId)
                .modelName(model)
                .temperature(temperature)
                .networkSearch(false)
                .build();
    }

}
