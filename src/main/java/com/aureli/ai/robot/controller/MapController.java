package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.dos.MapDO;
import com.aureli.ai.robot.domain.mapper.MapMapper;
import com.aureli.ai.robot.utils.Response;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.DecimalMax;
import com.aureli.ai.robot.domain.maps.MapIds;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/customer-service/maps")
public class MapController {
    private final MapMapper maps;
    public MapController(MapMapper maps) { this.maps = maps; }

    @GetMapping
    public ResponseEntity<Response<List<MapDO>>> list() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Response.success(
                maps.selectList(Wrappers.<MapDO>lambdaQuery().orderByAsc(MapDO::getId))));
    }

    public record CreateMap(@NotBlank @Size(max = 100) String name) {}

    @PostMapping
    public Response<MapDO> create(@RequestBody @Validated CreateMap request) {
        LocalDateTime now = LocalDateTime.now();
        MapDO map = MapDO.builder().mapId("map-" + UUID.randomUUID()).name(request.name().trim())
                .createTime(now).updateTime(now).build();
        maps.insert(map);
        return Response.success(map);
    }

    @DeleteMapping("/{mapId}")
    public Response<?> delete(@PathVariable String mapId) {
        // The foreign keys cascade to this map's Tiles, messages and edges atomically.
        int deleted = maps.delete(Wrappers.<MapDO>lambdaQuery().eq(MapDO::getMapId, MapIds.normalize(mapId)));
        return deleted == 0 ? Response.fail("图谱不存在，请重新加载图谱列表") : Response.success();
    }

    public record UpdateZoom(@NotNull @DecimalMin("0.35") @DecimalMax("1.5") Double zoom) {}

    @PostMapping("/{mapId}/zoom")
    public Response<?> updateZoom(@PathVariable String mapId, @RequestBody @Validated UpdateZoom request) {
        int updated = maps.update(null, Wrappers.<MapDO>lambdaUpdate()
                .eq(MapDO::getMapId, MapIds.normalize(mapId))
                .set(MapDO::getZoom, request.zoom()).set(MapDO::getUpdateTime, LocalDateTime.now()));
        return updated == 0 ? Response.fail("图谱不存在，请重新加载图谱列表") : Response.success();
    }

}
