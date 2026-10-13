package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.service.search.TavilyMcpSearchService;
import com.aureli.ai.robot.service.search.TavilySettingsService;
import com.aureli.ai.robot.utils.Response;
import org.springframework.dao.DataAccessException;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/customer-service/tavily-settings")
public class TavilySettingsController {
    private final TavilySettingsService settings;
    private final TavilyMcpSearchService search;
    public TavilySettingsController(TavilySettingsService settings, TavilyMcpSearchService search) {
        this.settings = settings;
        this.search = search;
    }
    @GetMapping
    public ResponseEntity<?> read() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Response.success(settings.view()));
    }
    // Credentials must never pass through ApiOperationLog.
    @PostMapping
    public ResponseEntity<?> save(@RequestBody TavilySettingsService.Request request) {
        try {
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Response.success(settings.save(request)));
        } catch (IllegalArgumentException error) {
            return ResponseEntity.badRequest().cacheControl(CacheControl.noStore()).body(Response.fail(error.getMessage()));
        } catch (DataAccessException error) {
            return ResponseEntity.internalServerError().cacheControl(CacheControl.noStore())
                    .body(Response.fail("联网配置保存失败，请检查数据库连接。原配置仍然生效。"));
        }
    }
    @PostMapping("/test")
    public ResponseEntity<?> testConnection() {
        try {
            search.testConnection(settings.snapshot());
            return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                    .body(Response.success("Tavily MCP 连接成功，搜索工具可用。"));
        } catch (RuntimeException error) {
            return ResponseEntity.status(502).cacheControl(CacheControl.noStore())
                    .body(Response.fail("Tavily MCP 连接失败，请检查已保存的地址、API Key 和网络连接。"));
        }
    }
}
