package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.model.vo.customerService.AiCustomerServiceChatReqVO;
import com.aureli.ai.robot.service.TileQuestionPlanService;
import com.aureli.ai.robot.utils.Response;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/customer-service/tile/question")
public class TileQuestionPlanController {
    private final TileQuestionPlanService plans;
    public TileQuestionPlanController(TileQuestionPlanService plans) { this.plans = plans; }
    public record Decision(@NotBlank String mapId, @NotBlank String planId,
                           @NotBlank @Pattern(regexp = "EXECUTE|DECLINE|CANCEL") String action) {}

    @PostMapping("/plan")
    public ResponseEntity<Response<?>> prepare(@RequestBody @Validated AiCustomerServiceChatReqVO request) {
        try { return ok(plans.prepare(request)); }
        catch (TileQuestionPlanService.PlanningUnavailable error) {
            return ResponseEntity.status(503).body(Response.fail("QUESTION_PLANNING_UNAVAILABLE", "暂时无法提供拆分建议，可继续按原问题生成问答。"));
        } catch (TileQuestionPlanService.PlanException error) { return conflict(error); }
        catch (IllegalArgumentException error) { return ResponseEntity.badRequest().body(Response.fail(error.getMessage())); }
    }

    @PostMapping("/decision")
    public ResponseEntity<Response<?>> decide(@RequestBody @Validated Decision request) {
        try { return ok(plans.decide(request.mapId(), request.planId(), request.action())); }
        catch (TileQuestionPlanService.PlanException error) { return conflict(error); }
        catch (IllegalArgumentException error) { return ResponseEntity.badRequest().body(Response.fail(error.getMessage())); }
        catch (RuntimeException error) {
            return ResponseEntity.internalServerError().body(Response.fail("QUESTION_EXECUTION_FAILED",
                    "问答生成或保存失败，整组未完成。可按同一方案重试；若连接中断，请先同步图谱确认结果。"));
        }
    }
    private ResponseEntity<Response<?>> ok(Object data) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Response.success(data));
    }
    private ResponseEntity<Response<?>> conflict(TileQuestionPlanService.PlanException error) {
        return ResponseEntity.status(409).body(Response.fail(error.code, error.getMessage()));
    }
}
