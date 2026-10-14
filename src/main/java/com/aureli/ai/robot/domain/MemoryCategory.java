package com.aureli.ai.robot.domain;

/** Internal purpose of a question; never a claim of factual reliability. */
public enum MemoryCategory {
    PREFERENCE, PROJECT_RULE, DECISION, DISCUSSION, UNKNOWN;

    private static final double[][] APPLICABILITY = {
            {1.0, 0.6, 0.6, 0.4, 0.4},
            {0.6, 1.0, 0.9, 0.5, 0.4},
            {0.6, 1.0, 1.0, 0.8, 0.5},
            {0.7, 0.9, 0.9, 0.8, 0.5},
            {0.7, 0.8, 0.8, 0.7, 0.5}
    };

    public static MemoryCategory normalize(String value) {
        if (value == null) return UNKNOWN;
        try { return valueOf(value.trim()); }
        catch (IllegalArgumentException error) { return UNKNOWN; }
    }

    public double applicability(MemoryCategory historical) {
        return APPLICABILITY[ordinal()][(historical == null ? UNKNOWN : historical).ordinal()];
    }

    public double score(int weight, int distance, boolean directlySelected, MemoryCategory historical) {
        int safeWeight = weight < 1 || weight > 3 ? 1 : weight;
        int safeDistance = Math.max(1, distance);
        return (directlySelected ? 4 : 0) + (safeDistance <= 3 ? 2 : 0)
                + 0.35 * (safeWeight - 1) / 2.0 + 0.25 / safeDistance
                + 0.40 * applicability(historical);
    }
}
