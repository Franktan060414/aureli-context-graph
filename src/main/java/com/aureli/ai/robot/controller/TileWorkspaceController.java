package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.TileRelationTypes;

import com.aureli.ai.robot.domain.maps.MapIds;
import com.aureli.ai.robot.domain.dos.TileDO;
import com.aureli.ai.robot.domain.dos.TileEdgeDO;
import com.aureli.ai.robot.domain.dos.TileMessageDO;
import com.aureli.ai.robot.domain.mapper.TileMapper;
import com.aureli.ai.robot.domain.mapper.TileEdgeMapper;
import com.aureli.ai.robot.domain.mapper.TileMessageMapper;
import com.aureli.ai.robot.model.vo.customerService.UpdateTileWeightReqVO;
import com.aureli.ai.robot.model.vo.customerService.SaveTileNoteReqVO;
import com.aureli.ai.robot.utils.Response;
import com.aureli.ai.robot.reader.TileFileContentReader;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.dao.DuplicateKeyException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.time.LocalDateTime;

/** Tile workspace snapshots and weight updates. */
@RestController
@RequestMapping("/customer-service")
public class TileWorkspaceController {
    private final TileMapper tiles;
    private final TileEdgeMapper edges;
    private final TileMessageMapper messages;
    private final TileFileContentReader fileContentReader;
    public TileWorkspaceController(TileMapper tiles, TileEdgeMapper edges, TileMessageMapper messages, TileFileContentReader fileContentReader) {
        this.tiles = tiles;
        this.edges = edges;
        this.messages = messages;
        this.fileContentReader = fileContentReader;
    }

    @GetMapping("/tile/workspace")
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public ResponseEntity<Response<Workspace>> workspace(@RequestParam String mapId) {
        mapId = MapIds.normalize(mapId);
        List<TileDO> nodes = tiles.selectList(Wrappers.<TileDO>lambdaQuery().eq(TileDO::getMapId, mapId).orderByAsc(TileDO::getId));
        List<TileEdgeDO> links = edges.selectList(Wrappers.<TileEdgeDO>lambdaQuery().eq(TileEdgeDO::getMapId, mapId).orderByAsc(TileEdgeDO::getId));
        Map<String, String> answers = new HashMap<>();
        messages.selectList(Wrappers.<TileMessageDO>lambdaQuery()
                .eq(TileMessageDO::getMapId, mapId).eq(TileMessageDO::getRole, "assistant").orderByAsc(TileMessageDO::getId))
                .forEach(message -> answers.put(message.getTileId(), message.getContent()));
        List<Node> result = nodes.stream().map(tile -> {
            List<String> parents = links.stream().filter(edge -> edge.getTargetTileId().equals(tile.getTileId()))
                    .map(TileEdgeDO::getSourceTileId).distinct().toList();
            return node(tile, parents, answers.getOrDefault(tile.getTileId(), tile.getAnswerSummary()));
        }).toList();
        List<Edge> connections = links.stream().map(edge -> new Edge(edge.getEdgeId(),
                edge.getSourceTileId(), edge.getTargetTileId(), edge.getDirection(),
                TileRelationTypes.forEdge(edge), edge.getWeight(), edge.getDescription())).toList();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(Response.success(new Workspace(result, connections)));
    }

    @PostMapping("/tile/note")
    @Transactional
    public Response<Node> createNote(@RequestBody @Validated SaveTileNoteReqVO request) {
        TileDO tile = TileDO.builder().mapId(MapIds.normalize(request.mapId())).tileId(request.tileId().trim()).tileType("NOTE")
                .title(request.title().trim()).content(request.content()).build();
        return insertNode(tile, validateParents(tile.getMapId(), tile.getTileId(), request.relatedTileIds()));
    }

    @PostMapping("/tile/note/update")
    @Transactional
    public Response<Node> updateNote(@RequestBody @Validated SaveTileNoteReqVO request) {
        String mapId = MapIds.normalize(request.mapId());
        List<String> requestedParents = request.relatedTileIds() == null ? null
                : validateParents(mapId, request.tileId().trim(), request.relatedTileIds());
        int updated = tiles.update(null, Wrappers.<TileDO>lambdaUpdate()
                .eq(TileDO::getMapId, mapId).eq(TileDO::getTileId, request.tileId().trim()).eq(TileDO::getTileType, "NOTE")
                .set(TileDO::getTitle, request.title().trim()).set(TileDO::getContent, request.content())
                .set(TileDO::getUpdateTime, LocalDateTime.now()));
        if (updated == 0) return Response.fail("便签不存在，请同步图谱后重试");
        TileDO tile = tiles.selectOne(Wrappers.<TileDO>lambdaQuery().eq(TileDO::getMapId, mapId).eq(TileDO::getTileId, request.tileId().trim()));
        if (requestedParents != null) syncParents(mapId, tile.getTileId(), requestedParents);
        List<String> parents = edges.selectList(Wrappers.<TileEdgeDO>lambdaQuery()
                .eq(TileEdgeDO::getMapId, mapId).eq(TileEdgeDO::getTargetTileId, tile.getTileId())).stream()
                .map(TileEdgeDO::getSourceTileId).distinct().toList();
        return Response.success(node(tile, parents, null));
    }

    @PostMapping(value = "/tile/file", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Transactional(rollbackFor = Exception.class)
    public Response<Node> uploadFile(@RequestParam("file") MultipartFile file,
                                     @RequestParam(value = "relatedTileIds", required = false) List<String> relatedTileIds,
                                     @RequestParam String mapId) throws IOException {
        mapId = MapIds.normalize(mapId);
        if (file.isEmpty()) return Response.fail("请选择非空文件");
        if (file.getSize() > 10 * 1024 * 1024) return Response.fail("文件大小不能超过 10 MB");
        String name = file.getOriginalFilename();
        if (name == null) return Response.fail("文件名称不能为空");
        name = name.replace('\\', '/');
        name = name.substring(name.lastIndexOf('/') + 1).replaceAll("[\\p{Cntrl}]", "").trim();
        if (name.isBlank() || name.length() > 512) return Response.fail("文件名称应为 1 至 512 个字符");
        String contentType = file.getContentType();
        if (contentType == null || contentType.length() > 128) contentType = MediaType.APPLICATION_OCTET_STREAM_VALUE;
        byte[] fileData = file.getBytes();
        String content;
        try {
            content = fileContentReader.extractContent(name, fileData);
        } catch (IOException exception) {
            return Response.fail(exception.getMessage());
        }
        TileDO tile = TileDO.builder().mapId(mapId).tileId("file-" + UUID.randomUUID()).tileType("FILE")
                .title(name.substring(0, Math.min(name.length(), 255))).fileName(name)
                .content(content).fileContentType(contentType).fileSize(file.getSize()).fileData(fileData).build();
        return insertNode(tile, validateParents(mapId, tile.getTileId(), relatedTileIds));
    }

    @GetMapping("/tile/{tileId}/file")
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public ResponseEntity<byte[]> downloadFile(@PathVariable String tileId, @RequestParam String mapId) {
        mapId = MapIds.normalize(mapId);
        TileDO tile = tiles.selectOne(Wrappers.<TileDO>lambdaQuery()
                .eq(TileDO::getMapId, mapId).eq(TileDO::getTileId, tileId).eq(TileDO::getTileType, "FILE"));
        if (tile == null) return ResponseEntity.notFound().build();
        TileDO attachment = tiles.selectFileData(mapId, tileId);
        byte[] data = attachment == null ? null : attachment.getFileData();
        if (data == null) return ResponseEntity.notFound().build();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(tile.getFileName(), StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff").contentLength(data.length).body(data);
    }

    @ExceptionHandler(DuplicateKeyException.class)
    public Response<?> duplicateId() { return Response.fail("节点 ID 已存在，请使用新的 ID"); }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public Response<?> oversizedFile() { return Response.fail("文件大小不能超过 10 MB"); }

    @ExceptionHandler(InvalidContextException.class)
    public Response<?> invalidContext(InvalidContextException exception) { return Response.fail(exception.getMessage()); }

    private static class InvalidContextException extends RuntimeException {
        InvalidContextException(String message) { super(message); }
    }

    private List<String> validateParents(String mapId, String tileId, List<String> requested) {
        if (requested == null || requested.isEmpty()) return List.of();
        if (requested.size() > 1000) throw new InvalidContextException("关联节点不能超过 1000 个");
        if (requested.stream().anyMatch(id -> id == null || id.isBlank() || id.trim().length() > 128))
            throw new InvalidContextException("关联节点 ID 无效");
        List<String> parents = requested.stream().map(String::trim).distinct().toList();
        if (parents.contains(tileId)) throw new InvalidContextException("节点不能关联自身");
        Set<String> existing = tiles.selectList(Wrappers.<TileDO>lambdaQuery()
                .eq(TileDO::getMapId, mapId).in(TileDO::getTileId, parents)).stream().map(TileDO::getTileId).collect(Collectors.toSet());
        if (!existing.containsAll(parents)) throw new InvalidContextException("关联节点不存在，请同步图谱后重试");
        return parents;
    }

    // Keep metadata on retained links and leave outgoing links untouched.
    private void syncParents(String mapId, String tileId, List<String> parents) {
        List<TileEdgeDO> incoming = edges.selectList(Wrappers.<TileEdgeDO>lambdaQuery().eq(TileEdgeDO::getMapId, mapId).eq(TileEdgeDO::getTargetTileId, tileId));
        for (TileEdgeDO edge : incoming) {
            if (!parents.contains(edge.getSourceTileId())) edges.deleteById(edge.getId());
        }
        Set<String> existing = incoming.stream().map(TileEdgeDO::getSourceTileId).collect(Collectors.toSet());
        LocalDateTime now = LocalDateTime.now();
        for (String parent : parents) {
            if (!existing.contains(parent)) edges.insert(TileEdgeDO.builder().mapId(mapId).edgeId("edge-" + UUID.randomUUID())
                    .sourceTileId(parent).targetTileId(tileId).direction("DIRECTED").relationType("EXTENDS")
                    .weight(java.math.BigDecimal.ONE).createTime(now).updateTime(now).build());
        }
    }

    private Response<Node> insertNode(TileDO tile, List<String> parents) {
        LocalDateTime now = LocalDateTime.now();
        tile.setCreateTime(now);
        tile.setUpdateTime(now);
        tiles.insert(tile);
        if (!parents.isEmpty()) syncParents(tile.getMapId(), tile.getTileId(), parents);
        return Response.success(node(tile, parents, null));
    }

    private Node node(TileDO tile, List<String> parents, String answer) {
        String type = tile.getTileType() == null ? "QA" : tile.getTileType();
        boolean qa = "QA".equals(type);
        return new Node(tile.getTileId(), qa ? tile.getUserMessage() : tile.getTitle(),
                qa ? answer : "NOTE".equals(type) ? tile.getContent() : tile.getFileName(), parents,
                "ready", qa ? parents.isEmpty() ? "root" : "memory" : type.toLowerCase(java.util.Locale.ROOT),
                tile.getWeight(), type, tile.getTitle(), tile.getContent(),
                tile.getFileName(), tile.getFileContentType(), tile.getFileSize());
    }

    @PostMapping("/tile/weight")
    @Transactional
    public Response<?> updateWeight(@RequestBody @Validated UpdateTileWeightReqVO request) {
        int updated = tiles.update(null, Wrappers.<TileDO>lambdaUpdate()
                .eq(TileDO::getMapId, MapIds.normalize(request.getMapId())).eq(TileDO::getTileId, request.getTileId())
                .set(TileDO::getWeight, request.getWeight())
                .set(TileDO::getUpdateTime, LocalDateTime.now()));
        return updated == 0 ? Response.fail("Tile 不存在，请同步图谱后重试") : Response.success();
    }

    public record Node(String id, String message, String answer, List<String> relatedTileIds, String status, String kind,
                       Integer weight, String tileType, String title, String content,
                       String fileName, String fileContentType, Long fileSize) {}
    public record Edge(String id, String sourceTileId, String targetTileId, String direction,
                       String relationType, java.math.BigDecimal weight, String description) {}
    public record Workspace(List<Node> tiles, List<Edge> edges) {}
}
