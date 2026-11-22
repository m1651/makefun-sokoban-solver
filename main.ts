// Sokoban solver for make.fun sokoban-solver-01-run-20261121.
// Push-optimal A* over pushes, room by room.
//
// Why rooms: the generator lays a hallway across the board with rooms off
// it, each room holding 3-4 boxes and as many goals, and a box pushed out of
// a room can never be pushed back, so a level's push optimum is the sum of
// its rooms' optima. A room is found by cutting the hallway row's dead
// squares (floor cells of the player's row from which a box can never reach
// a goal) out of the floor: each remaining component holding boxes is a room.
//
// Inside a room, a state is the boxes' squares plus the player's reachable
// region (named by its lowest square). A* expands states in order of
// pushes + an admissible estimate: the cheapest matching of boxes to goals,
// where a box's distance to a goal is its shortest push path ignoring the
// other boxes. Deadlocks are pruned: a box on a square from which no goal
// is reachable by pulling, and a box in a frozen 2x2 block of walls/boxes
// off its goal. The first solved state A* pops is push-optimal, because the
// estimate never overstates the pushes still needed.
//
// Deterministic: no clock, no randomness, no environment; the search is
// bounded by a fixed number of expansions, never by time, so two runs of
// the program write the same bytes. If a room's search exhausts its budget
// the level is left unsolved (empty answer) rather than timed out.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Fixed work budgets (expansions), never the clock.
const ROOM_EXPANSIONS = 400_000;
const WHOLE_EXPANSIONS = 600_000;

type Dir = [number, number, string, string];
const DIRS: Dir[] = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
];

interface Level {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) {
      const ch = row[x] ?? '#';
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if ('.*+'.includes(ch)) goals.push(i);
      if ('$*'.includes(ch)) boxes.push(i);
      if ('@+'.includes(ch)) player = i;
    }
  });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  return { w, h, wall, goals, boxes: boxes.sort((a, b) => a - b), player };
}

// Squares from which a box alone can be pushed onto some goal: pull back
// from the goals over open floor (a pull needs the square behind the box
// and the square the box moves to both open).
function liveSquares(level: Level): Uint8Array {
  const { w, wall, goals } = level;
  const live = new Uint8Array(wall.length);
  const queue = [...goals];
  for (const g of goals) live[g] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi]!;
    for (const [dx, dy] of DIRS) {
      const d = dy * w + dx;
      const y = x - d;
      if (!wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

// Flood fill from `from` over floor squares not occupied by a box.
// Returns the lowest square reached (the region's name) and marks `seen`.
function reach(
  level: Level,
  occupied: Uint8Array,
  from: number,
  seen: Int32Array,
  stamp: number,
  stack: Int32Array,
): number {
  const { w, wall } = level;
  let low = from;
  let n = 0;
  stack[n++] = from;
  seen[from] = stamp;
  while (n > 0) {
    const p = stack[--n]!;
    if (p < low) low = p;
    for (let k = 0; k < 4; k++) {
      const q = k === 0 ? p - w : k === 1 ? p + w : k === 2 ? p - 1 : p + 1;
      if (wall[q] === 0 && occupied[q] === 0 && seen[q] !== stamp) {
        seen[q] = stamp;
        stack[n++] = q;
      }
    }
  }
  return low;
}

// Whether the box just pushed to `t` sits in a frozen 2x2 block of walls
// and boxes with a box off its goal.
function frozenBlock(
  level: Level,
  occupied: Uint8Array,
  goal: Uint8Array,
  t: number,
): boolean {
  const { w, wall } = level;
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (!(wall[a] || occupied[a]) || !(wall[b] || occupied[b]) ||
        !(wall[c] || occupied[c]) || !(wall[d] || occupied[d])) continue;
    if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b]) ||
        (occupied[c] && !goal[c]) || (occupied[d] && !goal[d])) return true;
  }
  return false;
}

// Shortest walk from `from` to `to` around walls and boxes, lower LURD.
function walkTo(
  level: Level,
  occupied: Uint8Array,
  from: number,
  to: number,
): string {
  const { w, wall } = level;
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how = new Array<string>(wall.length);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    if (p === to) break;
    for (const [dx, dy, letter] of DIRS) {
      const q = p + dy * w + dx;
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = letter;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: push square out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p]!) s = how[p]! + s;
  return s;
}

interface Room {
  squares: number[];
  boxes: number[];
  goals: number[];
}

// Cut the hallway row's dead squares out of the floor; each component left
// holding boxes is a room. Null when a component's boxes and goals do not
// match, or a box starts in the hallway.
function roomsOf(level: Level): Room[] | null {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(level);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) {
    if (!wall[i] && !live[i]) cut[i] = 1;
  }
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q = squares[i]! + dy * w + dx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [] });
  }
  for (const b of boxes) rooms[part[b]!]!.boxes.push(b);
  for (const g of goals) if (part[g]! >= 0) rooms[part[g]!]!.goals.push(g);
  if (goals.some((g) => part[g]! < 0) ||
      rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

// Push-optimal A* for one (sub)level. Returns {pushes, moves} or null.
function solvePushAStar(level: Level, maxExpansions: number): { pushes: number; moves: string } | null {
  const { w, wall, goals } = level;
  const size = wall.length;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(level);
  if (level.boxes.some((b) => !live[b])) return null;
  const solved = (boxes: number[]): boolean => boxes.every((b) => goal[b]);
  if (solved(level.boxes)) return { pushes: 0, moves: '' };

  // Box-to-goal distances ignoring other boxes, one BFS per goal.
  const distToGoal: Int32Array[] = goals.map((g) => {
    const dist = new Int32Array(size).fill(-1);
    const queue = [g];
    dist[g] = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const p = queue[qi]!;
      for (const [dx, dy] of DIRS) {
        const q = p + dy * w + dx;
        if (!wall[q] && dist[q] === -1) {
          dist[q] = dist[p]! + 1;
          queue.push(q);
        }
      }
    }
    return dist;
  });
  // Cheapest matching of boxes to goals (n <= 4, try every permutation).
  const heuristic = (boxes: number[]): number => {
    const n = boxes.length;
    const perm = goals.map((_, i) => i);
    let best = Infinity;
    const rec = (i: number, used: boolean[], sum: number): void => {
      if (sum >= best) return;
      if (i === n) { best = sum; return; }
      for (let j = 0; j < n; j++) {
        if (used[j]) continue;
        const d = distToGoal[j]![boxes[i]!]!;
        if (d < 0) continue; // this box reaches that goal never; try another
        used[j] = true;
        rec(i + 1, used, sum + d);
        used[j] = false;
      }
    };
    rec(0, new Array<boolean>(n).fill(false), 0);
    return best;
  };

  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;
  const keyOf = (boxes: number[], low: number): number => {
    let k = low;
    for (const b of boxes) k = k * size + b;
    return k;
  };

  // Binary heap on (f, h, seq): smallest f first, then smallest h.
  const heap: [number, number, number, number][] = [];
  const heapLess = (a: [number, number, number, number], b: [number, number, number, number]): boolean =>
    a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
  const heapPush = (e: [number, number, number, number]): void => {
    let i = heap.length;
    heap.push(e);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!heapLess(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const heapPop = (): [number, number, number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heapLess(heap[c + 1]!, heap[c]!)) c++;
        if (!heapLess(heap[c]!, heap[i]!)) break;
        [heap[i], heap[c]] = [heap[c]!, heap[i]!];
        i = c;
      }
    }
    return top;
  };

  const statesBoxes: number[][] = [level.boxes];
  const statesPlayer: number[] = [level.player];
  const statesG: number[] = [0];
  const parent: number[] = [-1];
  const pushFrom: number[] = [-1];
  const pushTo: number[] = [-1];
  const best = new Map<number, number>();
  for (const b of level.boxes) occupied[b] = 1;
  const startLow = reach(level, occupied, level.player, seen, ++stamp, stack);
  for (const b of level.boxes) occupied[b] = 0;
  const h0 = heuristic(level.boxes);
  if (!Number.isFinite(h0)) return null;
  best.set(keyOf(level.boxes, startLow), 0);
  heapPush([h0, h0, 0, 0]);
  let seq = 1;
  let expanded = 0;
  let found = -1;
  while (heap.length > 0) {
    const [, , , s] = heapPop();
    if (best.get(keyOf(statesBoxes[s]!, reach(level, (() => { for (const b of statesBoxes[s]!) occupied[b] = 1; return occupied; })(), statesPlayer[s]!, seen, ++stamp, stack))) !== s) {
      for (const b of statesBoxes[s]!) occupied[b] = 0;
      continue;
    }
    for (const b of statesBoxes[s]!) occupied[b] = 0;
    const boxes = statesBoxes[s]!;
    const g = statesG[s]!;
    if (solved(boxes)) { found = s; break; }
    if (++expanded > maxExpansions) return null;
    for (const b of boxes) occupied[b] = 1;
    const regionStamp = ++stamp;
    reach(level, occupied, statesPlayer[s]!, seen, regionStamp, stack);
    for (let bi = 0; bi < boxes.length; bi++) {
      const box = boxes[bi]!;
      for (const [dx, dy] of DIRS) {
        const d = dy * w + dx;
        const t = box + d;
        if (seen[box - d] !== regionStamp || wall[t] || occupied[t] || !live[t]) continue;
        occupied[box] = 0;
        occupied[t] = 1;
        if (frozenBlock(level, occupied, goal, t)) {
          occupied[t] = 0;
          occupied[box] = 1;
          continue;
        }
        const next = boxes.slice();
        next[bi] = t;
        next.sort((a, b) => a - b);
        const low = reach(level, occupied, box, mark, ++stamp, stack);
        const k = keyOf(next, low);
        const ng = g + 1;
        const prev = best.get(k);
        if (prev !== undefined && statesG[prev]! <= ng) {
          occupied[t] = 0;
          occupied[box] = 1;
          continue;
        }
        const h = heuristic(next);
        occupied[t] = 0;
        occupied[box] = 1;
        if (!Number.isFinite(h)) continue;
        const idx = statesBoxes.length;
        best.set(k, idx);
        statesBoxes.push(next);
        statesPlayer.push(box);
        statesG.push(ng);
        parent.push(s);
        pushFrom.push(box);
        pushTo.push(t);
        heapPush([ng + h, h, seq++, idx]);
        if (solved(next)) { found = idx; heap.length = 0; break; }
      }
      if (found >= 0) break;
    }
    for (const x of boxes) occupied[x] = 0;
  }
  if (found < 0) return null;
  const path: number[] = [];
  for (let s = found; s > 0; s = parent[s]!) path.push(s);
  path.reverse();
  let moves = '';
  let player = level.player;
  let boxes = level.boxes;
  for (const s of path) {
    const nextBoxes = statesBoxes[s]!;
    const from = pushFrom[s]!;
    const to = pushTo[s]!;
    const d = to - from;
    const dir = DIRS.find(([dx, dy]) => dy * w + dx === d)!;
    for (const b of boxes) occupied[b] = 1;
    moves += walkTo(level, occupied, player, from - d);
    for (const b of boxes) occupied[b] = 0;
    moves += dir[3];
    player = from;
    boxes = nextBoxes;
  }
  return { pushes: path.length, moves };
}

function endOf(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) {
    p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  }
  return p;
}

// Solve a level room by room; fall back to the whole level when it is no
// set of rooms. Returns the move string, or '' when unsolved.
function solve(text: string): string {
  const level = parseLevel(text);
  const rooms = roomsOf(level);
  if (rooms === null) {
    const r = solvePushAStar(level, WHOLE_EXPANSIONS);
    return r === null ? '' : r.moves;
  }
  let player = level.player;
  let moves = '';
  for (const room of rooms) {
    const wall = level.wall.slice();
    for (const other of rooms) {
      if (other === room) continue;
      for (const b of other.boxes) wall[b] = 1;
    }
    const sub: Level = {
      w: level.w,
      h: level.h,
      wall,
      goals: room.goals.slice().sort((a, b) => a - b),
      boxes: room.boxes.slice().sort((a, b) => a - b),
      player,
    };
    const r = solvePushAStar(sub, ROOM_EXPANSIONS);
    if (r === null) return '';
    moves += r.moves;
    player = endOf(level.w, player, r.moves);
    // Solved room's boxes now sit on its goals; the next room's sublevel
    // walls them off via room.boxes below, so they are never pushed again.
    room.boxes = room.goals.slice();
  }
  return moves;
}

for (const id of readdirSync(I).sort()) {
  const moves = solve(readFileSync(join(I, id, 'level.txt'), 'utf8'));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'solution.txt'), `${moves}\n`);
}
