package com.aureli.ai.robot.service;

import com.aureli.ai.robot.domain.mapper.TileEdgeMapper;
import com.aureli.ai.robot.domain.mapper.TileMapper;
import com.aureli.ai.robot.domain.mapper.TileMessageMapper;
import com.aureli.ai.robot.enums.ResponseCodeEnum;
import com.aureli.ai.robot.exception.BizException;
import com.aureli.ai.robot.model.vo.customerService.DeleteTileReqVO;
import com.aureli.ai.robot.service.impl.CustomerServiceImpl;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class CustomerServiceTileDeletionTest {

    @Test
    void deletesEdgesAndMessagesBeforeDeletingTile() {
        TileMapper tiles = mock(TileMapper.class);
        TileMessageMapper messages = mock(TileMessageMapper.class);
        TileEdgeMapper edges = mock(TileEdgeMapper.class);
        when(tiles.selectCount(any())).thenReturn(1L);
        CustomerServiceImpl service = service(tiles, messages, edges);

        service.deleteTile(DeleteTileReqVO.builder().mapId("map-test").tileId(" tile-1 ").build());

        var order = inOrder(edges, messages, tiles);
        order.verify(edges).delete(any());
        order.verify(messages).delete(any());
        order.verify(tiles).delete(any());
    }

    @Test
    void rejectsUnknownTileWithoutDeletingAnything() {
        TileMapper tiles = mock(TileMapper.class);
        TileMessageMapper messages = mock(TileMessageMapper.class);
        TileEdgeMapper edges = mock(TileEdgeMapper.class);
        when(tiles.selectCount(any())).thenReturn(0L);
        CustomerServiceImpl service = service(tiles, messages, edges);

        BizException error = assertThrows(BizException.class,
                () -> service.deleteTile(DeleteTileReqVO.builder().mapId("map-test").tileId("missing").build()));

        assertEquals(ResponseCodeEnum.TILE_NOT_FOUND.getErrorCode(), error.getErrorCode());
        verifyNoInteractions(edges, messages);
        verify(tiles, never()).delete(any());
    }

    private CustomerServiceImpl service(TileMapper tiles, TileMessageMapper messages, TileEdgeMapper edges) {
        CustomerServiceImpl service = new CustomerServiceImpl();
        ReflectionTestUtils.setField(service, "tileMapper", tiles);
        ReflectionTestUtils.setField(service, "tileMessageMapper", messages);
        ReflectionTestUtils.setField(service, "tileEdgeMapper", edges);
        return service;
    }
}
