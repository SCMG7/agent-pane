# agent-pane

An IDE-style side pane for Claude Code. It shows the project you are in, what
the agent is doing right now, how long the turn has taken against a running
estimate, the context window and its distance to compaction, token usage and
cost, rate limits with the prompt-cache countdown, the subagents at work, and a
live feed of tool calls, in sections you can fold.

```
 █   ██ ███ █  █ ███     ██   █  █  █ ███
█ █ █   █   ██ █  █      █ █ █ █ ██ █ █
███ █ █ ██  █ ██  █  ███ ██  ███ █ ██ ██
█ █ █ █ █   █  █  █      █   █ █ █  █ █
█ █  ██ ███ █  █  █      █   █ █ █  █ ███
◉ Agent                       1h 12m · 5 turns  ⊟ ↻
──────────────────────────────────────────────────
  ▄▀▀▀▀▀▀▄     Claude  Fable 5.1
 ▐ ●    ● ▌    writing..
  ▀▄▄▄▄▄▄▀     step 3 · 4 tool calls
   ▀ ▀ ▀ ▀     ⠋ editing hooks/register.tsx
               $0.12 this turn · $1.23 total
▾ TASK                                   
  refactor the side panel
▾ TURN                             0:42 / ~1:05
  ━━━━━━━━━━━━━━━━━━━━━━━━━━──────   38 tok/s
▾ CONTEXT                                   38%
  ━━━━━━━━━━━━━━━━━━━━━━━━━━──────  76k / 200k
▾ USAGE                                    $1.23
▾ LIMITS                            cache 47m
▾ AGENTS                               1 running
▾ ACTIVITY                              1 running
  ⠋  Edit  hooks/register.tsx               0.3s
  ✓  Read  hooks/theme.ts                   0.1s
  ✓  Bash  Run the test suite                12s
```

## Install

At the prompt of a terminal session:

```
/plugin install agent-pane --marketplace SCMG7/agent-pane
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```
claude plugin install agent-pane --marketplace SCMG7/agent-pane
```

The pane opens when a session starts. If the terminal is too narrow it waits
and seats itself at your first prompt; `/agent-pane` opens it at any width.

## Commands

| Command                | What it does                                   |
| ---------------------- | ---------------------------------------------- |
| `/agent-pane`          | Open the pane                                  |
| `/agent-pane compact`  | Fold every section to its header line          |
| `/agent-pane expand`   | Unfold them                                    |
| `/agent-pane close`    | Close the pane                                 |
| `/agent-pane reset`    | Forget the saved layout                        |

Click a section header to fold it; the layout is remembered across sessions.
With the pane focused, `c` toggles compact, `r` re-reads the usage figures and
`x` clears the activity feed.

## Options

Set in `/config` under the plugin's name.

| Option   | Values                   | Meaning                                                         |
| -------- | ------------------------ | --------------------------------------------------------------- |
| `glyphs` | `auto`, `nerd`, `plain`  | Nerd Font pictograms when such a font is installed, or Unicode only |
| `avatar` | `on`, `off`              | Draw the pixel Clawd at the top when there is room               |
| `start`  | `on`, `off`              | Open the pane when a session starts                              |

The pixel art (the project name, Clawd, the agent crabs) is drawn with
half-block characters, which every terminal font has. The small pictograms in
the activity feed use the Font Awesome range of Nerd Fonts, which every Nerd
Font build carries.

## Developing

Run the folder directly instead of installing it:

```
claude --plugin-dir /path/to/agent-pane
```

or name it in `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of
`~/.claude/settings.json`. An interactive session then reloads the mod when a
file is saved.

```
claude plugin validate .
npx -y -p typescript@5.6.3 tsc -p .
claude plugin test .
```

Type-checking needs the engine's generated types, which appear in
`.claude-plugin/types/` the first time a session loads the mod.
