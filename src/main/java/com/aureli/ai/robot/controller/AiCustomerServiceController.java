package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.maps.MapIds;

import com.google.common.collect.Lists;
import com.aureli.ai.robot.advisor.CustomChatMemoryAdvisor;
import com.aureli.ai.robot.advisor.CustomStreamLoggerAndMessage2DBAdvisor;
import com.aureli.ai.robot.advisor.CustomerServiceAdvisor;
import com.aureli.ai.robot.advisor.TavilySearchAdvisor;
import com.aureli.ai.robot.service.search.TavilyMcpSearchService;
import com.aureli.ai.robot.service.search.TavilySettingsService;
import com.aureli.ai.robot.aspect.ApiOperationLog;
import com.aureli.ai.robot.domain.mapper.TileEdgeMapper;
import com.aureli.ai.robot.domain.mapper.TileMapper;
import com.aureli.ai.robot.domain.mapper.TileMessageMapper;
import com.aureli.ai.robot.model.vo.customerService.*;
import com.aureli.ai.robot.service.CustomerService;
import com.aureli.ai.robot.service.GeneralSettingsService;
import com.aureli.ai.robot.service.MemoryClassificationService;
import com.aureli.ai.robot.service.model.ModelApiSettingsService;
import com.aureli.ai.robot.utils.PageResponse;
import com.aureli.ai.robot.utils.Response;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.client.advisor.api.Advisor;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.vectorstore.VectorStore;
import org.springframework.http.MediaType;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import reactor.core.publisher.Flux;
import reactor.core.scheduler.Schedulers;

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

    @Resource
    private ModelApiSettingsService modelApiSettings;
    @Resource
    private TavilySettingsService tavilySettings;
    @Resource
    private TavilyMcpSearchService tavilySearch;
    @Resource
    private GeneralSettingsService generalSettings;
    @Resource
    private MemoryClassificationService memoryClassification;

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
    public Response<?> resetTileWorkspace(@RequestBody @Validated ResetWorkspace request) {
        return customerService.resetTileWorkspace(MapIds.normalize(request.mapId()));
    }

    public record ResetWorkspace(@jakarta.validation.constraints.NotBlank(message = "请先创建或选择图谱") String mapId) {}

    @PostMapping("/tile/delete")
    @ApiOperationLog(description = "删除 Tile 节点、消息和关系边")
    public Response<?> deleteTile(@RequestBody @Validated DeleteTileReqVO deleteTileReqVO) {
        return customerService.deleteTile(deleteTileReqVO);
    }

    /**
     * Tile 式智能客服对话。
     * tileId 表示当前磁贴；relatedTileIds 为空时表示从画布空白处提问，不读取工作记忆。
     */
    @PostMapping(value = "/chat/tile/completion", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @ApiOperationLog(description = "Tile 式 AI 智能客服对话")
    public Flux<AiCustomerServiceChatRspVO> tileChat(@RequestBody @Validated AiCustomerServiceChatReqVO aiChatReqVO) {
        String userMessage = aiChatReqVO.getMessage();
        String mapId = MapIds.normalize(aiChatReqVO.getMapId());
        List<String> relatedTileIds = resolveRelatedTileIds(aiChatReqVO);
        ChatModel chatModel = modelApiSettings.chatModel();
        // Classification and database reads stay off the response thread and outside write transactions.
        return Flux.defer(() -> {
            var category = memoryClassification.classifyForTile(chatModel, userMessage, mapId, aiChatReqVO.getTileId());
            int tokenBudget = generalSettings.contextTokenBudget();
            ChatClient.ChatClientRequestSpec chatClientRequestSpec = ChatClient.create(chatModel)
                    .prompt()
                    .user(userMessage);

            var persistenceAdvisor = new CustomStreamLoggerAndMessage2DBAdvisor(tileMapper,
                    tileMessageMapper,
                    tileEdgeMapper,
                    aiChatReqVO.getTileId(),
                    userMessage,
                    relatedTileIds,
                    aiChatReqVO.getEdgeDirection(),
                    aiChatReqVO.getRelationType(),
                    aiChatReqVO.getEdgeWeight(),
                    aiChatReqVO.getEdgeDescription(),
                    transactionTemplate, mapId, category);

            List<Advisor> advisors = Lists.newArrayList();
            if (!relatedTileIds.isEmpty()) {
                advisors.add(new CustomChatMemoryAdvisor(tileMessageMapper, tileEdgeMapper, tileMapper,
                        relatedTileIds, persistenceAdvisor.pendingEdges(), mapId, category, tokenBudget));
            }

            advisors.add(new CustomerServiceAdvisor(vectorStore, chatModel));
            advisors.add(new TavilySearchAdvisor(tavilySettings, tavilySearch, chatModel));
            advisors.add(persistenceAdvisor);

            chatClientRequestSpec.advisors(advisors);

            // defer also captures synchronous embedding / advisor failures into the SSE protocol.
            return chatClientRequestSpec.stream().content()
                    .mapNotNull(text -> AiCustomerServiceChatRspVO.builder().v(text).build());
        }).subscribeOn(Schedulers.boundedElastic())
                .concatWithValues(AiCustomerServiceChatRspVO.builder().done(true).build())
                .onErrorResume(error -> {
                    log.error("Tile completion failed: {}", aiChatReqVO.getTileId(), error);
                    return Flux.just(AiCustomerServiceChatRspVO.builder()
                            .error("回答生成或保存失败，请检查模型服务连接后重试。")
                            .build());
                });
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

}
