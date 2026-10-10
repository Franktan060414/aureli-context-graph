package com.aureli.ai.robot.domain.maps;

/** Tile operations require an explicitly selected map. */
public final class MapIds {
    private MapIds() {}
    public static String normalize(String mapId) {
        if (mapId == null) throw new IllegalArgumentException("请先创建或选择图谱，并传入 mapId");
        String id = mapId.trim();
        if (id.isEmpty() || id.length() > 128) throw new IllegalArgumentException("Map ID 无效");
        return id;
    }
}
