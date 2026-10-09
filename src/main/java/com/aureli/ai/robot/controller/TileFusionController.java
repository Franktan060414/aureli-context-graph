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

    @PostMapping("/fusion")
    public ResponseEntity<Response<?>> fuse(@RequestBody @Validated FuseTilesReqVO request) {
        try {
            var result = fusion.fuse(request);
            var tile = result.tile();
            var parents = result.edges().stream().map(edge -> edge.getSourceTileId()).toList();
            var node = new TileWorkspaceController.Node(tile.getTileId(), tile.getUserMessage(), result.answer(),
                    parents, "ready", "memory", tile.getWeight(), "QA", tile.getTitle(), null, null, null, null, tile.getLabelId());
            var edges = result.edges().stream().map(edge -> new TileWorkspaceController.Edge(edge.getEdgeId(),
                    edge.getSourceTileId(), edge.getTargetTileId(), edge.getDirection(), edge.getRelationType(),
                    edge.getWeight(), edge.getDescription())).toList();
            return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                    .body(Response.success(new TileWorkspaceController.Workspace(List.of(node), edges)));
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(Response.fail(error.getMessage()));
        } catch (RuntimeException error) {
            return ResponseEntity.internalServerError().body(Response.fail("融合生成或保存失败，请同步图谱并检查模型服务后重试。"));
        }
    }
}
