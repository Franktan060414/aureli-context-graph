package com.aureli.ai.robot.service.web;

import com.aureli.ai.robot.controller.TileWorkspaceController;
import com.aureli.ai.robot.controller.TileWorkspaceController.Node;
import com.aureli.ai.robot.domain.dos.TileDO;
import com.aureli.ai.robot.domain.dos.TileEdgeDO;
import com.aureli.ai.robot.domain.mapper.MapMapper;
import com.aureli.ai.robot.domain.mapper.TileMapper;
import com.aureli.ai.robot.domain.mapper.TileEdgeMapper;
import com.aureli.ai.robot.domain.dos.MapDO;
import com.aureli.ai.robot.domain.maps.MapIds;
import com.aureli.ai.robot.service.search.TavilyMcpSearchService;
import com.aureli.ai.robot.service.search.TavilySettingsService;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;
import java.util.Objects;
import java.util.stream.Collectors;

@Service
public class WebTileService {
    private final TileMapper tiles;
    private final TileEdgeMapper edges;
    private final MapMapper maps;
    private final TavilyMcpSearchService extractor;
    private final TavilySettingsService settings;
    private final TransactionTemplate transaction;

    public WebTileService(TileMapper tiles, TileEdgeMapper edges, MapMapper maps,
                          TavilyMcpSearchService extractor, TavilySettingsService settings, TransactionTemplate transaction) {
        this.tiles = tiles; this.edges = edges; this.maps = maps;
        this.extractor = extractor; this.settings = settings; this.transaction = transaction;
    }

    public Node create(String rawMapId, String url, List<String> requestedParents) {
        String mapId = MapIds.normalize(rawMapId), source = WebPageUrls.validate(url);
        return transaction.execute(status -> {
            if (maps.selectCount(Wrappers.<MapDO>lambdaQuery().eq(MapDO::getMapId, mapId)) == 0)
                throw new IllegalArgumentException("图谱不存在，请同步后重试。");
            List<String> parents = requestedParents == null ? List.of() : requestedParents;
            if (parents.size() > 1000 || parents.stream().anyMatch(id -> id == null || id.isBlank() || id.trim().length() > 128))
                throw new IllegalArgumentException("关联节点 ID 无效或数量超过 1000 个。");
            parents = parents.stream().map(String::trim).distinct().toList();
            if (!parents.isEmpty()) {
                var existing = tiles.selectByTileIds(mapId, parents).stream().map(TileDO::getTileId).collect(Collectors.toSet());
                if (!existing.containsAll(parents)) throw new IllegalArgumentException("关联节点不存在，请同步图谱后重试。");
            }
            LocalDateTime now = LocalDateTime.now();
            var tile = TileDO.builder().mapId(mapId).tileId("web-" + UUID.randomUUID()).tileType("WEB")
                    .title(java.net.URI.create(source).getHost()).sourceUrl(source).fetchStatus("PENDING")
                    .createTime(now).updateTime(now).build();
            tiles.insert(tile);
            for (String parent : parents) edges.insert(TileEdgeDO.builder().mapId(mapId).edgeId("edge-" + UUID.randomUUID())
                    .sourceTileId(parent).targetTileId(tile.getTileId()).direction("DIRECTED").relationType("EXTENDS")
                    .weight(java.math.BigDecimal.ONE).createTime(now).updateTime(now).build());
            return TileWorkspaceController.node(tile, parents, null);
        });
    }

    /** Network I/O happens outside a DB transaction. Token guards concurrent refresh/deletion. */
    public Node refresh(String rawMapId, String tileId) {
        String mapId = MapIds.normalize(rawMapId);
        TileDO tile = requireTile(mapId, tileId);
        String token = UUID.randomUUID().toString();
        int claimed = tiles.update(null, Wrappers.<TileDO>lambdaUpdate()
                .eq(TileDO::getMapId, mapId).eq(TileDO::getTileId, tileId).eq(TileDO::getTileType, "WEB")
                .and(query -> query.ne(TileDO::getFetchStatus, "FETCHING").or().isNull(TileDO::getFetchStatus)
                        .or().lt(TileDO::getUpdateTime, LocalDateTime.now().minusMinutes(2)))
                .set(TileDO::getFetchStatus, "FETCHING").set(TileDO::getFetchError, null)
                .set(TileDO::getFetchToken, token).set(TileDO::getUpdateTime, LocalDateTime.now()));
        if (claimed == 0) throw new IllegalArgumentException("网页正在读取，请稍候；超过两分钟可重试。");
        String failure = null;
        TavilyMcpSearchService.WebPage page = null;
        try { page = extractor.extract(settings.snapshot(), tile.getSourceUrl()); }
        catch (TavilyMcpSearchService.WebPageReadException error) { failure = error.getMessage(); }
        catch (RuntimeException error) { failure = "网页读取失败，请检查 Tavily MCP 地址、API Key 和网络连接后重试。"; }
        var update = Wrappers.<TileDO>lambdaUpdate().eq(TileDO::getMapId, mapId)
                .eq(TileDO::getTileId, tileId).eq(TileDO::getFetchToken, token)
                .set(TileDO::getFetchToken, null).set(TileDO::getUpdateTime, LocalDateTime.now());
        if (failure != null) {
            update.set(TileDO::getFetchStatus, "FAILED").set(TileDO::getFetchError, failure);
        } else {
            Objects.requireNonNull(page);
            update.set(TileDO::getTitle, page.title()).set(TileDO::getContent, page.content())
                    .set(TileDO::getResolvedUrl, page.resolvedUrl()).set(TileDO::getFetchedAt, LocalDateTime.now())
                    .set(TileDO::getFetchStatus, "READY").set(TileDO::getFetchError, null);
        }
        tiles.update(null, update);
        return view(requireTile(mapId, tileId));
    }

    private TileDO requireTile(String mapId, String tileId) {
        var tile = tiles.selectOne(Wrappers.<TileDO>lambdaQuery().eq(TileDO::getMapId, mapId)
                .eq(TileDO::getTileId, tileId).eq(TileDO::getTileType, "WEB"));
        if (tile == null) throw new IllegalArgumentException("网页节点不存在，请同步图谱后重试。");
        return tile;
    }
    private Node view(TileDO tile) {
        var parents = edges.selectList(Wrappers.<TileEdgeDO>lambdaQuery().eq(TileEdgeDO::getMapId, tile.getMapId())
                .eq(TileEdgeDO::getTargetTileId, tile.getTileId())).stream().map(TileEdgeDO::getSourceTileId).distinct().toList();
        return TileWorkspaceController.node(tile, parents, null);
    }
}
