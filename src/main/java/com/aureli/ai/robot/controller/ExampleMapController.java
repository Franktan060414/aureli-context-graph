package com.aureli.ai.robot.controller;

import com.aureli.ai.robot.domain.dos.MapDO;
import com.aureli.ai.robot.service.ExampleMapService;
import com.aureli.ai.robot.utils.Response;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/customer-service/maps/example")
public class ExampleMapController {
    private final ExampleMapService examples;

    public ExampleMapController(ExampleMapService examples) { this.examples = examples; }

    @PostMapping
    public Response<MapDO> create() {
        return Response.success(examples.create());
    }
}
