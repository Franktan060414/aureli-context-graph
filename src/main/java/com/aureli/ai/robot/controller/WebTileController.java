package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.service.web.WebTileService;
import com.aureli.ai.robot.utils.Response;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/customer-service/tile")
public class WebTileController {
    private final WebTileService service;
    public WebTileController(WebTileService service) { this.service = service; }
    public record Create(@NotBlank @Size(max = 128) String mapId, @NotBlank @Size(max = 2048) String url,
                         @Size(max = 1000) List<@NotBlank @Size(max = 128) String> relatedTileIds) {}
    public record Refresh(@NotBlank @Size(max = 128) String mapId) {}
    @PostMapping("/web")
    public Response<TileWorkspaceController.Node> create(@RequestBody @Valid Create request) {
        return Response.success(service.create(request.mapId(), request.url(), request.relatedTileIds()));
    }
    @PostMapping("/{tileId}/web/refresh")
    public Response<TileWorkspaceController.Node> refresh(@PathVariable String tileId, @RequestBody @Valid Refresh request) {
        return Response.success(service.refresh(request.mapId(), tileId));
    }
    @ExceptionHandler(IllegalArgumentException.class)
    public Response<?> invalid(IllegalArgumentException error) { return Response.fail(error.getMessage()); }
}
