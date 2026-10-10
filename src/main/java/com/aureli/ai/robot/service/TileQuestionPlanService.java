package com.aureli.ai.robot.service;

import com.aureli.ai.robot.advisor.CustomChatMemoryAdvisor;
import com.aureli.ai.robot.controller.TileWorkspaceController;
import com.aureli.ai.robot.domain.TileRelationTypes;
import com.aureli.ai.robot.domain.dos.*;
import com.aureli.ai.robot.domain.mapper.*;
import com.aureli.ai.robot.domain.maps.MapIds;
import com.aureli.ai.robot.model.vo.customerService.AiCustomerServiceChatReqVO;
import com.aureli.ai.robot.prompt.CustomerServicePrompts;
import com.aureli.ai.robot.prompt.TileQuestionPlanPrompts;
import com.aureli.ai.robot.service.model.ModelApiSettingsService;
import com.aureli.ai.robot.utils.JsonUtil;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.google.common.cache.Cache;
import com.google.common.cache.CacheBuilder;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.messages.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.TimeUnit;

/** 内存中的短期确认方案不创建 Tile；确认后生成整组，再原子保存。 */
@Service
@Slf4j
public class TileQuestionPlanService {
    private final TileMapper tiles;
    private final TileMessageMapper messages;
    private final TileEdgeMapper edges;
    private final MapMapper maps;
    private final ModelApiSettingsService settings;
    private final TileQuestionAnswerGenerator generator;
    private final TransactionTemplate transactions;
    private final Cache<String, Plan> plans = CacheBuilder.newBuilder()
            .maximumSize(1000).expireAfterWrite(30, TimeUnit.MINUTES).build();

    public TileQuestionPlanService(TileMapper tiles, TileMessageMapper messages, TileEdgeMapper edges,
                                   MapMapper maps, ModelApiSettingsService settings,
                                   TileQuestionAnswerGenerator generator, TransactionTemplate transactions) {
        this.tiles = tiles; this.messages = messages; this.edges = edges; this.maps = maps;
        this.settings = settings; this.generator = generator; this.transactions = transactions;
    }
    public record Proposal(boolean suggested, String reason, List<String> questions, String planId) {}
    public static class PlanException extends RuntimeException {
        public final String code;
        public PlanException(String code, String message) { super(message); this.code = code; }
    }
    public static class PlanningUnavailable extends RuntimeException {}
    private record Input(String mapId, String tileId, String message, List<String> related,
                         int depth, String direction, BigDecimal weight, String description) {}
    private record Context(List<Message> memory, String fingerprint) {}
    private static class Plan {
        final Input input;
        final Context context;
        final List<String> questions;
        String state = "PENDING";
        TileWorkspaceController.Workspace result;
        Plan(Input input, Context context, List<String> questions) {
            this.input = input; this.context = context; this.questions = questions;
        }
    }

    public Proposal prepare(AiCustomerServiceChatReqVO request) {
        Input input = normalize(request);
        Context context = transactions.execute(status -> readContext(input));
        Proposal proposal;
        try {
            String text = settings.chatModel().call(TileQuestionPlanPrompts.plan(input.message, context.memory))
                    .getResult().getOutput().getText();
            if (text == null) throw new IllegalStateException();
            String json = text.trim();
            if (json.startsWith("```json") && json.endsWith("```")) json = json.substring(7, json.length() - 3).trim();
            else if (json.startsWith("```") && json.endsWith("```")) json = json.substring(3, json.length() - 3).trim();
            proposal = parse(JsonUtil.parseMap(json, String.class, Object.class), input.message);
        } catch (RuntimeException error) {
            log.warn("Tile question planning unavailable: map={}, tile={}", input.mapId, input.tileId);
            throw new PlanningUnavailable();
        }
        requireCurrent(input, context);
        if (!proposal.suggested) {
            log.info("Tile question plan: tile={}, suggested=false", input.tileId);
            return proposal;
        }
        String id = UUID.randomUUID().toString();
        plans.put(id, new Plan(input, context, proposal.questions));
        log.info("Tile question plan: tile={}, plan={}, children={}", input.tileId, id, proposal.questions.size());
        return new Proposal(true, proposal.reason, proposal.questions, id);
    }

    /** 同一方案串行消费；重复执行返回原结果，失败允许按相同方案重试。 */
    public TileWorkspaceController.Workspace decide(String mapId, String planId, String action) {
        mapId = MapIds.normalize(mapId);
        Plan plan = plans.getIfPresent(planId);
        if (plan == null) {
            if ("CANCEL".equals(action)) return null;
            throw new PlanException("QUESTION_PLAN_EXPIRED", "拆分建议已过期，请返回修改问题并重新提交。");
        }
        synchronized (plan) {
            if (!plan.input.mapId.equals(mapId)) throw new IllegalArgumentException("拆分建议不属于当前图谱。");
            if (!Set.of("EXECUTE", "DECLINE", "CANCEL").contains(action))
                throw new IllegalArgumentException("请选择取消、不执行拆分或执行拆分。");
            if ("DONE".equals(plan.state) && "EXECUTE".equals(action)) return plan.result;
            if (action.equals(plan.state)) return null;
            if (!"PENDING".equals(plan.state))
                throw new PlanException("QUESTION_PLAN_CONSUMED", "本次建议已处理，请返回问题重新提交。");
            if (!"EXECUTE".equals(action)) {
                plan.state = action;
                log.info("Tile question decision: plan={}, action={}", planId, action);
                return null;
            }
            log.info("Tile question decision: plan={}, action=EXECUTE", planId);
            requireCurrent(plan.input, plan.context);
            // 不在数据库事务内等待模型；任何答案失败都不会保存半组节点。
            String rootAnswer = validAnswer(generator.answer(plan.input.message, plan.context.memory));
            var childMemory = new ArrayList<>(plan.context.memory);
            childMemory.add(new UserMessage(CustomerServicePrompts.tileMemory(plan.input.tileId, 1,
                    "原始问题（子问题必须继承其范围和约束）：\n" + plan.input.message)));
            childMemory.add(new AssistantMessage(CustomerServicePrompts.tileMemory(plan.input.tileId, 1, rootAnswer)));
            var answers = new ArrayList<String>();
            for (String question : plan.questions) answers.add(validAnswer(generator.answer(question, List.copyOf(childMemory))));
            plan.result = transactions.execute(status -> {
                requireCurrent(plan.input, plan.context);
                return save(planId, plan, rootAnswer, answers);
            });
            plan.state = "DONE";
            log.info("Tile question committed: plan={}, tiles={}", planId, plan.questions.size() + 1);
            return plan.result;
        }
    }

    private Context readContext(Input input) {
        if (maps.selectCount(Wrappers.<MapDO>lambdaQuery().eq(MapDO::getMapId, input.mapId)) == 0)
            throw new IllegalArgumentException("图谱已不存在，请先创建或选择图谱。");
        if (tiles.selectCount(Wrappers.<TileDO>lambdaQuery().eq(TileDO::getTileId, input.tileId)) > 0)
            throw new PlanException("QUESTION_TILE_EXISTS", "Tile ID 已存在，请同步图谱并使用新的 ID。");
        if (input.related.isEmpty()) return new Context(List.of(), "[]");
        var sources = tiles.selectByTileIds(input.mapId, input.related).stream()
                .sorted(Comparator.comparing(TileDO::getTileId)).toList();
        if (!sources.stream().map(TileDO::getTileId).collect(java.util.stream.Collectors.toSet())
                .containsAll(input.related)) throw new IllegalArgumentException("关联 Tile 已不存在或不属于当前图谱，请重新选择。");
        var memory = new CustomChatMemoryAdvisor(messages, edges, tiles, input.related, input.depth,
                pendingEdges(input), input.mapId).memoryMessages();
        String snapshot = JsonUtil.toJsonString(List.of(sources, memory.stream().map(message ->
                Map.of("role", message.getMessageType().getValue(), "content", message.getText())).toList()));
        return new Context(memory, snapshot);
    }
    private String validAnswer(String answer) {
        if (answer == null || answer.isBlank() || answer.length() > 100000)
            throw new IllegalStateException("模型未返回有效答案");
        return answer.trim();
    }
    private void requireCurrent(Input input, Context context) {
        if (!context.fingerprint.equals(readContext(input).fingerprint))
            throw new PlanException("QUESTION_CONTEXT_CHANGED", "关联内容已发生变化，请返回问题重新提交，获取新的拆分建议。");
    }
    private List<TileEdgeDO> pendingEdges(Input input) {
        return input.related.stream().map(id -> TileEdgeDO.builder().mapId(input.mapId)
                .sourceTileId(id).targetTileId(input.tileId).direction(input.direction)
                .relationType(TileRelationTypes.forDirection(input.direction)).weight(input.weight)
                .description(input.description).build()).toList();
    }

    private TileWorkspaceController.Workspace save(String planId, Plan plan, String rootAnswer, List<String> answers) {
        var input = plan.input;
        LocalDateTime now = LocalDateTime.now();
        var nodes = new ArrayList<TileWorkspaceController.Node>();
        var links = new ArrayList<TileWorkspaceController.Edge>();
        nodes.add(saveNode(input.mapId, input.tileId, input.message, rootAnswer, input.related, now));
        for (var edge : pendingEdges(input)) links.add(saveEdge(edge, now));
        for (int index = 0; index < plan.questions.size(); index++) {
            String id = "tile-divides-" + planId + "-" + index;
            nodes.add(saveNode(input.mapId, id, plan.questions.get(index), answers.get(index), List.of(input.tileId), now));
            links.add(saveEdge(TileEdgeDO.builder().mapId(input.mapId).sourceTileId(input.tileId)
                    .targetTileId(id).direction("DIRECTED").relationType("DIVIDES").weight(BigDecimal.ONE)
                    .description("AI 建议拆分").build(), now));
        }
        return new TileWorkspaceController.Workspace(List.copyOf(nodes), List.copyOf(links));
    }
    private TileWorkspaceController.Node saveNode(String mapId, String id, String question, String answer,
                                                  List<String> related, LocalDateTime now) {
        if (answer == null || answer.isBlank() || answer.length() > 100000) throw new IllegalStateException("答案无效");
        String title = question.substring(0, Math.min(255, question.length()));
        tiles.insert(TileDO.builder().mapId(mapId).tileId(id).tileType("QA").title(title).userMessage(question)
                .answerSummary(answer.substring(0, Math.min(1000, answer.length()))).weight(1)
                .createTime(now).updateTime(now).build());
        messages.insert(TileMessageDO.builder().mapId(mapId).tileId(id).role("user").content(question).createTime(now).build());
        messages.insert(TileMessageDO.builder().mapId(mapId).tileId(id).role("assistant").content(answer).createTime(now).build());
        return new TileWorkspaceController.Node(id, question, answer, related, "ready", related.isEmpty() ? "root" : "memory",
                1, "QA", title, null, null, null, null, null);
    }
    private TileWorkspaceController.Edge saveEdge(TileEdgeDO edge, LocalDateTime now) {
        edge.setEdgeId("edge-" + UUID.randomUUID()); edge.setCreateTime(now); edge.setUpdateTime(now);
        edges.insert(edge);
        return new TileWorkspaceController.Edge(edge.getEdgeId(), edge.getSourceTileId(), edge.getTargetTileId(),
                edge.getDirection(), edge.getRelationType(), edge.getWeight(), edge.getDescription());
    }

    private Input normalize(AiCustomerServiceChatReqVO request) {
        String map = MapIds.normalize(request.getMapId());
        String id = request.getTileId() == null ? "" : request.getTileId().trim();
        String question = request.getMessage() == null ? "" : request.getMessage().trim();
        if (id.isEmpty() || id.length() > 128 || question.isEmpty() || question.length() > 10000)
            throw new IllegalArgumentException("请填写有效的 Tile ID（最多128字）和问题（最多10000字）。");
        Set<String> related = new LinkedHashSet<>();
        if (request.getRelatedTileIds() != null) related.addAll(request.getRelatedTileIds());
        if (request.getParentTileId() != null) related.add(request.getParentTileId());
        related.removeIf(value -> value == null || value.isBlank());
        related = related.stream().map(String::trim).filter(value -> !value.equals(id))
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
        int depth = request.getMemoryDepth() == null ? 1 : request.getMemoryDepth();
        if (depth < 0 || depth > 10 || related.size() > 100 || related.stream().anyMatch(value -> value.length() > 128))
            throw new IllegalArgumentException("关联选择或记忆深度无效，请重新选择。");
        String direction = "UNDIRECTED".equalsIgnoreCase(request.getEdgeDirection() == null ? "" : request.getEdgeDirection().trim())
                ? "UNDIRECTED" : "DIRECTED";
        BigDecimal weight = request.getEdgeWeight() == null ? BigDecimal.ONE : request.getEdgeWeight().max(BigDecimal.ZERO).min(BigDecimal.ONE);
        return new Input(map, id, question, List.copyOf(related), depth, direction, weight, request.getEdgeDescription());
    }
    private Proposal parse(Map<String, Object> json, String original) {
        if (json == null || !(json.get("suggested") instanceof Boolean suggested)
                || !(json.get("reason") instanceof String reason) || reason.isBlank() || reason.length() > 1000
                || !(json.get("questions") instanceof List<?> questions)) throw new IllegalStateException();
        if (!suggested) {
            if (!questions.isEmpty()) throw new IllegalStateException();
            return new Proposal(false, reason.trim(), List.of(), null);
        }
        if (questions.size() < 2 || questions.size() > 4) throw new IllegalStateException();
        Set<String> unique = new HashSet<>(); unique.add(original.toLowerCase(Locale.ROOT));
        var result = new ArrayList<String>();
        for (Object item : questions) {
            if (!(item instanceof String question) || question.isBlank() || question.length() > 10000
                    || !unique.add(question.trim().toLowerCase(Locale.ROOT))) throw new IllegalStateException();
            result.add(question.trim());
        }
        return new Proposal(true, reason.trim(), List.copyOf(result), null);
    }
}
