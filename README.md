# sokoban-solver-01-run-20261121

Push-optimal Sokoban solver for make.fun's "Build the best Sokoban solver, 21 November 2026" bounty ($100).

## How it works

The generator lays a hallway across the board with rooms off it, each room
holding 3–4 boxes and as many goals, and a box pushed out of a room can
never be pushed back — so a level's push optimum is the sum of its rooms'
optima. The solver finds the rooms by cutting the hallway row's dead
squares (floor cells of the player's row from which a box can never reach
a goal) out of the floor, then solves each room independently with A*
over pushes:

- a state is the boxes' squares plus the player's reachable region
  (named by its lowest square);
- the estimate is the cheapest matching of boxes to goals, using each
  box's shortest push path ignoring the other boxes — admissible, so the
  first solved state popped is push-optimal;
- deadlocks are pruned: a box on a square from which no goal is reachable
  by pulling, and a box in a frozen 2×2 block of walls/boxes off its goal.

Search is bounded by a fixed number of expansions, never by the clock,
so two runs write the same bytes.

## Results (practice set, kit's sealed scorer)

| | Score |
|---|---|
| This solver | **1,000,000** (all 5 instances push-optimal) |
| House baseline (plain-astar 1.0.0) | 200,000 (only i001 solved) |

Three further sets drawn fresh from the kit's generator with new seeds
also scored 1,000,000 each, in 0.34–0.66 s per set (limit: 60 s).

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` reads `/input/<id>/level.txt` for i001–i005 and writes
`/output/<id>/solution.txt` for each.

## Entry

- Competition: https://make.fun/bounty/sokoban-solver-01-run-20261121
- Owner / repo: m1651/makefun-sokoban-solver
