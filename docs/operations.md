# Operating e20r

This guide applies to human runs and both agent instruction entrypoints
(`AGENTS.md` and `CLAUDE.md`). Run only the workload authorized for the task.
Documentation review needs no crawl or access to an existing research
database. Use a fresh isolated persistent cache for a bounded experiment.

## Resource model and tuning

`CONCURRENCY` controls repositories in flight: default **4**, allowed **1–16**.
It multiplies internal concurrency: each analyzing repository can read **8
whole non-declaration source files** concurrently (up to 32 reads at repo
concurrency 4). Manifest reads separately use concurrency 16 per repository.
These are work scheduling limits, not a memory budget.

`analyzeSources` reads files before checking `MAX_PARSE_BYTES` (default
1,000,000 bytes). Larger files still occupy memory as full strings and are
scanned for imports; the threshold avoids AST parsing and symbol collection,
not reading. Per-file outcomes, imports and symbols accumulate for the
repository until its transaction; source strings are released after each
file, but the retained results, tree inventory and manifests can be large.
Parser/native allocations, SQLite buffers and Git subprocesses add memory
outside the JavaScript heap. `--max-old-space-size` cannot cap that whole
process tree. Even concurrency 1 can exhaust a host on a large repository.

Blobless shallow clones and sparse checkouts reduce downloads; their `.git`
objects, trees, packs and indexes still take disk and memory. Measure the
whole cache, not just checked-out files. Normal completion/interruption
removes each clone unless `--keep-clones`; crashes can leave partial clones.
`process` wipes `<cache>/work` at startup. Database/journal files and logs
persist and grow independently; `--keep-clones` can accumulate many clones.
Neither RAM nor disk is bounded just by repository concurrency.

More concurrency does not guarantee more throughput. It can increase parser
CPU, allocation, I/O contention and GitHub throttling. Raising it does not
accelerate the sequential crawl. Keep the budget, parser threshold, exclusion
and analysis settings unchanged when comparing throughput; those affect the
population or measured output, not just performance.

## Before: measure and choose limits

Use Bash for the commands below. Inspect capacity immediately before launch,
including other jobs. `/tmp` may be tmpfs: confirm the actual backing store.

```bash
date -Is
nproc
free -h
awk '/^(MemAvailable|SwapTotal|SwapFree):/' /proc/meminfo
vmstat 1 6
df -h "$HOME" /tmp
findmnt -T "$HOME"
findmnt -T /tmp
ulimit -a
ps -eo pid,ppid,pgid,rss,pcpu,comm --sort=-rss | head -20
for tool in ps vmstat top pidstat timeout prlimit systemd-run; do
  command -v "$tool" || true
done
```

Ignore `vmstat`'s first, since-boot sample when assessing current `si`/`so`.
Existing swap occupancy is not itself current swapping; sample its change
and swap-in/out activity. Record open-file/process limits as well as CPU.

Maintain **at least 2 GiB MemAvailable and 10 GiB free disk** on the cache/log
filesystem. Stop on any sampled value below either reserve, or sustained
swap growth: three consecutive 5-second samples with increasing swap used
or `/proc/vmstat` `pswpout` (15 seconds). Stop even if pressure comes from
another host workload. Recheck before resuming; choose lower concurrency
and a smaller enforceable memory allowance if necessary.

A conservative starting policy on a shared 15 GiB / 8 logical CPU host:

| Fresh capacity                                                              | Starting choice                           |
| --------------------------------------------------------------------------- | ----------------------------------------- |
| At least 6 GiB available RAM and 12 GiB free disk, no sustained swap growth | Concurrency 2, whole-job memory cap 4 GiB |
| At least 4 GiB available RAM and 12 GiB free disk, no sustained swap growth | Concurrency 1, whole-job memory cap 2 GiB |
| Less headroom                                                               | Wait for capacity; do not start           |

These admission margins leave room before the stop reserves, not a promise
that repositories fit. Use concurrency 4 only after representative measured
process-tree peaks and host headroom justify it while preserving reserves.
Eight logical CPUs alone do not establish that. Record the choice, cap and
measurements. A short non-adopter sample cannot establish adopter peak RAM
or a reliable full-run ETA.

## Before: prepare an isolated run

Install and build in the source checkout, outside the timed workload. Use
the project runtime selected by pnpm, rather than an inherited `node`.

```bash
pnpm install --frozen-lockfile
pnpm build
E20R_SOURCE=$(pwd -P)
E20R_NODE=$(pnpm exec node -p 'process.execPath')
"$E20R_NODE" --version   # package.json currently selects v24.19.0
"$E20R_NODE" "$E20R_SOURCE/dist/index.js" run --help
E20R_ROOT="$HOME/e20r-runs/$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
mkdir -p "$E20R_ROOT"/{config,cache,logs,tmp}
df -h "$E20R_ROOT"
findmnt -T "$E20R_ROOT"   # choose a disk-backed path, outside disposable worktrees
```

Set `E20R_ROOT` to an approved persistent disk directory if `$HOME` is not
suitable. Put logs and temporary files there too; `--no-cache` loses resume
state and can put clones on tmpfs. Never reuse an unrelated cache, point at
an existing research database, or launch two writers against one cache.

Configuration is **flags over decoded `.env` values over code defaults**.
Effect 4.1.2 `fromDotEnv()` reads `.env` in the **working directory**; it
does not merge `process.env`. Variable expansion is disabled. A missing or
unreadable file fails startup; invalid values may fail before flags apply.
A completely empty file currently also fails the root configuration decode;
for commands needing no token, use a nonsecret recognized entry such as
`CACHE_PATH='.e20r'`. A credential-only file supplies the root object and
allows all other settings to default. Shell exports do not set the
application's options, including the GitHub token.

Copying `.env.example` selects budget **1,200**, whereas omitting that key
selects the code default **5,000**. The other normal defaults are concurrency
4, attempts 3, parse threshold 1,000,000, no extra exclusions, Effect copies
excluded, and all opt-in booleans false (`noCache`, `clean`, `fresh`,
`retryFailed`, `reanalyze`, `skipAnalysis`, `recrawl`, `keepClones`). Default
cache path `.e20r` is relative to the working directory. Use an explicit
absolute cache path and a safe concurrency; keep the other defaults for a
defaults experiment.

When authorized to reuse the checkout's credential, this programmatic copy
writes **only** `GITHUB_API_KEY` to the private runtime configuration. It
does not print the input, output or token, and does not execute shell code:

```bash
"$E20R_NODE" --input-type=module - "$E20R_SOURCE/.env" "$E20R_ROOT/config/.env" <<'JS'
import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
const token = parseEnv(readFileSync(process.argv[2], "utf8")).GITHUB_API_KEY;
if (!token || !/^[A-Za-z0-9_]+$/.test(token)) {
  throw new Error("Missing or unsupported token format; configure privately");
}
writeFileSync(process.argv[3], `GITHUB_API_KEY='${token}'\n`, { mode: 0o600, flag: "wx" });
JS
```

Otherwise create that file privately with an editor. Do not print, source,
commit or attach it to a report. Do not use `set -x`, `ps e`, environment
dumps or Git HTTP tracing. Git authentication uses an environment header,
not command arguments, but environment inspection would expose it.

## During: launch, monitor and interrupt

On Linux with delegated user cgroups, first verify a harmless limit probe:

```bash
systemd-run --user --wait --pipe --unit=e20r-limit-probe \
  -p MemoryHigh=3G -p MemoryMax=4G -p MemorySwapMax=0 \
  -p TasksMax=128 -p CPUQuota=400% /usr/bin/true
```

For concurrency 2, the following limits apply to Node **and all Git children**.
For concurrency 1, use `MemoryHigh=1536M`, `MemoryMax=2G`. CPUQuota 400%
allows four CPUs' worth of execution; it is a ceiling, not a speedup claim.
`MemoryHigh` can throttle reclaim; `MemoryMax` can cause OOM termination.
The host reserve watchdog is still necessary: cgroups cannot reserve RAM or
disk against unrelated jobs. `ulimit -m` is not a useful Linux RSS cap;
per-process address-space limits are not a substitute for a whole-job cap.
If cgroups are unavailable, record that and use a supported equivalent or
concurrency 1 with active monitoring; do not claim a hard memory bound.

```bash
E20R_UNIT="e20r-$(date -u +%Y%m%dT%H%M%SZ)"
cd "$E20R_ROOT/config"
systemd-run --user --wait --pipe --unit="$E20R_UNIT" \
  --working-directory="$E20R_ROOT/config" \
  -p MemoryHigh=3G -p MemoryMax=4G -p MemorySwapMax=0 \
  -p TasksMax=128 -p CPUQuota=400% -p OOMPolicy=kill \
  -p KillMode=mixed -p KillSignal=SIGINT -p TimeoutStopSec=30s \
  -p RuntimeMaxSec=1770s \
  /usr/bin/env -i PATH="$(dirname "$E20R_NODE"):/usr/bin:/bin" HOME="$HOME" \
  TMPDIR="$E20R_ROOT/tmp" LANG=C.UTF-8 \
  "$E20R_NODE" "$E20R_SOURCE/dist/index.js" run \
  --cache-path "$E20R_ROOT/cache" --concurrency 2 \
  >>"$E20R_ROOT/logs/run.log" 2>&1
```

Launch through a persistent terminal (`hc run --bg` / `hc wait` in the agent
harness, or tmux) and monitor from another terminal. The 30-minute allocation
includes the crawl: interrupt after 29m30s, leaving up to 30 seconds for
cleanup. Do not extend the experiment just to reach 5,000 repositories.
The timer remains enforced if the monitoring terminal disconnects.

Sample reserves and swap every 5 seconds; measure disk/cache growth and
throughput every 30 seconds. These commands inspect no process environment:

```bash
systemctl --user show "$E20R_UNIT" -p MainPID -p ControlGroup -p MemoryCurrent -p CPUUsageNSec -p TasksCurrent -p Result
E20R_CGROUP=$(systemctl --user show "$E20R_UNIT" -p ControlGroup --value)
cat "/sys/fs/cgroup$E20R_CGROUP/cgroup.procs"
ps -eo pid,ppid,pgid,rss,pcpu,etime,comm --forest
top -b -n 1 -w 120 | head -25
awk '/^(MemAvailable|SwapTotal|SwapFree):/' /proc/meminfo
awk '/^pswp(in|out) /' /proc/vmstat
vmstat 1 6
df -B1 "$E20R_ROOT"
du -sx --block-size=1 "$E20R_ROOT/cache" "$E20R_ROOT/logs" "$E20R_ROOT/tmp"
tail -n 30 "$E20R_ROOT/logs/run.log"
rg 'Page |Crawl complete|Processing |progress |failed at|rate limit|pausing new clones|Stopping:' "$E20R_ROOT/logs/run.log"
```

Identify Node and Git descendants from the cgroup and process tree; sum RSS
as an approximation (shared pages can be counted twice), and use cgroup
memory/CPU counters for the whole job. Node 24 can appear as `MainThread` in
`comm`; identify the main process by the unit's MainPID, not just its name.
`pidstat`/`htop` are optional; `ps`,
`top`, `vmstat`, `/proc` and cgroup counters suffice when they are absent.
Log samples with timestamps. For automatic unattended runs, use a watchdog
that samples those reserves and requests service stop on the exact criteria
above; a terminal log alone does not enforce them.

For example, run this reserve watchdog in the monitoring terminal once the
service is running, with the same `E20R_UNIT` and `E20R_ROOT` values. The
service's own timer/caps remain necessary if this observer is interrupted:

```bash
E20R_PREV_SWAP=0
E20R_PREV_OUT=0
E20R_GROWTH=0
E20R_HAVE_PREV=0
while :; do
  E20R_MAIN=$(systemctl --user show "$E20R_UNIT" -p MainPID --value) || break
  case "$E20R_MAIN" in ''|0) break ;; esac
  E20R_AVAIL=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
  E20R_SWAP=$(awk '/^SwapTotal:/ {t=$2} /^SwapFree:/ {f=$2} END {print t-f}' /proc/meminfo)
  E20R_OUT=$(awk '/^pswpout / {print $2}' /proc/vmstat)
  E20R_FREE=$(df --output=avail -B1 "$E20R_ROOT" | tail -n 1)
  if (( E20R_HAVE_PREV && (E20R_SWAP > E20R_PREV_SWAP || E20R_OUT > E20R_PREV_OUT) )); then
    E20R_GROWTH=$((E20R_GROWTH + 1))
  else
    E20R_GROWTH=0
  fi
  printf '%s MemAvailable_KiB=%s swap_used_KiB=%s pswpout=%s disk_free_bytes=%s growth_intervals=%s\n' \
    "$(date -Is)" "$E20R_AVAIL" "$E20R_SWAP" "$E20R_OUT" "$E20R_FREE" "$E20R_GROWTH" \
    >>"$E20R_ROOT/logs/reserves.log"
  if (( E20R_AVAIL < 2097152 || E20R_FREE < 10737418240 || E20R_GROWTH >= 3 )); then
    systemctl --user stop --no-block "$E20R_UNIT"
    break
  fi
  E20R_PREV_SWAP=$E20R_SWAP
  E20R_PREV_OUT=$E20R_OUT
  E20R_HAVE_PREV=1
  sleep 5
done
```

Crawl pages are paced at 6 seconds per request and may wait on 403/429
responses. Processing logs each completed repository and emits a rollup
after a completion when at least 30 seconds elapsed. No rollup during a
long clone or analysis does not prove a hang. Track completed successes
separately from failures and crawl pages. Git steps have individual timeouts
and retries; the network breaker pauses after 12 consecutive network-stage
failures for 2, 4, 8, 16, then 30 minutes, and halts on the next trip without
a success. Do not increase concurrency to overcome a rate limit.

On a reserve breach, sustained swap growth or the time limit, interrupt
cleanly. For a foreground direct Node process use Ctrl-C or `kill -INT PID`;
for the service use the first command below. It signals the main process
and allows scoped Git cleanup before forcibly killing any remaining cgroup
processes after 30 seconds:

```bash
systemctl --user stop --no-block "$E20R_UNIT"
systemctl --user show "$E20R_UNIT" -p ActiveState -p SubState -p MainPID -p Result
```

## After: stop, verify and resume

Confirm the launcher exited and the cgroup has no live tasks (its directory
may already be removed). Record whether cleanup needed a forced kill or OOM.
Remove only this run's private `config/.env`; retain cache and logs. Never
kill all Node/Git processes on a shared machine.

Use a read-only connection to **this isolated database** to verify persisted
progress after the timed interruption. Do not substitute a research cache.
Python's SQLite module is sufficient when `sqlite3` CLI is unavailable:

```bash
python3 - "$E20R_ROOT/cache/e20r.db" <<'PY'
import pathlib, sqlite3, sys
p = pathlib.Path(sys.argv[1]).resolve()
with sqlite3.connect(p.as_uri() + "?mode=ro", uri=True) as db:
    print("quick_check:", db.execute("PRAGMA quick_check").fetchall())
    print("crawled:", db.execute("SELECT count(*) FROM repos").fetchone())
    print("cursor:", db.execute("SELECT complete,budget,pages FROM crawl_state").fetchall())
    print("states:", db.execute("SELECT status,count(*) FROM repo_state GROUP BY status").fetchall())
    print("runs:", db.execute("SELECT id,command,started_at,finished_at FROM runs").fetchall())
PY
du -sh "$E20R_ROOT/cache" "$E20R_ROOT/logs" "$E20R_ROOT/tmp"
df -h "$E20R_ROOT"
rm -- "$E20R_ROOT/config/.env"
```

Committed pages and per-repository transactions survive interruption.
An interrupted `runs` row normally keeps `finished_at` NULL: that alone is
not corruption. In-flight repositories are repeated; failed repositories
retry only while under `MAX_ATTEMPTS` (3 by default). Resume after fresh
capacity checks and credential preparation, using the **same absolute cache**
and settings, with lower concurrency if needed. `run` resumes an incomplete
crawl or skips one already complete for the budget, then processes pending
repositories. It clears leftover work directories before processing; clone
contents are not resume state. Do not add `--clean`, `--fresh`, `--recrawl`,
`--no-cache` or `--retry-failed` to a routine resume.

Report elapsed crawl and processing time separately, counts by status,
failures/throttling, whole-job memory/CPU peaks, minimum available RAM/disk,
swap activity, final cache/log sizes, runtime version, settings, stop reason
and shutdown verification. A short or crawl-only sample may not support an
ETA; say so when processing evidence is insufficient. With substantial
processing and some adopters observed, give a provisional estimate under
the measured throughput and repository mix, with the sample counts, time
window and uncertainty explicit. A mostly non-adopter mix is expected and
does not alone rule out an estimate. Separate crawl time and failures;
the CLI's running average mixes repository sizes and failures. Such an
estimate is conditional on host/network conditions and the remaining mix,
not a reliable prediction of the full population or of adopter peak RAM.

Implementation references: [configuration](../src/config.ts),
[command/runtime wiring](../src/index.ts),
[file analysis](../src/deep-analysis/analyze.ts),
[processing and breaker](../src/pipeline/run.ts), and
[Git children](../src/github/git.ts). Verify the installed Effect version's
provider/runtime implementation when upgrading; a reference clone can be on
a different version.
