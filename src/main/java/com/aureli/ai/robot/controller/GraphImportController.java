package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.service.GraphImportService;
import com.aureli.ai.robot.utils.Response;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;

@RestController
@RequestMapping("/customer-service/maps/import")
public class GraphImportController {
    private final GraphImportService imports;
    public GraphImportController(GraphImportService imports) { this.imports = imports; }

    @PostMapping
    public Response<GraphImportService.Imported> importGraph(@RequestBody JsonNode document) {
        return Response.success(imports.importGraph(document));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Response<?>> invalid(IllegalArgumentException error) {
        return ResponseEntity.badRequest().body(Response.fail(error.getMessage()));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Response<?>> malformed() {
        return ResponseEntity.badRequest().body(Response.fail("JSON 格式错误：文件不是有效的 JSON。"));
    }
}
