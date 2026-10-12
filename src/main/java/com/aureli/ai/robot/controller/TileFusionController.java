package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.model.vo.customerService.FuseTilesReqVO;
import com.aureli.ai.robot.service.TileFusionService;
import com.aureli.ai.robot.utils.Response;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/customer-service/tile")
public class TileFusionController {
    private final TileFusionService fusion;
    public TileFusionController(TileFusionService fusion) { this.fusion = fusion; }

    public record Replacement(List<TileWorkspaceController.Node> tiles, List<TileWorkspaceController.Edge> edges,
                              List<String> deletedTileIds) {}

    /** An explicit route prevents older servers from silently ignoring an overwrite flag. */
    @PostMapping("/fusion/overwrite")
    public ResponseEntity<Response<?>> overwrite(@RequestBody @Validated FuseTilesReqVO request) {
        return fuse(new FuseTilesReqVO(request.tileId(), request.sourceTileIds(), request.mapId(), true));
    }

    @PostMapping("/fusion")
    public ResponseEntity<Response<?>> fuse(@RequestBody @Validated FuseTilesReqVO request) {
        try {
            var result = fusion.fuse(request);
            var tile = result.tile();
            var parents = result.edges().stream().filter(edge -> edge.getTargetTileId().equals(tile.getTileId()))
                    .map(edge -> edge.getSourceTileId()).distinct().toList();
            var node = new TileWorkspaceController.Node(tile.getTileId(), tile.getUserMessage(), result.answer(),
                    parents, "ready", parents.isEmpty() ? "root" : "memory", tile.getWeight(), "QA", tile.getTitle(), null, null, null, null, tile.getLabelId());
            var edges = result.edges().stream().map(edge -> new TileWorkspaceController.Edge(edge.getEdgeId(),
                    edge.getSourceTileId(), edge.getTargetTileId(), edge.getDirection(), edge.getRelationType(),
                    edge.getWeight(), edge.getDescription())).toList();
            return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                    .body(Response.success(request.overwrite()
                            ? new Replacement(List.of(node), edges, result.deletedTileIds())
                            : new TileWorkspaceController.Workspace(List.of(node), edges)));
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(Response.fail(error.getMessage()));
        } catch (RuntimeException error) {
            return ResponseEntity.internalServerError().body(Response.fail("融合生成或保存失败，请同步图谱并检查模型服务后重试。"));
        }
    }
}
