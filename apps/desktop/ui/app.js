"use strict";
const { invoke } = window.__TAURI__.core;

const ROW_H = 28, LANE_W = 14, PAD = 10;
const COLORS = ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#c084fc", "#2dd4bf", "#fb923c", "#f87171"];
const $ = (id) => document.getElementById(id);

let repoPath = "";   // location string the backend understands
let snapshot = null;

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  n.append(...children);
  return n;
}

function showError(e) {
  const box = $("error");
  box.hidden = !e;
  box.textContent = e ? String(e) : "";
}

async function call(cmd, args) {
  try { showError(null); return await invoke(cmd, args); }
  catch (e) { showError(e); throw e; }
}

// Windows UNC form for WSL repos so a path round-trips through Location::parse.
function pathOf(info) {
  const loc = info.location;
  if (!loc.wsl_distro) return loc.path;
  return `\\\\wsl.localhost\\${loc.wsl_distro}${loc.path.replace(/\//g, "\\")}`;
}

async function load(path) {
  snapshot = await call("load_repo", { path, limit: 500 });
  repoPath = pathOf(snapshot.info);
  $("path").value = repoPath;
  render();
}

function render() {
  const { info, status, branches, worktrees, log } = snapshot;

  const badges = $("repo-badges");
  badges.replaceChildren();
  badges.append(el("span", { class: "badge" }, info.head_branch ?? "detached HEAD"));
  if (info.is_linked_worktree) badges.append(el("span", { class: "badge" }, "linked worktree"));
  if (info.is_bare) badges.append(el("span", { class: "badge" }, "bare"));
  if (info.location.wsl_distro) badges.append(el("span", { class: "badge" }, `WSL: ${info.location.wsl_distro}`));

  $("branches").replaceChildren(...branches.map((b) =>
    el("li", {
      class: "click" + (b.is_head ? " head" : ""),
      title: b.subject,
      ondblclick: async () => { if (!b.is_remote) { await call("checkout", { path: repoPath, branch: b.name }); await load(repoPath); } },
    }, el("span", { class: "path" }, b.name))));

  $("worktrees").replaceChildren(...worktrees.map((w) =>
    el("li", { class: "click", title: w.path, onclick: () => open(toDisplay(w.path, info)) },
      el("span", { class: "path" }, w.path.split("/").filter(Boolean).pop() ?? w.path),
      el("span", { class: "st" }, w.branch ?? "detached"))));

  const staged = status.files.filter((f) => f.index !== " " && f.index !== "?");
  const unstaged = status.files.filter((f) => f.worktree !== " ");
  $("staged").replaceChildren(...staged.map((f) => fileRow(f, true)));
  $("unstaged").replaceChildren(...unstaged.map((f) => fileRow(f, false)));

  renderLog(log);
}

// Worktree paths come back as paths valid inside the repo's environment.
function toDisplay(p, info) {
  return info.location.wsl_distro ? `\\\\wsl.localhost\\${info.location.wsl_distro}${p.replace(/\//g, "\\")}` : p;
}

function fileRow(f, isStaged) {
  const letter = isStaged ? f.index : f.worktree;
  const untracked = f.worktree === "?";
  return el("li", { class: "click", onclick: () => showDiff(f, isStaged, untracked) },
    el("span", { class: "path", title: f.path }, el("span", { class: "st" }, letter), f.path),
    el("button", {
      onclick: async (ev) => {
        ev.stopPropagation();
        await call(isStaged ? "unstage" : "stage", { path: repoPath, files: [f.path] });
        await load(repoPath);
      },
    }, isStaged ? "−" : "+"));
}

async function showDiff(f, staged, untracked) {
  const text = await call("diff", { path: repoPath, file: f.path, staged, untracked });
  const pre = $("diff");
  pre.replaceChildren(...text.split("\n").map((line) => {
    const cls = line.startsWith("+") && !line.startsWith("+++") ? "a"
      : line.startsWith("-") && !line.startsWith("---") ? "d"
      : line.startsWith("@@") ? "h" : "";
    return el("div", { class: cls }, line || " ");
  }));
}

function renderLog(log) {
  const maxW = Math.max(1, ...log.map((e) => e.graph.width));
  const svgW = PAD * 2 + maxW * LANE_W;
  const x = (lane) => PAD + lane * LANE_W + LANE_W / 2;
  const mid = ROW_H / 2;
  const NS = "http://www.w3.org/2000/svg";
  const line = (x1, y1, x2, y2, color) => {
    const l = document.createElementNS(NS, "line");
    for (const [k, v] of Object.entries({ x1, y1, x2, y2, stroke: color, "stroke-width": 2 })) l.setAttribute(k, v);
    return l;
  };

  $("log").replaceChildren(...log.map((e) => {
    const g = e.graph;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", svgW);
    svg.setAttribute("height", ROW_H);
    const color = (lane) => COLORS[lane % COLORS.length];
    for (const l of g.through) svg.append(line(x(l), 0, x(l), ROW_H, color(l)));
    for (const l of g.incoming) svg.append(line(x(l), 0, x(g.lane), mid, color(l)));
    for (const o of g.outgoing) svg.append(line(x(g.lane), mid, x(o.to), ROW_H, color(o.to)));
    const dot = document.createElementNS(NS, "circle");
    for (const [k, v] of Object.entries({ cx: x(g.lane), cy: mid, r: 4.5, fill: color(g.lane) })) dot.setAttribute(k, v);
    svg.append(dot);

    const refs = e.refs.map((r) => el("span", { class: "ref" }, r.replace("HEAD -> ", "● ")));
    const when = new Date(e.time * 1000).toLocaleDateString();
    return el("div", { class: "row", title: e.hash },
      svg, ...refs, el("span", { class: "subject" }, e.subject),
      el("span", { class: "meta" }, `${e.author} · ${when} · ${e.hash.slice(0, 7)}`));
  }));
}

async function open(path) {
  try { await load(path); } catch (_) { /* error already shown */ }
}

$("open").addEventListener("click", () => open($("path").value.trim()));
$("path").addEventListener("keydown", (e) => { if (e.key === "Enter") open($("path").value.trim()); });
$("refresh").addEventListener("click", () => repoPath && open(repoPath));
$("commit").addEventListener("click", async () => {
  const message = $("message").value;
  try {
    await call("commit", { path: repoPath, message });
    $("message").value = "";
    $("diff").replaceChildren();
    await load(repoPath);
  } catch (_) { /* error already shown */ }
});

(async () => {
  $("version").textContent = "v" + (await invoke("app_version"));
  const initial = await invoke("initial_path");
  if (initial) open(initial);
})();
