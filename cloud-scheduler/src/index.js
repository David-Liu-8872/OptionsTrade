/**
 * Cloudflare Worker Cron Trigger for OptionsTrade 30-Day Autonomous Paper Trader.
 * Runs 100% in Cloudflare's global cloud every 30 mins during US market hours (computer can stay completely off).
 * Dispatches GitHub Actions `auto_paper_trade.yml` via `workflow_dispatch` with deduplication.
 */

const REPO = "David-Liu-8872/OptionsTrade";
const WORKFLOW_FILE = "auto_paper_trade.yml";

const nyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function getNyClock(date = new Date()) {
  const parts = {};
  for (const p of nyFmt.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday, // Mon, Tue, Wed, Thu, Fri, Sat, Sun
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function isUsMarketOrClosingWindow(ny) {
  if (ny.weekday === "Sat" || ny.weekday === "Sun") {
    return { active: false, reason: `Weekend (${ny.weekday})` };
  }
  const md = `${String(ny.month).padStart(2, "0")}-${String(ny.day).padStart(2, "0")}`;
  if (["01-01", "06-19", "07-04", "12-25"].includes(md)) {
    return { active: false, reason: `NYSE Holiday (${ny.isoDate})` };
  }
  // Thanksgiving: 4th Thursday of November
  if (ny.month === 11 && ny.weekday === "Thu" && ny.day >= 22 && ny.day <= 28) {
    return { active: false, reason: `US Thanksgiving Holiday (${ny.isoDate})` };
  }

  const isBlackFriday = ny.month === 11 && ny.weekday === "Fri" && ny.day >= 23 && ny.day <= 29;
  const isChristmasEve = md === "12-24";
  const openMin = 9 * 60 + 35; // 09:35 ET
  const closeGraceMin = (isBlackFriday || isChristmasEve) ? (13 * 60 + 25) : (16 * 60 + 25);
  const mins = ny.hour * 60 + ny.minute;

  if (mins < openMin || mins > closeGraceMin) {
    return { active: false, reason: `Outside US market hours (${ny.hour}:${String(ny.minute).padStart(2, "0")} ET)` };
  }
  return { active: true, reason: "Active US trading / closing settlement window" };
}

async function triggerIfDue(env) {
  const ny = getNyClock();
  const gate = isUsMarketOrClosingWindow(ny);
  if (!gate.active) {
    return { triggered: false, reason: gate.reason, ny };
  }

  if (!env.GITHUB_PAT) {
    return { triggered: false, error: "Missing GITHUB_PAT secret in Worker" };
  }

  const ghHeaders = {
    Authorization: `Bearer ${env.GITHUB_PAT}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "OptionsTrade-Cloudflare-Cron-Worker",
  };

  // Dedupe: skip if GitHub already started a run within the last 18 minutes
  try {
    const runsRes = await fetch(
      `https://api.github.com/repos/${REPO}/actions/runs?per_page=2`,
      { headers: ghHeaders }
    );
    if (runsRes.ok) {
      const runsData = await runsRes.json();
      const latest = (runsData.workflow_runs || [])[0];
      if (latest) {
        if (["queued", "in_progress", "waiting"].includes(latest.status)) {
          return { triggered: false, reason: `Run ${latest.id} already ${latest.status}`, ny };
        }
        const ageMin = (Date.now() - Date.parse(latest.created_at)) / 60000;
        if (ageMin < 18) {
          return { triggered: false, reason: `Recent run ${latest.id} ran ${ageMin.toFixed(1)}m ago`, ny };
        }
      }
    }
  } catch {
    // proceed to dispatch
  }

  const dispRes = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main" }),
    }
  );

  return {
    triggered: dispRes.status === 204,
    httpStatus: dispRes.status,
    ny,
  };
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      triggerIfDue(env).then((res) => {
        console.log(`[Cron ${controller.cron}]`, JSON.stringify(res));
      })
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/dispatch-now") {
      const auth = request.headers.get("Authorization") || "";
      if (!env.DISPATCH_SECRET || auth !== `Bearer ${env.DISPATCH_SECRET}`) {
        return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      const forceGate = url.searchParams.get("bypass_gate") === "1";
      if (!forceGate) {
        const res = await triggerIfDue(env);
        return new Response(JSON.stringify({ ok: true, ...res }, null, 2), {
          headers: { "Content-Type": "application/json" },
        });
      }
      const dispRes = await fetch(
        `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.GITHUB_PAT}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "OptionsTrade-Cloudflare-Cron-Worker",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ref: "main" }),
        }
      );
      return new Response(
        JSON.stringify({ ok: dispRes.status === 204, httpStatus: dispRes.status }, null, 2),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const ny = getNyClock();
    const gate = isUsMarketOrClosingWindow(ny);
    return new Response(
      JSON.stringify(
        {
          ok: true,
          worker: "optionstrade-cron-trigger",
          schedule_utc: "7,37 13-21 * * MON-FRI",
          ny_now: `${ny.isoDate} ${String(ny.hour).padStart(2, "0")}:${String(ny.minute).padStart(2, "0")} ET (${ny.weekday})`,
          market_gate: gate,
          has_github_pat: Boolean(env.GITHUB_PAT),
          pathname: url.pathname,
        },
        null,
        2
      ),
      { headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  },
};
