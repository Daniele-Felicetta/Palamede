"""The world: a large indoor facility built from the Modern tiles_Free pack.

Two render layers are produced for the client:
  GROUND[y][x]  -> tile key of the floor
  OBJECTS[y][x] -> tile key of wall/prop above the floor, or None
Collision lives here (SOLID) and is authoritative: the client only renders.
"""

from __future__ import annotations

MAP_W, MAP_H = 60, 42
TILE = 32

# sheet key -> asset path served by the web server
SHEETS = {"rb": "assets/room_builder.png", "in": "assets/interiors.png"}

# tile key -> (sheet, column, row) in the 32x32 atlas
TILES: dict[str, tuple[str, int, int]] = {
    # --- floors (Room_Builder, seamless tiles) ---
    "stone": ("rb", 4, 17),
    "wood": ("rb", 4, 11),
    "wood_dark": ("rb", 4, 13),
    "wood_red": ("rb", 4, 15),
    "sand": ("rb", 4, 19),
    "mint": ("rb", 4, 9),
    "cream": ("rb", 4, 7),
    "coral": ("rb", 4, 5),
    "brick": ("rb", 11, 5),
    "tile": ("rb", 11, 7),
    "aqua": ("rb", 11, 9),
    "herring": ("rb", 11, 13),
    # --- walls (Room_Builder room border kit) ---
    "wall_top": ("rb", 7, 2),
    "wall_tl": ("rb", 5, 2),
    "wall_tr": ("rb", 9, 1),
    "wall": ("rb", 12, 0),
    # --- doors ---
    "door_l": ("in", 7, 9),
    "door_r": ("in", 8, 9),
    # --- props ---
    "plant": ("in", 14, 28),
    "bush": ("in", 11, 44),
    "umbrella": ("in", 13, 53),
    "table_l": ("in", 0, 10),
    "table_m": ("in", 1, 10),
    "table_r": ("in", 2, 10),
    "sofa_l": ("in", 7, 13),
    "sofa_m": ("in", 8, 13),
    "sofa_r": ("in", 9, 13),
    "shelf_t": ("in", 5, 15),
    "shelf_b": ("in", 5, 16),
    "books_tl": ("in", 13, 38),
    "books_tm": ("in", 14, 38),
    "books_tr": ("in", 15, 38),
    "books_bl": ("in", 13, 39),
    "books_bm": ("in", 14, 39),
    "books_br": ("in", 15, 39),
    "counter_l": ("in", 0, 48),
    "counter_m": ("in", 1, 48),
    "counter_r": ("in", 2, 48),
    "stove_l": ("in", 2, 18),
    "stove_r": ("in", 3, 18),
    "fridge_t": ("in", 4, 1),
    "fridge_b": ("in", 5, 1),
    "crate_l": ("in", 0, 21),
    "crate_r": ("in", 1, 21),
    "blackboard_l": ("in", 13, 41),
    "blackboard_m": ("in", 14, 41),
    "blackboard_r": ("in", 15, 41),
    "monitor": ("in", 13, 40),
    "globe": ("in", 13, 36),
    "bed_tl": ("in", 0, 0),
    "bed_tm": ("in", 1, 0),
    "bed_tr": ("in", 2, 0),
    "bed_ml": ("in", 0, 1),
    "bed_mm": ("in", 1, 1),
    "bed_mr": ("in", 2, 1),
    "bed_bl": ("in", 0, 2),
    "bed_bm": ("in", 1, 2),
    "bed_br": ("in", 2, 2),
    "rug_red_1": ("in", 7, 15),
    "rug_red_2": ("in", 8, 15),
    "rug_red_3": ("in", 9, 15),
    "rug_red_4": ("in", 10, 15),
    "rug_red_5": ("in", 11, 15),
    "rug_red_6": ("in", 12, 15),
    "rug_red_7": ("in", 7, 16),
    "rug_red_8": ("in", 8, 16),
    "rug_red_9": ("in", 9, 16),
    "rug_red_10": ("in", 10, 16),
    "rug_red_11": ("in", 11, 16),
    "rug_red_12": ("in", 12, 16),
    "rug_blue_1": ("in", 13, 10),
    "rug_blue_2": ("in", 14, 10),
    "rug_blue_3": ("in", 15, 10),
    "rug_blue_4": ("in", 13, 11),
    "rug_blue_5": ("in", 14, 11),
    "rug_blue_6": ("in", 15, 11),
    "rug_green_1": ("in", 11, 26),
    "rug_green_2": ("in", 12, 26),
    "rug_green_3": ("in", 11, 27),
    "rug_green_4": ("in", 12, 27),
}

# props are stamped as a group of (dx, dy, tile key); keys not in WALKABLE_PROPS block movement
PROPS: dict[str, list[tuple[int, int, str]]] = {
    "plant": [(0, 0, "plant")],
    "bush": [(0, 0, "bush")],
    "umbrella": [(0, 0, "umbrella")],
    "table": [(0, 0, "table_l"), (1, 0, "table_m"), (2, 0, "table_r")],
    "sofa": [(0, 0, "sofa_l"), (1, 0, "sofa_m"), (2, 0, "sofa_r")],
    "shelf": [(0, 0, "shelf_t"), (0, 1, "shelf_b")],
    "books": [
        (0, 0, "books_tl"), (1, 0, "books_tm"), (2, 0, "books_tr"),
        (0, 1, "books_bl"), (1, 1, "books_bm"), (2, 1, "books_br"),
    ],
    "counter": [(0, 0, "counter_l"), (1, 0, "counter_m"), (2, 0, "counter_r")],
    "stove": [(0, 0, "stove_l"), (1, 0, "stove_r")],
    "fridge": [(0, 0, "fridge_t"), (1, 0, "fridge_b")],
    "crate": [(0, 0, "crate_l"), (1, 0, "crate_r")],
    "blackboard": [(0, 0, "blackboard_l"), (1, 0, "blackboard_m"), (2, 0, "blackboard_r")],
    "monitor": [(0, 0, "monitor")],
    "globe": [(0, 0, "globe")],
    "bed": [
        (0, 0, "bed_tl"), (1, 0, "bed_tm"), (2, 0, "bed_tr"),
        (0, 1, "bed_ml"), (1, 1, "bed_mm"), (2, 1, "bed_mr"),
        (0, 2, "bed_bl"), (1, 2, "bed_bm"), (2, 2, "bed_br"),
    ],
    "rug_red": [
        (0, 0, "rug_red_1"), (1, 0, "rug_red_2"), (2, 0, "rug_red_3"),
        (3, 0, "rug_red_4"), (4, 0, "rug_red_5"), (5, 0, "rug_red_6"),
        (0, 1, "rug_red_7"), (1, 1, "rug_red_8"), (2, 1, "rug_red_9"),
        (3, 1, "rug_red_10"), (4, 1, "rug_red_11"), (5, 1, "rug_red_12"),
    ],
    "rug_blue": [
        (0, 0, "rug_blue_1"), (1, 0, "rug_blue_2"), (2, 0, "rug_blue_3"),
        (0, 1, "rug_blue_4"), (1, 1, "rug_blue_5"), (2, 1, "rug_blue_6"),
    ],
    "rug_green": [
        (0, 0, "rug_green_1"), (1, 0, "rug_green_2"),
        (0, 1, "rug_green_3"), (1, 1, "rug_green_4"),
    ],
    "door": [(0, 0, "door_l"), (1, 0, "door_r")],
}

WALKABLE_PROPS = frozenset({"rug_red", "rug_blue", "rug_green", "door"})

CACHE_TILE = "cache"
TILES[CACHE_TILE] = ("in", 1, 21)  # small wooden chest

CACHE_POS = (54, 37)
PLAYER_SPAWN = (30, 24)

# room rectangles: (x0, y0, x1, y1, floor key, [door x positions on the top/bottom wall])
ROOMS = [
    ("serra", 1, 1, 13, 10, "mint", [(7, 10)]),
    ("biblioteca", 15, 1, 27, 10, "wood", [(21, 10)]),
    ("laboratorio", 29, 1, 41, 10, "aqua", [(35, 10)]),
    ("sala_macchine", 43, 1, 58, 10, "herring", [(50, 10)]),
    ("negozio", 1, 31, 13, 40, "brick", [(7, 31)]),
    ("cucina", 15, 31, 27, 40, "cream", [(21, 31)]),
    ("dormitori", 29, 31, 41, 40, "wood_dark", [(35, 31)]),
    ("magazzino", 43, 31, 58, 40, "tile", [(50, 31)]),
]

NPC_DEFS = [
    {
        "id": "nissa", "name": "Nissa", "role": "mercante", "color": "#d98a3d",
        "pos": (5, 35), "sprite": 1,
        "persona": (
            "Nissa, una mercante pragmatica di mezza età. Parla di affari, prezzi e "
            "occasione da cogliere. Diffida di chi non compra, apprezza chi tratta bene."
        ),
        "traits": {"friendly": 0.5, "greed": 0.9, "patience": 0.6}, "knows_secret": False,
    },
    {
        "id": "pino", "name": "Pino", "role": "contadino", "color": "#7bb661",
        "pos": (6, 5), "sprite": 2,
        "persona": (
            "Pino, un contadino gioviale e chiacchierone. Racconta la vita dei campi, "
            "offre aiuto volentieri e si fida facilmente degli sconosciuti."
        ),
        "traits": {"friendly": 0.95, "greed": 0.2, "patience": 0.8}, "knows_secret": True,
    },
    {
        "id": "orbo", "name": "Orbo", "role": "eremita", "color": "#9a7bf2",
        "pos": (21, 5), "sprite": 3,
        "persona": (
            "Orbo, un eremita studioso che parla per enigmi. Misura le parole, "
            "non si fida dei curiosi e mette alla prova chi gli sta davanti."
        ),
        "traits": {"friendly": 0.35, "greed": 0.1, "patience": 0.5}, "knows_secret": True,
    },
    {
        "id": "bruma", "name": "Bruma", "role": "guardiana", "color": "#5aa0c8",
        "pos": (50, 5), "sprite": 0, "tint": "rgba(90,160,200,0.45)",
        "persona": (
            "Bruma, una guardiana sospettosa e diretta. Non sopporta le perdite di tempo, "
            "diffida di chiunque e minaccia chi si avvicina troppo."
        ),
        "traits": {"friendly": 0.15, "greed": 0.3, "patience": 0.2}, "knows_secret": False,
    },
    {
        "id": "zyx", "name": "Zyx", "role": "viandante", "color": "#cf5f5f",
        "pos": (30, 20), "sprite": 1, "tint": "rgba(200,90,90,0.45)",
        "persona": (
            "Zyx, un viandante misterioso coperto da un mantello. Parla poco, "
            "sa molte cose e le rivela solo a chi gli sta simpatico."
        ),
        "traits": {"friendly": 0.45, "greed": 0.5, "patience": 0.45}, "knows_secret": True,
    },
]

ACTIONS = {
    "give_potion": {"label": "Offri una pozione",
                    "description": "Porgi una delle tue pozioni rosse per farti benvolere."},
    "trade": {"label": "Proponi uno scambio",
              "description": "Offri la gemma azzurra in cambio di monete d'oro."},
    "ask_rumor": {"label": "Chiedi un'informazione",
                  "description": "Chiedi se conosce un posto segreto da cui trarre profitto."},
    "challenge": {"label": "Sfidala a duello",
                  "description": "Provoca un duello: rischi salute, ma puoi guadagnare oro."},
    "leave": {"label": "Congedati",
              "description": "Saluta e torna per la tua strada senza chiedere altro."},
}

ITEMS = {"pozione": "Pozione rossa", "gemma": "Gemma azzurra"}


# ---------------------------------------------------------------------------
# map construction
# ---------------------------------------------------------------------------
def _grid(fill):
    return [[fill for _ in range(MAP_W)] for _ in range(MAP_H)]


def _build():
    ground = _grid("stone")
    objects = _grid(None)
    solid = _grid(True)  # outside the facility everything starts as wall

    def set_ground(x, y, key):
        ground[y][x] = key

    def set_object(x, y, key):
        objects[y][x] = key

    # outer border stays wall
    for x in range(MAP_W):
        set_object(x, 0, "wall")
        set_object(x, MAP_H - 1, "wall")
    for y in range(MAP_H):
        set_object(0, y, "wall")
        set_object(MAP_W - 1, y, "wall")

    # corridors and central hall are walkable
    for y in range(1, MAP_H - 1):
        for x in range(1, MAP_W - 1):
            solid[y][x] = False

    # central hall: sand plaza
    for y in range(14, 28):
        for x in range(1, MAP_W - 1):
            set_ground(x, y, "sand")

    # rooms
    for _name, x0, y0, x1, y1, floor, doors in ROOMS:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                border = x in (x0, x1) or y in (y0, y1)
                if border:
                    set_object(x, y, "wall")
                    solid[y][x] = True
                else:
                    set_ground(x, y, floor)
                    set_object(x, y, None)
                    solid[y][x] = False
        # top wall with corners + doors
        set_object(x0, y0, "wall_tl")
        set_object(x1, y0, "wall_tr")
        for x in range(x0 + 1, x1):
            set_object(x, y0, "wall_top")
        for dx, dy in doors:
            _stamp(ground, objects, solid, "door", dx, dy)
        # side and bottom walls are plain
        for y in range(y0 + 1, y1 + 1):
            set_object(x0, y, "wall")
            set_object(x1, y, "wall")
        for x in range(x0 + 1, x1):
            set_object(x, y1, "wall")

    return ground, objects, solid


def _stamp(ground, objects, solid, prop, x, y):
    for dx, dy, key in PROPS[prop]:
        objects[y + dy][x + dx] = key
        # Walkable props (doors, rugs) must clear the wall they replace.
        solid[y + dy][x + dx] = prop not in WALKABLE_PROPS


GROUND, OBJECTS, SOLID = _build()


def _place(prop, x, y):
    _stamp(GROUND, OBJECTS, SOLID, prop, x, y)


# --- decoration: furnished with intent ------------------------------------
# Door columns stay clear, agents keep a free neighbour, furniture hugs walls.
# central hall: two symmetric lounges, one central rug, four corner plants
_place("rug_red", 27, 17)
_place("sofa", 19, 16)
_place("rug_blue", 19, 18)
_place("table", 19, 20)
_place("sofa", 38, 16)
_place("rug_blue", 38, 18)
_place("table", 38, 20)
# serra: two symmetric plant rows, bushes in the corners, free column x=7
_place("plant", 4, 3)
_place("plant", 6, 3)
_place("plant", 8, 3)
_place("plant", 10, 3)
_place("plant", 4, 7)
_place("plant", 6, 7)
_place("plant", 8, 7)
_place("plant", 10, 7)
_place("bush", 2, 2)
_place("bush", 11, 2)
_place("bush", 2, 8)
_place("bush", 11, 8)
# biblioteca: a full bookshelf wall, side shelves, one reading set
_place("books", 16, 2)
_place("books", 19, 2)
_place("books", 22, 2)
_place("shelf", 16, 6)
_place("shelf", 26, 6)
_place("table", 17, 7)
_place("rug_blue", 20, 4)
# laboratorio: blackboard centered, two benches with a screen each behind them
_place("blackboard", 34, 2)
_place("table", 31, 6)
_place("table", 37, 6)
_place("monitor", 32, 5)
_place("monitor", 38, 5)
# sala macchine: two benches with screens, reference shelf, corner stock
_place("books", 44, 2)
_place("crate", 56, 3)
_place("table", 47, 7)
_place("table", 51, 7)
_place("monitor", 48, 6)
_place("monitor", 52, 6)
# negozio: counter, right-wall shelves, display table, stock
_place("counter", 2, 34)
_place("shelf", 12, 32)
_place("shelf", 12, 37)
_place("crate", 2, 38)
_place("table", 8, 37)
# cucina: appliance run north, dining table south
_place("counter", 16, 32)
_place("stove", 19, 32)
_place("counter", 22, 32)
_place("fridge", 25, 32)
_place("table", 18, 37)
# dormitori: four beds around the central aisle on x=35
_place("bed", 30, 33)
_place("bed", 37, 33)
_place("bed", 30, 36)
_place("bed", 37, 36)
_place("shelf", 40, 32)
# magazzino: stock at the edges; cache cell and neighbours stay free
_place("crate", 44, 33)
_place("crate", 56, 33)
_place("shelf", 44, 36)
_place("shelf", 57, 36)
_place("crate", 47, 35)
_place("crate", 52, 38)



PALETTE = list(TILES)
_INDEX = {key: i for i, key in enumerate(PALETTE)}


def ground_indices() -> list[list[int]]:
    return [[_INDEX[GROUND[y][x]] for x in range(MAP_W)] for y in range(MAP_H)]


def object_indices() -> list[list[int]]:
    return [
        [_INDEX[OBJECTS[y][x]] if OBJECTS[y][x] else -1 for x in range(MAP_W)]
        for y in range(MAP_H)
    ]


def tile_at(x: int, y: int, cache_revealed: bool = False) -> str:
    if not (0 <= x < MAP_W and 0 <= y < MAP_H):
        return "wall"
    if cache_revealed and (x, y) == CACHE_POS:
        return CACHE_TILE
    return OBJECTS[y][x] or GROUND[y][x]


def is_walkable(x: int, y: int, cache_revealed: bool = False) -> bool:
    if not (0 <= x < MAP_W and 0 <= y < MAP_H):
        return False
    if (x, y) == CACHE_POS and cache_revealed:
        return True
    return not SOLID[y][x]


def npc_by_id(npc_id: str) -> dict | None:
    for npc in NPC_DEFS:
        if npc["id"] == npc_id:
            return npc
    return None


def validate() -> None:
    if len(GROUND) != MAP_H or any(len(row) != MAP_W for row in GROUND):
        raise ValueError("Ground layer is not MAP_W x MAP_H")
    if len(OBJECTS) != MAP_H or any(len(row) != MAP_W for row in OBJECTS):
        raise ValueError("Object layer is not MAP_W x MAP_H")
    if not is_walkable(*PLAYER_SPAWN):
        raise ValueError(f"Player spawn {PLAYER_SPAWN} is not walkable")
    for npc in NPC_DEFS:
        if not is_walkable(*npc["pos"]):
            raise ValueError(f"NPC {npc['id']} stands on a blocked tile at {npc['pos']}")
    if not (0 <= CACHE_POS[0] < MAP_W and 0 <= CACHE_POS[1] < MAP_H):
        raise ValueError("Cache position is outside the map")
    for name, _x0, _y0, _x1, _y1, floor, _doors in ROOMS:
        if floor not in TILES:
            raise ValueError(f"Room {name} uses unknown floor {floor}")
    for key, (sheet, col, row) in TILES.items():
        if sheet not in SHEETS:
            raise ValueError(f"Tile {key} references unknown sheet {sheet}")
        if col < 0 or row < 0:
            raise ValueError(f"Tile {key} has a negative atlas coordinate")
    _check_reachability()


def _check_reachability() -> None:
    """BFS from the spawn over revealed walkable tiles: every agent must have a
    reachable neighbour (so the player can stand next to them) and the cache
    cell must be reachable."""
    seen: set[tuple[int, int]] = {PLAYER_SPAWN}
    frontier = [PLAYER_SPAWN]
    while frontier:
        x, y = frontier.pop()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if (nx, ny) not in seen and is_walkable(nx, ny, cache_revealed=True):
                seen.add((nx, ny))
                frontier.append((nx, ny))
    for npc in NPC_DEFS:
        x, y = npc["pos"]
        neighbours = [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
        if not any(cell in seen for cell in neighbours):
            raise ValueError(f"NPC {npc['id']} at {npc['pos']} cannot be reached")
    if CACHE_POS not in seen:
        raise ValueError(f"Cache at {CACHE_POS} cannot be reached")


validate()
