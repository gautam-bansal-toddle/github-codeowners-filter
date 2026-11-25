(() => {
  "use strict";

  const PR_CHANGES_RE = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:changes|files)(?:\/|$)/;
  const CODEOWNERS_LOCATIONS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];
  const NO_OWNER = "__no_owner__";
  const IDS = { button: "cof-button", panel: "cof-panel", style: "cof-hide-style" };

  const codeownersCache = new Map(); // "owner/repo@ref" -> Promise<rules|null>

  let state = null; // { key, files: [{path, digest, owners}], owners: Map, selected: Set, error, loading }
  let currentKey = null;

  // ---------- data loading ----------

  function parsePrLocation() {
    const m = location.pathname.match(PR_CHANGES_RE);
    if (!m) return null;
    return { owner: m[1], repo: m[2], number: m[3], key: `${m[1]}/${m[2]}#${m[3]}` };
  }

  function extractRoute(doc, number) {
    for (const s of doc.querySelectorAll('script[data-target="react-app.embeddedData"]')) {
      try {
        const route = JSON.parse(s.textContent)?.payload?.pullRequestsChangesRoute;
        if (!route?.diffSummaries) continue;
        const url = String(route.pullRequestUrl || route.urls?.pullRequestUrl || "");
        if (url && !new RegExp(`/pull/${number}(?:$|[/?#])`).test(url)) continue;
        return route;
      } catch (e) {
        /* ignore */
      }
    }
    return null;
  }

  async function loadRoute(pr) {
    // The embedded data can be stale after GitHub's client-side navigation, so fall back to
    // fetching the page HTML.
    let route = extractRoute(document, pr.number);
    if (route) return route;
    const res = await fetch(`/${pr.owner}/${pr.repo}/pull/${pr.number}/changes`, {
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error(`Could not load PR page (${res.status})`);
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    route = extractRoute(doc, pr.number);
    if (!route) throw new Error("Could not find PR file data on the page");
    return route;
  }

  function encodeRef(ref) {
    return ref.split("/").map(encodeURIComponent).join("/");
  }

  function loadCodeowners(owner, repo, ref) {
    const cacheKey = `${owner}/${repo}@${ref}`;
    if (!codeownersCache.has(cacheKey)) {
      const p = (async () => {
        for (const loc of CODEOWNERS_LOCATIONS) {
          try {
            const res = await fetch(`/${owner}/${repo}/raw/${encodeRef(ref)}/${loc}`, {
              credentials: "same-origin",
            });
            if (res.ok) return CodeOwners.parse(await res.text());
          } catch (e) {
            /* try next location */
          }
        }
        return null;
      })();
      p.catch(() => codeownersCache.delete(cacheKey));
      codeownersCache.set(cacheKey, p);
    }
    return codeownersCache.get(cacheKey);
  }

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function buildState(pr) {
    const route = await loadRoute(pr);
    const base = route.pullRequest?.baseBranch || route.comparison?.baseOid;
    if (!base) throw new Error("Could not determine the base branch");
    const rules = await loadCodeowners(pr.owner, pr.repo, base);
    if (!rules) throw new Error(`No CODEOWNERS file found on ${base}`);

    const files = await Promise.all(
      route.diffSummaries.map(async (d) => ({
        path: d.path,
        digest: d.pathDigest || (await sha256Hex(d.path)),
        owners: CodeOwners.ownersFor(rules, d.path),
      }))
    );

    const owners = new Map();
    for (const f of files) {
      const list = f.owners.length ? f.owners : [NO_OWNER];
      for (const o of list) owners.set(o, (owners.get(o) || 0) + 1);
    }
    return { files, owners };
  }

  // ---------- persistence (remember selection per repo) ----------

  function storageKey(pr) {
    return `cof:selected:${pr.owner}/${pr.repo}`;
  }

  function loadSelection(pr) {
    try {
      return new Set(JSON.parse(localStorage.getItem(storageKey(pr)) || "[]"));
    } catch (e) {
      return new Set();
    }
  }

  function saveSelection(pr, selected) {
    try {
      localStorage.setItem(storageKey(pr), JSON.stringify([...selected]));
    } catch (e) {
      /* ignore */
    }
  }

  // ---------- filtering ----------

  function cssString(s) {
    return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ") + '"';
  }

  function activeSelection() {
    if (!state?.files) return new Set();
    return new Set([...state.selected].filter((o) => state.owners.has(o)));
  }

  function isVisible(file, selected) {
    if (!selected.size) return true;
    if (!file.owners.length) return selected.has(NO_OWNER);
    return file.owners.some((o) => selected.has(o));
  }

  function applyFilter() {
    let style = document.getElementById(IDS.style);
    const selected = activeSelection();
    if (!state?.files || !selected.size) {
      style?.remove();
      updateButton();
      return;
    }

    const hiddenFiles = [];
    const visibleDirs = new Set();
    const allDirs = new Set();
    for (const f of state.files) {
      const parts = f.path.split("/");
      const visible = isVisible(f, selected);
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join("/");
        allDirs.add(dir);
        if (visible) visibleDirs.add(dir);
      }
      if (!visible) hiddenFiles.push(f);
    }

    const selectors = [];
    for (const f of hiddenFiles) {
      selectors.push(`#diff-${f.digest}`);
      selectors.push(`#pr-file-tree [role="treeitem"][id=${cssString(f.path)}]`);
    }
    for (const dir of allDirs) {
      if (!visibleDirs.has(dir)) {
        selectors.push(`#pr-file-tree [role="treeitem"][id=${cssString(dir)}]`);
      }
    }

    if (!style) {
      style = document.createElement("style");
      style.id = IDS.style;
      document.head.appendChild(style);
    }
    style.textContent = selectors.length ? `${selectors.join(",\n")} { display: none !important; }` : "";
    updateButton();
  }

  // ---------- UI ----------

  const PEOPLE_ICON =
    '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M2 5.5a3.5 3.5 0 1 1 5.898 2.549 5.508 5.508 0 0 1 3.034 4.084.75.75 0 1 1-1.482.235 4 4 0 0 0-7.9 0 .75.75 0 0 1-1.482-.236A5.507 5.507 0 0 1 3.102 8.05 3.493 3.493 0 0 1 2 5.5ZM11 4a3.001 3.001 0 0 1 2.22 5.018 5.01 5.01 0 0 1 2.56 3.012.749.749 0 0 1-.885.954.752.752 0 0 1-.549-.514 3.507 3.507 0 0 0-2.522-2.372.75.75 0 0 1-.574-.73v-.352a.75.75 0 0 1 .416-.672A1.5 1.5 0 0 0 11 5.5.75.75 0 0 1 11 4Zm-5.5-.5a2 2 0 1 0-.001 3.999A2 2 0 0 0 5.5 3.5Z"></path></svg>';

  function ownerLabel(o) {
    return o === NO_OWNER ? "No owner" : o;
  }

  function updateButton() {
    const btn = document.getElementById(IDS.button);
    if (!btn) return;
    const selected = activeSelection();
    btn.classList.toggle("cof-active", selected.size > 0);
    const badge = btn.querySelector(".cof-badge");
    badge.textContent = selected.size ? String(selected.size) : "";
    badge.hidden = !selected.size;

    let title = "Filter by code owner";
    if (state?.loading) title += " (loading…)";
    else if (state?.error) title += ` (${state.error})`;
    else if (state?.files && selected.size) {
      const shown = state.files.filter((f) => isVisible(f, selected)).length;
      title = `Code owners: showing ${shown} of ${state.files.length} files`;
    }
    btn.title = title;
    btn.setAttribute("aria-label", title);
  }

  function ensureButton() {
    const host = document.getElementById("diff-file-tree-filter");
    if (!host || document.getElementById(IDS.button)) return;
    const btn = document.createElement("button");
    btn.id = IDS.button;
    btn.type = "button";
    btn.className = "cof-button";
    btn.innerHTML = `${PEOPLE_ICON}<span class="cof-badge" hidden></span>`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePanel();
    });
    host.appendChild(btn);
    updateButton();
  }

  function closePanel() {
    document.getElementById(IDS.panel)?.remove();
  }

  function togglePanel() {
    if (document.getElementById(IDS.panel)) closePanel();
    else openPanel();
  }

  function positionPanel(panel) {
    const btn = document.getElementById(IDS.button);
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 16);
    panel.style.width = `${width}px`;
    panel.style.top = `${r.bottom + 6}px`;
    panel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - width - 8))}px`;
    panel.style.maxHeight = `${Math.max(200, window.innerHeight - r.bottom - 24)}px`;
  }

  function openPanel() {
    closePanel();
    const panel = document.createElement("div");
    panel.id = IDS.panel;
    panel.className = "cof-panel";
    panel.addEventListener("click", (e) => e.stopPropagation());
    document.body.appendChild(panel);
    renderPanel(panel);
    positionPanel(panel);
    panel.querySelector(".cof-search")?.focus();
  }

  function renderPanel(panel = document.getElementById(IDS.panel)) {
    if (!panel) return;
    const prevQuery = panel.querySelector(".cof-search")?.value || "";
    panel.innerHTML = "";

    const header = document.createElement("div");
    header.className = "cof-header";
    header.innerHTML = '<span class="cof-title">Code owners</span>';
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "cof-link";
    clear.textContent = "Clear";
    clear.disabled = !activeSelection().size;
    clear.addEventListener("click", () => {
      state.selected.clear();
      saveSelection(parsePrLocation(), state.selected);
      applyFilter();
      renderPanel();
    });
    header.appendChild(clear);
    panel.appendChild(header);

    if (!state || state.loading) {
      panel.appendChild(message("Loading CODEOWNERS…"));
      return;
    }
    if (state.error) {
      panel.appendChild(message(state.error));
      return;
    }

    const search = document.createElement("input");
    search.type = "text";
    search.className = "cof-search";
    search.placeholder = "Filter owners…";
    search.value = prevQuery;
    panel.appendChild(search);

    const list = document.createElement("ul");
    list.className = "cof-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-multiselectable", "true");
    panel.appendChild(list);

    const entries = [...state.owners.entries()].sort((a, b) => {
      if (a[0] === NO_OWNER) return 1;
      if (b[0] === NO_OWNER) return -1;
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    });

    const renderList = () => {
      const q = search.value.trim().toLowerCase();
      list.innerHTML = "";
      for (const [owner, count] of entries) {
        if (q && !ownerLabel(owner).toLowerCase().includes(q)) continue;
        const li = document.createElement("li");
        const checked = state.selected.has(owner);
        li.className = "cof-item" + (checked ? " cof-checked" : "");
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(checked));
        li.tabIndex = 0;
        li.innerHTML =
          '<svg class="cof-check" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>';
        const name = document.createElement("span");
        name.className = "cof-name" + (owner === NO_OWNER ? " cof-muted" : "");
        name.textContent = ownerLabel(owner);
        name.title = ownerLabel(owner);
        const c = document.createElement("span");
        c.className = "cof-count";
        c.textContent = String(count);
        li.append(name, c);
        const toggle = () => {
          if (state.selected.has(owner)) state.selected.delete(owner);
          else state.selected.add(owner);
          saveSelection(parsePrLocation(), state.selected);
          applyFilter();
          renderPanel();
          document.getElementById(IDS.panel)?.querySelector(".cof-search")?.focus();
        };
        li.addEventListener("click", toggle);
        li.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        });
        list.appendChild(li);
      }
      if (!list.children.length) list.appendChild(message("No matching owners"));
    };
    search.addEventListener("input", renderList);
    renderList();

    const selected = activeSelection();
    if (selected.size) {
      const shown = state.files.filter((f) => isVisible(f, selected)).length;
      const footer = message(`Showing ${shown} of ${state.files.length} files`);
      footer.classList.add("cof-footer");
      panel.appendChild(footer);
    }
  }

  function message(text) {
    const el = document.createElement("div");
    el.className = "cof-message";
    el.textContent = text;
    return el;
  }

  // ---------- lifecycle ----------

  async function refresh() {
    const pr = parsePrLocation();
    if (!pr) {
      if (currentKey) {
        currentKey = null;
        state = null;
        closePanel();
        document.getElementById(IDS.style)?.remove();
      }
      return;
    }

    ensureButton();
    if (currentKey === pr.key) return;

    currentKey = pr.key;
    document.getElementById(IDS.style)?.remove();
    const myState = { key: pr.key, loading: true, selected: loadSelection(pr) };
    state = myState;
    updateButton();
    renderPanel();
    try {
      Object.assign(myState, await buildState(pr));
    } catch (e) {
      myState.error = e?.message || String(e);
    }
    myState.loading = false;
    if (state !== myState) return; // navigated away meanwhile
    applyFilter();
    renderPanel();
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      refresh();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("click", closePanel);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
  });
  window.addEventListener("resize", () => {
    const panel = document.getElementById(IDS.panel);
    if (panel) positionPanel(panel);
  });
  window.addEventListener("scroll", () => {
    const panel = document.getElementById(IDS.panel);
    if (panel) positionPanel(panel);
  }, true);

  refresh();
})();
