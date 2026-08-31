package com.aureli.ai.robot.controller;

import com.google.common.collect.Lists;
import com.aureli.ai.robot.advisor.CustomChatMemoryAdvisor;
import com.aureli.ai.robot.advisor.CustomStreamLoggerAndMessage2DBAdvisor;
import com.aureli.ai.robot.advisor.CustomerServiceAdvisor;
import com.aureli.ai.robot.aspect.ApiOperationLog;
import com.aureli.ai.robot.domain.mapper.TileEdgeMapper;
import com.aureli.ai.robot.domain.mapper.TileMapper;
import com.aureli.ai.robot.domain.mapper.TileMessageMapper;
import com.aureli.ai.robot.model.vo.customerService.*;
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

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
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
    private TileMapper tileMapper;
    @Resource
    private TileMessageMapper tileMessageMapper;
    @Resource
    private TileEdgeMapper tileEdgeMapper;
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

    @PostMapping("/tile/reset")
    @ApiOperationLog(description = "重置 Tile 画布数据")
    public Response<?> resetTileWorkspace() {
        return customerService.resetTileWorkspace();
    }

    /**
     * Tile 式智能客服对话。
     * tileId 表示当前磁贴；relatedTileIds 为空时表示从画布空白处提问，不读取工作记忆。
     */
    @PostMapping(value = "/chat/tile/completion", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @ApiOperationLog(description = "Tile 式 AI 智能客服对话")
    public Flux<AiCustomerServiceChatRspVO> tileChat(@RequestBody @Validated AiCustomerServiceChatReqVO aiChatReqVO) {
        String userMessage = aiChatReqVO.getMessage();
        List<String> relatedTileIds = resolveRelatedTileIds(aiChatReqVO);
        int memoryDepth = resolveMemoryDepth(aiChatReqVO.getMemoryDepth());

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

        if (!relatedTileIds.isEmpty()) {
            advisors.add(new CustomChatMemoryAdvisor(tileMessageMapper, tileEdgeMapper, relatedTileIds, memoryDepth));
        }

        advisors.add(new CustomStreamLoggerAndMessage2DBAdvisor(tileMapper,
                tileMessageMapper,
                tileEdgeMapper,
                aiChatReqVO.getTileId(),
                userMessage,
                relatedTileIds,
                aiChatReqVO.getEdgeDirection(),
                aiChatReqVO.getRelationType(),
                aiChatReqVO.getEdgeWeight(),
                aiChatReqVO.getEdgeDescription(),
                transactionTemplate));

        chatClientRequestSpec.advisors(advisors);

        return chatClientRequestSpec
                .stream()
                .content()
                .mapNotNull(text -> AiCustomerServiceChatRspVO.builder().v(text).build());
    }

    private List<String> resolveRelatedTileIds(AiCustomerServiceChatReqVO aiChatReqVO) {
        Set<String> relatedTileIds = new LinkedHashSet<>();
        if (aiChatReqVO.getRelatedTileIds() != null) {
            relatedTileIds.addAll(aiChatReqVO.getRelatedTileIds());
        }

        if (StringUtils.isNotBlank(aiChatReqVO.getParentTileId())) {
            relatedTileIds.add(aiChatReqVO.getParentTileId());
        }

        relatedTileIds.removeIf(tileId -> StringUtils.isBlank(tileId)
                || StringUtils.equals(tileId, aiChatReqVO.getTileId()));
        return relatedTileIds.stream().toList();
    }

    private int resolveMemoryDepth(Integer memoryDepth) {
        if (memoryDepth == null) {
            return 1;
        }
        return Math.max(memoryDepth, 0);
    }

}
