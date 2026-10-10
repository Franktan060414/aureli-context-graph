package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.model.vo.customerService.SplitTileReqVO;
import com.aureli.ai.robot.service.TileSplitService;
import com.aureli.ai.robot.utils.Response;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/customer-service/tile")
public class TileSplitController {
    private final TileSplitService splitting;
    public TileSplitController(TileSplitService splitting) { this.splitting = splitting; }

    @PostMapping("/split")
    public ResponseEntity<Response<?>> split(@RequestBody @Validated SplitTileReqVO request) {
        try {
            var result = splitting.split(request);
            var nodes = result.children().stream().map(child -> {
                var tile = child.tile();
                return new TileWorkspaceController.Node(tile.getTileId(), tile.getUserMessage(), child.answer(),
                        List.of(request.sourceTileId().trim()), "ready", "memory", tile.getWeight(), "QA",
                        tile.getTitle(), null, null, null, null, tile.getLabelId());
            }).toList();
            var edges = result.edges().stream().map(edge -> new TileWorkspaceController.Edge(edge.getEdgeId(),
                    edge.getSourceTileId(), edge.getTargetTileId(), edge.getDirection(), edge.getRelationType(),
                    edge.getWeight(), edge.getDescription())).toList();
            return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                    .body(Response.success(new TileWorkspaceController.Workspace(nodes, edges)));
        } catch (TileSplitService.NotSplittableException error) {
            return ResponseEntity.status(422).body(Response.fail("TILE_NOT_SPLITTABLE", "拆分失败：" + error.getMessage()));
        } catch (TileSplitService.AlreadySplitException error) {
            return ResponseEntity.status(409).body(Response.fail("TILE_SPLIT_ALREADY_SAVED", error.getMessage()));
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().body(Response.fail(error.getMessage()));
        } catch (RuntimeException error) {
            return ResponseEntity.internalServerError()
                    .body(Response.fail("拆分判断、生成或保存失败，请同步图谱并检查模型服务后重试。"));
        }
    }
}
