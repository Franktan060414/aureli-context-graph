package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.dos.LabelDO;
import com.aureli.ai.robot.domain.dos.TileDO;
import com.aureli.ai.robot.domain.mapper.LabelMapper;
import com.aureli.ai.robot.domain.mapper.TileMapper;
import com.aureli.ai.robot.domain.maps.MapIds;
import com.aureli.ai.robot.utils.Response;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import jakarta.validation.constraints.*;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import java.time.LocalDateTime;
import java.util.List;

@RestController
@RequestMapping("/customer-service")
public class LabelController {
    private final LabelMapper labels;
    private final TileMapper tiles;
    public LabelController(LabelMapper labels, TileMapper tiles) { this.labels = labels; this.tiles = tiles; }

    public record SaveLabel(@NotBlank @Size(max = 128) String mapId,
                            @NotBlank @Size(max = 100) String name,
                            @NotNull @Pattern(regexp = "^#[0-9A-Fa-f]{6}$") String colorHex) {}
    public record AssignLabel(@NotBlank @Size(max = 128) String mapId,
                              @NotEmpty @Size(max = 1000) List<@NotBlank @Size(max = 128) String> tileIds,
                              @Positive Long labelId) {}

    @GetMapping("/labels")
    public ResponseEntity<Response<List<LabelDO>>> list(@RequestParam String mapId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Response.success(labels.selectList(
                Wrappers.<LabelDO>lambdaQuery().eq(LabelDO::getMapId, MapIds.normalize(mapId)).orderByAsc(LabelDO::getId))));
    }

    @PostMapping("/labels")
    @Transactional
    public Response<LabelDO> create(@RequestBody @Validated SaveLabel request) {
        String mapId = lockMap(request.mapId());
        var now = LocalDateTime.now();
        var label = LabelDO.builder().mapId(mapId).name(request.name().trim())
                .colorHex(request.colorHex().toUpperCase(java.util.Locale.ROOT)).createTime(now).updateTime(now).build();
        labels.insert(label);
        return Response.success(label);
    }

    @PostMapping("/labels/{id}")
    @Transactional
    public Response<LabelDO> update(@PathVariable Long id, @RequestBody @Validated SaveLabel request) {
        String mapId = lockMap(request.mapId());
        requireLabel(mapId, id);
        labels.update(null, Wrappers.<LabelDO>lambdaUpdate().eq(LabelDO::getMapId, mapId).eq(LabelDO::getId, id)
                .set(LabelDO::getName, request.name().trim()).set(LabelDO::getColorHex, request.colorHex().toUpperCase(java.util.Locale.ROOT))
                .set(LabelDO::getUpdateTime, LocalDateTime.now()));
        return Response.success(requireLabel(mapId, id));
    }

    @DeleteMapping("/labels/{id}")
    @Transactional
    public Response<?> delete(@PathVariable Long id, @RequestParam String mapId) {
        mapId = lockMap(mapId);
        requireLabel(mapId, id);
        // 只清除标签引用；不能把复合外键中的 map_id 也设为 NULL。
        tiles.update(null, Wrappers.<TileDO>lambdaUpdate().eq(TileDO::getMapId, mapId).eq(TileDO::getLabelId, id)
                .set(TileDO::getLabelId, null).set(TileDO::getUpdateTime, LocalDateTime.now()));
        labels.delete(Wrappers.<LabelDO>lambdaQuery().eq(LabelDO::getMapId, mapId).eq(LabelDO::getId, id));
        return Response.success();
    }

    @PostMapping("/tile/label")
    @Transactional
    public Response<?> assign(@RequestBody @Validated AssignLabel request) {
        String mapId = lockMap(request.mapId());
        if (request.labelId() != null) requireLabel(mapId, request.labelId());
        List<String> ids = request.tileIds().stream().map(String::trim).distinct().toList();
        List<TileDO> existing = tiles.selectList(Wrappers.<TileDO>lambdaQuery().eq(TileDO::getMapId, mapId)
                .in(TileDO::getTileId, ids).last("FOR UPDATE"));
        if (existing.size() != ids.size()) throw new IllegalArgumentException("部分 Tile 不存在或不属于当前图谱，请同步后重试");
        int updated = tiles.update(null, Wrappers.<TileDO>lambdaUpdate().eq(TileDO::getMapId, mapId).in(TileDO::getTileId, ids)
                .set(TileDO::getLabelId, request.labelId()).set(TileDO::getUpdateTime, LocalDateTime.now()));
        if (updated != ids.size()) throw new IllegalStateException("批量保存失败，请同步图谱后重试");
        return Response.success();
    }

    private String lockMap(String mapId) {
        String normalized = MapIds.normalize(mapId);
        if (labels.lockMap(normalized) == null) throw new IllegalArgumentException("图谱不存在，请重新选择图谱");
        return normalized;
    }
    private LabelDO requireLabel(String mapId, Long id) {
        LabelDO label = labels.selectOne(Wrappers.<LabelDO>lambdaQuery().eq(LabelDO::getMapId, mapId).eq(LabelDO::getId, id));
        if (label == null) throw new IllegalArgumentException("标签不存在或不属于当前图谱，请同步后重试");
        return label;
    }
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Response<?>> invalid(IllegalArgumentException error) {
        return ResponseEntity.badRequest().body(Response.fail(error.getMessage()));
    }
    @ExceptionHandler(DuplicateKeyException.class)
    public ResponseEntity<Response<?>> duplicate() {
        return ResponseEntity.status(409).body(Response.fail("当前图谱已有同名标签，请使用其他名称"));
    }
    @ExceptionHandler({DataIntegrityViolationException.class, IllegalStateException.class})
    public ResponseEntity<Response<?>> conflict() {
        return ResponseEntity.status(409).body(Response.fail("标签或 Tile 已发生变化，请同步图谱后重试"));
    }
}
