package com.aureli.ai.robot.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Internal database settings. Deliberately has no public controller or write API. */
@Service
@Slf4j
public class GeneralSettingsService {
    public static final String CONTEXT_TOKEN_BUDGET = "context_token_budget";
    public static final int DEFAULT_CONTEXT_TOKEN_BUDGET = 8000;
    private final JdbcTemplate jdbc;

    public GeneralSettingsService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public int contextTokenBudget() {
        try {
            var rows = jdbc.query("SELECT config_content FROM t_general_setting WHERE config_title = ?",
                    (rs, row) -> rs.getString(1), CONTEXT_TOKEN_BUDGET);
            if (rows.isEmpty()) return DEFAULT_CONTEXT_TOKEN_BUDGET;
            int value = Integer.parseInt(rows.getFirst().trim());
            if (value > 0 && value <= 1_000_000) return value;
        } catch (DataAccessException | IllegalArgumentException | NullPointerException error) {
            log.warn("上下文预算读取失败，使用默认 8000 token。");
        }
        return DEFAULT_CONTEXT_TOKEN_BUDGET;
    }
}
