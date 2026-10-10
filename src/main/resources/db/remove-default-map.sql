-- 一次性移除空的旧默认图谱；有 Tile 时保留，避免连带删除内容。
-- schema.sql 不再创建任何图谱，也不再为 Tile 设置默认 map_id。
DELETE FROM t_map WHERE map_id = 'default'
    AND NOT EXISTS (SELECT 1 FROM t_tile WHERE map_id = 'default');

ALTER TABLE t_tile ALTER COLUMN map_id DROP DEFAULT;
ALTER TABLE t_tile_message ALTER COLUMN map_id DROP DEFAULT;
ALTER TABLE t_tile_edge ALTER COLUMN map_id DROP DEFAULT;
