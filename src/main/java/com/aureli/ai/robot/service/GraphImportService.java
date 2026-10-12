package com.aureli.ai.robot.service;

import com.aureli.ai.robot.controller.TileWorkspaceController.Node;
import com.aureli.ai.robot.controller.TileWorkspaceController.Edge;
import com.aureli.ai.robot.domain.TileRelationTypes;
import com.aureli.ai.robot.domain.dos.*;
import com.aureli.ai.robot.domain.mapper.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.*;

/** Imports an exported snapshot into a new map in one transaction. */
@Service
public class GraphImportService {
    private final MapMapper maps;
    private final TileMapper tiles;
    private final TileMessageMapper messages;
    private final TileEdgeMapper edges;
    private final LabelMapper labels;

    public GraphImportService(MapMapper maps, TileMapper tiles, TileMessageMapper messages,
                              TileEdgeMapper edges, LabelMapper labels) {
        this.maps = maps; this.tiles = tiles; this.messages = messages; this.edges = edges; this.labels = labels;
    }

    public record Point(double x, double y) {}
    public record Imported(MapDO map, List<Node> tiles, List<Edge> edges, List<LabelDO> labels, Map<String, Point> layout) {}
    private record Snapshot(String name, List<Node> tiles, List<Edge> edges, List<LabelDO> labels, Map<String, Point> layout) {}

    @Transactional
    public Imported importGraph(JsonNode document) {
        // Validate every reference before the first write. All IDs are regenerated because
        // the database also has global uniqueness constraints on Tile and edge IDs.
        Snapshot snapshot = validate(document);
        var now = LocalDateTime.now();
        var map = MapDO.builder().mapId("map-" + UUID.randomUUID()).name(snapshot.name())
                .createTime(now).updateTime(now).build();
        maps.insert(map);
        Map<Long, Long> labelIds = new HashMap<>();
        List<LabelDO> importedLabels = new ArrayList<>();
        for (var source : snapshot.labels()) {
            var label = LabelDO.builder().mapId(map.getMapId()).name(source.getName()).colorHex(source.getColorHex())
                    .createTime(now).updateTime(now).build();
            labels.insert(label);
            labelIds.put(source.getId(), label.getId());
            importedLabels.add(label);
        }
        Map<String, String> tileIds = new LinkedHashMap<>();
        for (var source : snapshot.tiles()) tileIds.put(source.id(), "tile-" + UUID.randomUUID());
        for (var source : snapshot.tiles()) {
            String id = tileIds.get(source.id());
            var tile = TileDO.builder().mapId(map.getMapId()).tileId(id).tileType(source.tileType())
                    .title(source.title()).content(source.content()).userMessage(source.message()).answerSummary(source.answer())
                    .weight(source.weight()).labelId(labelIds.get(source.labelId())).fileName(source.fileName())
                    .fileContentType(source.fileContentType()).fileSize(source.fileSize()).createTime(now).updateTime(now).build();
            tiles.insert(tile);
            if ("QA".equals(source.tileType())) {
                messages.insert(TileMessageDO.builder().mapId(map.getMapId()).tileId(id).role("user")
                        .content(source.message()).createTime(now).build());
                messages.insert(TileMessageDO.builder().mapId(map.getMapId()).tileId(id).role("assistant")
                        .content(source.answer()).createTime(now).build());
            }
        }
        List<Edge> importedEdges = new ArrayList<>();
        Map<String, List<String>> parents = new HashMap<>();
        for (var source : snapshot.edges()) {
            var edge = TileEdgeDO.builder().mapId(map.getMapId()).edgeId("edge-" + UUID.randomUUID())
                    .sourceTileId(tileIds.get(source.sourceTileId())).targetTileId(tileIds.get(source.targetTileId()))
                    .direction(source.direction()).relationType(source.relationType()).weight(source.weight())
                    .description(source.description()).createTime(now).updateTime(now).build();
            edges.insert(edge);
            importedEdges.add(new Edge(edge.getEdgeId(), edge.getSourceTileId(), edge.getTargetTileId(),
                    edge.getDirection(), edge.getRelationType(), edge.getWeight(), edge.getDescription()));
            var list = parents.computeIfAbsent(edge.getTargetTileId(), key -> new ArrayList<>());
            if (!list.contains(edge.getSourceTileId())) list.add(edge.getSourceTileId());
        }
        List<Node> importedTiles = snapshot.tiles().stream().map(source -> {
            String id = tileIds.get(source.id()), type = source.tileType();
            var related = parents.getOrDefault(id, List.of());
            String kind = "QA".equals(type) ? related.isEmpty() ? "root" : "memory" : type.toLowerCase(Locale.ROOT);
            String answer = "NOTE".equals(type) ? source.content() : "FILE".equals(type) ? source.fileName() : source.answer();
            return new Node(id, "QA".equals(type) ? source.message() : source.title(), answer, related, "ready", kind,
                    source.weight(), type, source.title(), source.content(), source.fileName(), source.fileContentType(),
                    source.fileSize(), labelIds.get(source.labelId()));
        }).toList();
        Map<String, Point> layout = new LinkedHashMap<>();
        snapshot.layout().forEach((id, point) -> layout.put(tileIds.get(id), point));
        return new Imported(map, importedTiles, importedEdges, importedLabels, layout);
    }

    private Snapshot validate(JsonNode data) {
        object(data, "根节点");
        String name = text(data.get("name"), "name", true, 100).trim();
        var sourceTiles = array(data.get("tiles"), "tiles");
        var sourceEdges = array(data.get("edges"), "edges");
        if (sourceTiles.size() > 10000 || sourceEdges.size() > 50000) invalid("节点或关联数量过多。");
        List<LabelDO> labelList = new ArrayList<>();
        Set<Long> labelIds = new HashSet<>(); Set<String> labelNames = new HashSet<>();
        if (present(data.get("labels"))) for (var value : array(data.get("labels"), "labels")) {
            object(value, "labels[]");
            Long id = whole(value.get("id"), "labels[].id", false);
            String labelName = text(value.get("name"), "labels[].name", true, 100).trim();
            String color = text(value.get("colorHex"), "labels[].colorHex", true, 7);
            if (id <= 0 || !labelIds.add(id) || !labelNames.add(labelName) || !color.matches("#[0-9a-fA-F]{6}"))
                invalid("标签 ID、名称或颜色无效或重复。");
            labelList.add(LabelDO.builder().id(id).name(labelName).colorHex(color).build());
        }
        List<Node> nodes = new ArrayList<>(); Set<String> ids = new HashSet<>();
        for (var value : sourceTiles) {
            object(value, "tiles[]");
            String id = text(value.get("id"), "tiles[].id", true, 128);
            if (!ids.add(id)) invalid("节点 ID 重复：" + id);
            String type = present(value.get("tileType")) ? text(value.get("tileType"), "tileType", true, 16) : "QA";
            if (!Set.of("QA", "NOTE", "FILE").contains(type)) invalid("节点类型无效。");
            String message = text(value.get("message"), "message", true, Integer.MAX_VALUE);
            String answer = text(value.get("answer"), "answer", false, Integer.MAX_VALUE);
            Long weight = present(value.get("weight")) ? whole(value.get("weight"), "weight", false) : 1L;
            if (weight < 1 || weight > 3) invalid("节点权重必须是 1、2 或 3。");
            Long labelId = whole(value.get("labelId"), "labelId", true);
            if (labelId != null && !labelIds.contains(labelId)) invalid("节点引用了不存在的标签。");
            List<String> related = new ArrayList<>();
            if (present(value.get("relatedTileIds"))) for (var parent : array(value.get("relatedTileIds"), "relatedTileIds"))
                related.add(text(parent, "relatedTileIds[]", true, 128));
            String title = present(value.get("title")) ? text(value.get("title"), "title", false, 255) : "QA".equals(type) ? "" : message;
            if (title.length() > 255) invalid("节点标题不能超过 255 个字符。");
            String content = present(value.get("content")) ? text(value.get("content"), "content", false, Integer.MAX_VALUE) : "NOTE".equals(type) ? answer : "";
            String fileName = present(value.get("fileName")) ? text(value.get("fileName"), "fileName", false, 512) : "FILE".equals(type) ? message : "";
            if (fileName.length() > 512) invalid("文件名称不能超过 512 个字符。");
            Long size = whole(value.get("fileSize"), "fileSize", true);
            if (size != null && size < 0) invalid("文件大小无效。");
            nodes.add(new Node(id, message, answer, related, "ready", "", weight.intValue(), type, title, content, fileName,
                    text(value.get("fileContentType"), "fileContentType", false, 128), size, labelId));
        }
        for (var node : nodes) for (var parent : node.relatedTileIds())
            if (!ids.contains(parent) || parent.equals(node.id())) invalid("节点引用了不存在的关联或自身。");
        List<Edge> links = new ArrayList<>(); Set<String> edgeIds = new HashSet<>(); Set<List<String>> pairs = new HashSet<>();
        for (var value : sourceEdges) {
            object(value, "edges[]");
            String id = text(value.get("id"), "edges[].id", true, 128);
            String source = text(value.get("sourceTileId"), "sourceTileId", true, 128);
            String target = text(value.get("targetTileId"), "targetTileId", true, 128);
            if (!edgeIds.add(id) || !ids.contains(source) || !ids.contains(target) || source.equals(target)) invalid("关联 ID、起点或终点无效。");
            String direction = present(value.get("direction")) ? text(value.get("direction"), "direction", true, 32) : "DIRECTED";
            if (!Set.of("DIRECTED", "UNDIRECTED").contains(direction)) invalid("关联方向无效。");
            double weight = present(value.get("weight")) ? number(value.get("weight"), "edges[].weight") : 1;
            if (weight < 0 || weight > 1) invalid("关联权重必须介于 0 和 1 之间。");
            String relation = text(value.get("relationType"), "relationType", false, 64);
            if (Set.of("DEVIDES", "DIVIEDS").contains(relation)) relation = "DIVIDES";
            if (!Set.of("FUSES", "DIVIDES").contains(relation)) relation = TileRelationTypes.forDirection(direction);
            links.add(new Edge(id, source, target, direction, relation, BigDecimal.valueOf(weight),
                    text(value.get("description"), "description", false, Integer.MAX_VALUE)));
            pairs.add(List.of(source, target));
        }
        for (var node : nodes) for (var parent : node.relatedTileIds()) if (pairs.add(List.of(parent, node.id())))
            links.add(new Edge("", parent, node.id(), "DIRECTED", "EXTENDS", BigDecimal.ONE, ""));
        Map<String, Point> layout = new LinkedHashMap<>();
        if (present(data.get("layout"))) {
            var sourceLayout = data.get("layout"); object(sourceLayout, "layout");
            for (var entry : sourceLayout.properties()) {
                if (!ids.contains(entry.getKey())) invalid("布局引用了不存在的节点。");
                object(entry.getValue(), "layout[]");
                layout.put(entry.getKey(), new Point(number(entry.getValue().get("x"), "layout.x"), number(entry.getValue().get("y"), "layout.y")));
            }
        }
        return new Snapshot(name, nodes, links, labelList, layout);
    }

    private static boolean present(JsonNode value) { return value != null && !value.isNull(); }
    private static void invalid(String message) { throw new IllegalArgumentException("JSON 格式错误：" + message); }
    private static void object(JsonNode value, String path) { if (value == null || !value.isObject()) invalid(path + " 必须是对象。"); }
    private static JsonNode array(JsonNode value, String path) {
        if (value == null || !value.isArray()) invalid(path + " 必须是数组。");
        return value;
    }
    private static String text(JsonNode value, String path, boolean required, int max) {
        if (!present(value) && !required) return "";
        if (value == null || !value.isString()) invalid(path + " 必须是文本。");
        String result = value.asString();
        if ((required && result.isBlank()) || result.length() > max) invalid(path + " 为空或长度超出限制。");
        return result;
    }
    private static Long whole(JsonNode value, String path, boolean optional) {
        if (!present(value) && optional) return null;
        if (value == null || !value.isIntegralNumber() || !value.canConvertToLong()) invalid(path + " 必须是整数。");
        return value.longValue();
    }
    private static double number(JsonNode value, String path) {
        if (value == null || !value.isNumber() || !Double.isFinite(value.doubleValue())) invalid(path + " 必须是有限数值。");
        return value.doubleValue();
    }
}
