package com.aureli.ai.robot.domain;

import com.aureli.ai.robot.domain.dos.TileEdgeDO;

/** Tile 关系由方向或融合、拆分操作确定，不接受自定义类型。 */
public final class TileRelationTypes {
    private TileRelationTypes() {}

    public static String forDirection(String direction) {
        return direction != null && "UNDIRECTED".equalsIgnoreCase(direction.trim()) ? "RELATES" : "EXTENDS";
    }

    /** 兼容历史数据中的普通自定义关系，保留融合和拆分来源。 */
    public static String forEdge(TileEdgeDO edge) {
        return switch (edge.getRelationType() == null ? "" : edge.getRelationType()) {
            case "DEVIDES" -> "DIVIDES";
            case "FUSES", "DIVIDES" -> edge.getRelationType();
            default -> forDirection(edge.getDirection());
        };
    }
}
