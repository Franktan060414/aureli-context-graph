package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.service.model.ModelApiSettingsService;
import com.aureli.ai.robot.utils.Response;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.dao.DataAccessException;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/customer-service/model-settings")
public class ModelApiSettingsController {
    private final ModelApiSettingsService settings;
    public ModelApiSettingsController(ModelApiSettingsService settings) { this.settings = settings; }

    @GetMapping
    public ResponseEntity<Response<ModelApiSettingsService.SettingsView>> read() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Response.success(settings.view()));
    }

    // Deliberately omit ApiOperationLog: request bodies contain API keys.
    @PostMapping
    public ResponseEntity<Response<?>> save(@RequestBody ModelApiSettingsService.SettingsRequest request) {
        try { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Response.success(settings.save(request))); }
        catch (IllegalArgumentException e) { return ResponseEntity.badRequest().body(Response.fail(e.getMessage())); }
        catch (DataAccessException e) { return ResponseEntity.internalServerError().body(Response.fail("配置保存失败，请检查数据库连接和模型配置表，原配置仍然生效。")); }
    }

    @PostMapping("/test")
    public ResponseEntity<Response<?>> testConnection() {
        try {
            return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                    .body(Response.success(settings.testConnection()));
        } catch (RuntimeException e) {
            // Provider exceptions can contain request metadata or credentials. Return a fixed safe message.
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).cacheControl(CacheControl.noStore())
                    .body(Response.fail("测试失败，已保存的对话模型未能返回消息。请检查 API 地址、密钥和模型名称后重试。"));
        }
    }
}
