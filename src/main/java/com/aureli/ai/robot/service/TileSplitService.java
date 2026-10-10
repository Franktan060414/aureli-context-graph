package com.aureli.ai.robot.service;

import com.aureli.ai.robot.domain.maps.MapIds;
import com.aureli.ai.robot.domain.dos.TileDO;
import com.aureli.ai.robot.domain.dos.TileEdgeDO;
import com.aureli.ai.robot.domain.dos.TileMessageDO;
import com.aureli.ai.robot.domain.mapper.TileMapper;
import com.aureli.ai.robot.domain.mapper.TileEdgeMapper;
import com.aureli.ai.robot.domain.mapper.TileMessageMapper;
import com.aureli.ai.robot.model.vo.customerService.SplitTileReqVO;
import com.aureli.ai.robot.prompt.TileSplitPrompts;
import com.aureli.ai.robot.prompt.TileSplitPrompts.Source;
import com.aureli.ai.robot.prompt.TileSplitPrompts.Content;
import com.aureli.ai.robot.service.model.ModelApiSettingsService;
import com.aureli.ai.robot.utils.JsonUtil;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

@Service
public class TileSplitService {
    private final TileMapper tiles;
    private final TileMessageMapper messages;
    private final TileEdgeMapper edges;
    private final ModelApiSettingsService settings;
    private final TransactionTemplate transactions;

    public TileSplitService(TileMapper tiles, TileMessageMapper messages, TileEdgeMapper edges,
                            ModelApiSettingsService settings, TransactionTemplate transactions) {
        this.tiles = tiles;
        this.messages = messages;
        this.edges = edges;
        this.settings = settings;
        this.transactions = transactions;
    }

    public record Child(TileDO tile, String answer) {}
    public record Result(List<Child> children, List<TileEdgeDO> edges) {}
    /** 无拆分价值是业务拒绝，与模型连接或输出格式失败区分。 */
    public static class NotSplittableException extends RuntimeException {
        public NotSplittableException(String reason) { super(reason); }
    }
    public static class AlreadySplitException extends RuntimeException {
        public AlreadySplitException() { super("本次拆分已保存，请先同步图谱查看结果；重复提交不会创建新节点。"); }
    }

    public Result split(SplitTileReqVO request) {
        String mapId = MapIds.normalize(request.mapId());
        String id = request.sourceTileId().trim();
        String requirements = request.requirements() == null ? "" : request.requirements().trim();
        String splitId = request.splitId() == null ? UUID.randomUUID().toString() : request.splitId();
        List<String> childIds = java.util.stream.IntStream.range(0, 4)
                .mapToObj(index -> "tile-split-" + splitId + "-" + index).toList();
        Source source = transactions.execute(status -> {
            requireNewChildren(childIds);
            return readSource(mapId, id);
        });
        ChatModel model = settings.chatModel();

        boolean splittable;
        String reason;
        try {
            Map<String, Object> decision = call(model, TileSplitPrompts.decision(source, requirements));
            if (decision == null || !(decision.get("splittable") instanceof Boolean value)
                    || !(decision.get("reason") instanceof String explanation) || explanation.isBlank()
                    || explanation.length() > 1000) throw new IllegalStateException();
            splittable = value;
            reason = explanation.trim();
        } catch (RuntimeException error) {
            throw new IllegalStateException("拆分价值判断失败，模型未返回有效判断，请检查模型服务后重试。");
        }
        if (!splittable) throw new NotSplittableException(reason);

        List<Content> content;
        try {
            content = parseContent(call(model, TileSplitPrompts.split(source, requirements)), source);
        } catch (RuntimeException error) {
            throw new IllegalStateException("拆分生成失败，模型未返回有效的子问题和回答，请检查模型服务后重试。");
        }

        // 模型调用结束后才开启写事务，任何节点、消息或连边保存失败均整体回滚。
        return transactions.execute(status -> {
            requireNewChildren(childIds);
            if (!source.equals(readSource(mapId, id)))
                throw new IllegalArgumentException("原 Tile 已发生变化，请同步图谱后重新拆分。");
            Long inheritedLabel = tiles.selectOne(Wrappers.<TileDO>lambdaQuery().eq(TileDO::getMapId, mapId)
                    .eq(TileDO::getTileId, id).last("FOR UPDATE")).getLabelId();
            LocalDateTime now = LocalDateTime.now();
            List<Child> children = new ArrayList<>();
            List<TileEdgeDO> links = new ArrayList<>();
            for (Content item : content) {
                String childId = childIds.get(children.size());
                TileDO tile = TileDO.builder().mapId(mapId).tileId(childId).tileType("QA")
                        .title(item.userMessage().substring(0, Math.min(255, item.userMessage().length())))
                        .userMessage(item.userMessage())
                        .answerSummary(item.answer().substring(0, Math.min(1000, item.answer().length())))
                        .weight(source.weight()).labelId(inheritedLabel).createTime(now).updateTime(now).build();
                tiles.insert(tile);
                messages.insert(TileMessageDO.builder().mapId(mapId).tileId(childId).role("user")
                        .content(item.userMessage()).createTime(now).build());
                messages.insert(TileMessageDO.builder().mapId(mapId).tileId(childId).role("assistant")
                        .content(item.answer()).createTime(now).build());
                TileEdgeDO link = TileEdgeDO.builder().mapId(mapId).edgeId("edge-" + UUID.randomUUID())
                        .sourceTileId(id).targetTileId(childId).direction("DIRECTED").relationType("DIVIDES")
                        .weight(BigDecimal.ONE).description(requirements.isEmpty() ? "手动拆分" : "手动拆分：" + requirements)
                        .createTime(now).updateTime(now).build();
                edges.insert(link);
                children.add(new Child(tile, item.answer()));
                links.add(link);
            }
            return new Result(List.copyOf(children), List.copyOf(links));
        });
    }

    private void requireNewChildren(List<String> childIds) {
        if (tiles.selectCount(Wrappers.<TileDO>lambdaQuery().in(TileDO::getTileId, childIds)) > 0)
            throw new AlreadySplitException();
    }

    private Source readSource(String mapId, String id) {
        TileDO tile = tiles.selectOne(Wrappers.<TileDO>lambdaQuery().eq(TileDO::getMapId, mapId).eq(TileDO::getTileId, id));
        if (tile == null) throw new IllegalArgumentException("原 Tile 已不存在或不属于当前图谱，请同步图谱后重试。");
        if (tile.getTileType() != null && !"QA".equals(tile.getTileType()))
            throw new IllegalArgumentException("请选择一个 AI 问答 Tile；便签和文件不能拆分。");
        var replies = messages.selectList(Wrappers.<TileMessageDO>lambdaQuery().eq(TileMessageDO::getMapId, mapId)
                .eq(TileMessageDO::getTileId, id).eq(TileMessageDO::getRole, "assistant").orderByAsc(TileMessageDO::getId));
        String answer = replies.isEmpty() ? tile.getAnswerSummary() : replies.get(replies.size() - 1).getContent();
        if (tile.getUserMessage() == null || tile.getUserMessage().isBlank() || answer == null || answer.isBlank())
            throw new IllegalArgumentException("只能拆分已完成且有问题和回答的 AI 问答 Tile。");
        return new Source(id, tile.getWeight() == null ? 1 : tile.getWeight(), tile.getUserMessage(), answer);
    }

    private Map<String, Object> call(ChatModel model, Prompt prompt) {
        var response = model.call(prompt);
        String json = response.getResult().getOutput().getText();
        if (json == null) throw new IllegalStateException();
        json = json.trim();
        if (json.startsWith("```json") && json.endsWith("```")) json = json.substring(7, json.length() - 3).trim();
        else if (json.startsWith("```") && json.endsWith("```")) json = json.substring(3, json.length() - 3).trim();
        return JsonUtil.parseMap(json, String.class, Object.class);
    }

    private List<Content> parseContent(Map<String, Object> output, Source source) {
        if (output == null || !(output.get("tiles") instanceof List<?> list) || list.size() < 2 || list.size() > 4)
            throw new IllegalStateException();
        var questions = new HashSet<String>();
        questions.add(source.userMessage().trim().toLowerCase(Locale.ROOT));
        var result = new ArrayList<Content>();
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> fields) || !(fields.get("userMessage") instanceof String question)
                    || !(fields.get("answer") instanceof String answer) || question.isBlank() || answer.isBlank()
                    || question.length() > 10000 || answer.length() > 100000
                    || !questions.add(question.trim().toLowerCase(Locale.ROOT))) throw new IllegalStateException();
            result.add(new Content(question.trim(), answer.trim()));
        }
        return List.copyOf(result);
    }
}
