// All simulation units are "world pixels" at a fixed 60 ticks per second.
// World Y grows upward; floor N sits at y = N * FLOOR_GAP.

export const TICK_RATE = 60;
export const VIEW_W = 480;
export const VIEW_H = 720;
export const WALL = 36; // thickness of each side wall
export const PLAY_L = WALL;
export const PLAY_R = VIEW_W - WALL;

export const FLOOR_GAP = 80;
export const PLATFORM_H = 16;

export const PLAYER_R = 13; // half-width of the player hitbox
export const PLAYER_H = 40;

export const GRAVITY = 0.5;
export const MAX_FALL = 20;
export const MAX_VX = 10;
export const GROUND_ACCEL = 0.55;
export const AIR_ACCEL = 0.4;
export const GROUND_FRICTION = 0.87;
export const ICE_FRICTION = 0.985;
export const AIR_DRAG = 0.99;
export const JUMP_BASE = 10;
export const JUMP_SPEED_BONUS = 0.9; // extra vy per unit of |vx|
export const ROCKET_MULT = 1.65;
export const SPRING_VY = 21;
export const COYOTE_TICKS = 5;

export const COMBO_TICKS = 3 * TICK_RATE;
export const COMBO_MIN_FLOORS = 4;
export const COMBO_MIN_JUMPS = 2;

export const SCROLL_START_FLOOR = 5;
export const SPEED_LEVEL_TICKS = 30 * TICK_RATE;
export const MAX_SPEED_LEVEL = 9;
export const BASE_SCROLL = 0.55;
export const SCROLL_PER_LEVEL = 0.4;
export const CATCHUP_LINE = 0.5; // fraction of screen height the camera keeps the player below

export const FREEZE_TICKS = 5 * TICK_RATE;
export const MAGNET_TICKS = 10 * TICK_RATE;
export const MAGNET_RADIUS = 170;

export const GEM_POINTS = 25;
export const FLOOR_POINTS = 10;
export const MILESTONE_EVERY = 50;

export const INPUT_LEFT = 1;
export const INPUT_RIGHT = 2;
export const INPUT_JUMP = 4;
