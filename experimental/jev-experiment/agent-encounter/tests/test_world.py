"""Map and world sanity: shapes, walkability, agent placement, tile palette."""

from __future__ import annotations

from agent_encounter import world


def test_map_is_rectangular():
    assert len(world.GROUND) == world.MAP_H
    assert len(world.OBJECTS) == world.MAP_H
    assert all(len(row) == world.MAP_W for row in world.GROUND)
    assert all(len(row) == world.MAP_W for row in world.OBJECTS)


def test_spawn_and_agents_stand_on_walkable_tiles():
    assert world.is_walkable(*world.PLAYER_SPAWN)
    for npc in world.NPC_DEFS:
        assert world.is_walkable(*npc["pos"]), npc["id"]


def test_cache_is_hidden_until_revealed():
    x, y = world.CACHE_POS
    assert world.tile_at(x, y, cache_revealed=False) != world.CACHE_TILE
    assert world.tile_at(x, y, cache_revealed=True) == world.CACHE_TILE
    assert world.is_walkable(x, y, cache_revealed=True)


def test_walls_block_and_spawn_does_not():
    assert not world.is_walkable(0, 0)
    assert not world.is_walkable(world.MAP_W - 1, world.MAP_H - 1)
    assert world.is_walkable(*world.PLAYER_SPAWN)


def test_layer_indices_stay_inside_the_palette():
    for layer in (world.ground_indices(), world.object_indices()):
        for row in layer:
            for index in row:
                assert -1 <= index < len(world.PALETTE)


def test_every_room_floor_is_a_known_tile():
    for _name, _x0, _y0, _x1, _y1, floor, _doors in world.ROOMS:
        assert floor in world.TILES


def test_every_action_has_label_and_description():
    for action_id, spec in world.ACTIONS.items():
        assert spec["label"] and spec["description"], action_id
