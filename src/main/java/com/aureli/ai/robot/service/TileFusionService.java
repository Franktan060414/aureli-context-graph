package com.aureli.ai.robot.service;

import com.aureli.ai.robot.domain.dos.TileDO;
import com.aureli.ai.robot.domain.dos.TileEdgeDO;
import com.aureli.ai.robot.domain.dos.TileMessageDO;
import com.aureli.ai.robot.domain.mapper.TileMapper;
import com.aureli.ai.robot.domain.mapper.TileEdgeMapper;
import com.aureli.ai.robot.domain.mapper.TileMessageMapper;
import com.aureli.ai.robot.model.vo.customerService.FuseTilesReqVO;
import com.aureli.ai.robot.prompt.TileFusionPrompts;
import com.aureli.ai.robot.prompt.TileFusionPrompts.Source;
import com.aureli.ai.robot.prompt.TileFusionPrompts.FusedContent;
import com.aureli.ai.robot.service.model.ModelApiSettingsService;
import com.aureli.ai.robot.utils.JsonUtil;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class TileFusionService {
    private final TileMapper tiles;
    private final TileMessageMapper messages;
    private final TileEdgeMapper edges;
    private final ModelApiSettingsService settings;
    private final TransactionTemplate transactions;

    public TileFusionService(TileMapper tiles, TileMessageMapper messages, TileEdgeMapper edges,
                             ModelApiSettingsService settings, TransactionTemplate transactions) {
        this.tiles = tiles;
        this.messages = messages;
        this.edges = edges;
        this.settings = settings;
        this.transactions = transactions;
    }

    public record Result(TileDO tile, String answer, List<TileEdgeDO> edges) {}

    public Result fuse(FuseTilesReqVO request) {
        String tileId = request.tileId().trim();
        List<String> ids = request.sourceTileIds().stream().map(String::trim).distinct().toList();
        if (ids.contains(tileId)) throw new IllegalArgumentException("新 Tile ID 不能与来源 Tile 相同。");
        List<Source> sources = transactions.execute(status -> {
            requireNewId(tileId);
            return readSources(ids);
        });

        // 网络调用不占用数据库事务；模型输出通过校验后才写入任何数据。
        FusedContent content;
        try {
            var response = settings.chatModel().call(TileFusionPrompts.fusion(sources));
            String json = response.getResult().getOutput().getText();
            if (json == null) throw new IllegalStateException();
            json = json.trim();
            // 兼容部分本地模型把 JSON 包在 Markdown 围栏中的行为。
            if (json.startsWith("```json") && json.endsWith("```")) json = json.substring(7, json.length() - 3).trim();
            else if (json.startsWith("```") && json.endsWith("```")) json = json.substring(3, json.length() - 3).trim();
            Map<String, Object> fields = JsonUtil.parseMap(json, String.class, Object.class);
            if (fields == null || !(fields.get("userMessage") instanceof String question) || question.isBlank()
                    || !(fields.get("answer") instanceof String answer) || answer.isBlank()) throw new IllegalStateException();
            content = new FusedContent(question, answer);
        } catch (RuntimeException error) {
            // 不向浏览器暴露模型连接凭据或含有来源全文的解析异常。
            throw new IllegalStateException("融合生成失败，模型未返回有效的问题和回答，请检查模型服务后重试。");
        }
        return transactions.execute(status -> {
            requireNewId(tileId);
            if (!sources.equals(readSources(ids)))
                throw new IllegalArgumentException("来源 Tile 已发生变化，请同步图谱后重新融合。");
            LocalDateTime now = LocalDateTime.now();
            String question = content.userMessage().trim(), answer = content.answer().trim();
            TileDO tile = TileDO.builder().tileId(tileId).tileType("QA")
                    .title(question.substring(0, Math.min(255, question.length())))
                    .userMessage(question).answerSummary(answer.substring(0, Math.min(1000, answer.length())))
                    .weight(sources.stream().mapToInt(Source::weight).max().orElseThrow())
                    .createTime(now).updateTime(now).build();
            tiles.insert(tile);
            messages.insert(TileMessageDO.builder().tileId(tileId).role("user").content(question).createTime(now).build());
            messages.insert(TileMessageDO.builder().tileId(tileId).role("assistant").content(answer).createTime(now).build());
            List<TileEdgeDO> links = sources.stream().map(source -> TileEdgeDO.builder()
                    .edgeId("edge-" + UUID.randomUUID()).sourceTileId(source.tileId()).targetTileId(tileId)
                    .direction("DIRECTED").relationType("FUSES").weight(BigDecimal.ONE)
                    .createTime(now).updateTime(now).build()).toList();
            links.forEach(edges::insert);
            return new Result(tile, answer, links);
        });
    }

    private void requireNewId(String id) {
        if (tiles.selectCount(Wrappers.<TileDO>lambdaQuery().eq(TileDO::getTileId, id)) > 0)
            throw new IllegalArgumentException("新 Tile ID 已存在，请同步图谱后重试。");
    }

    private List<Source> readSources(List<String> ids) {
        Map<String, TileDO> byId = new HashMap<>();
        tiles.selectList(Wrappers.<TileDO>lambdaQuery().in(TileDO::getTileId, ids))
                .forEach(tile -> byId.put(tile.getTileId(), tile));
        if (!byId.keySet().containsAll(ids)) throw new IllegalArgumentException("选中的 Tile 已不存在，请同步图谱后重试。");
        List<TileDO> qa = ids.stream().map(byId::get)
                .filter(tile -> tile.getTileType() == null || "QA".equals(tile.getTileType())).toList();
        if (qa.size() < 2) throw new IllegalArgumentException("请至少选择两个 AI 问答 Tile；便签和文件不会参与融合。");
        Map<String, String> answers = new HashMap<>();
        messages.selectList(Wrappers.<TileMessageDO>lambdaQuery()
                .in(TileMessageDO::getTileId, qa.stream().map(TileDO::getTileId).toList())
                .eq(TileMessageDO::getRole, "assistant").orderByAsc(TileMessageDO::getId))
                .forEach(message -> answers.put(message.getTileId(), message.getContent()));
        return qa.stream().map(tile -> {
            String answer = answers.getOrDefault(tile.getTileId(), tile.getAnswerSummary());
            if (tile.getUserMessage() == null || tile.getUserMessage().isBlank() || answer == null || answer.isBlank())
                throw new IllegalArgumentException("只能融合已完成且有问题和回答的 AI 问答 Tile。");
            int weight = tile.getWeight() == null ? 1 : tile.getWeight();
            return new Source(tile.getTileId(), weight, tile.getUserMessage(), answer);
        }).toList();
    }
}
