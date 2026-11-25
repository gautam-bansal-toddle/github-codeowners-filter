// CODEOWNERS parsing and matching (gitignore-style patterns, last match wins).
// Exposed as globalThis.CodeOwners so it can be shared by content.js and tests.
(function (root) {
  function escapeRegex(ch) {
    return /[.+^${}()|[\]\\]/.test(ch) ? "\\" + ch : ch;
  }

  function patternToRegex(rawPattern) {
    let pattern = rawPattern;
    const dirOnly = pattern.endsWith("/");
    if (dirOnly) pattern = pattern.replace(/\/+$/, "");

    let anchored = false;
    if (pattern.startsWith("/")) {
      anchored = true;
      pattern = pattern.replace(/^\/+/, "");
    }
    // A slash anywhere but the end anchors the pattern to the repo root (gitignore rule).
    if (pattern.includes("/")) anchored = true;

    // GitHub: "docs/*" matches docs/a.md but not docs/sub/b.md.
    const singleLevelStar = /(^|\/)\*$/.test(pattern) && !pattern.endsWith("**");

    let body = "";
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i];
      if (ch === "\\" && i + 1 < pattern.length) {
        body += escapeRegex(pattern[++i]);
      } else if (ch === "*") {
        if (pattern[i + 1] === "*") {
          const atSegStart = i === 0 || pattern[i - 1] === "/";
          const nextCh = pattern[i + 2];
          if (atSegStart && nextCh === "/") {
            body += "(?:.*/)?"; // "**/" → zero or more directories
            i += 2;
          } else if (atSegStart && nextCh === undefined) {
            body += ".*"; // trailing "/**"
            i += 1;
          } else {
            body += ".*";
            i += 1;
          }
        } else {
          body += "[^/]*";
        }
      } else if (ch === "?") {
        body += "[^/]";
      } else {
        body += escapeRegex(ch);
      }
    }

    const prefix = anchored ? "^" : "^(?:.*/)?";
    let suffix;
    if (dirOnly) suffix = "/.*$";
    else if (singleLevelStar) suffix = "$";
    else suffix = "(?:/.*)?$";
    return new RegExp(prefix + body + suffix);
  }

  function parse(text) {
    const rules = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/(^|\s)#.*$/, "").trim();
      if (!line) continue;
      // Split on unescaped whitespace.
      const parts = line.match(/(?:\\.|[^\s\\])+/g) || [];
      const [pattern, ...owners] = parts;
      if (!pattern) continue;
      try {
        rules.push({
          pattern,
          regex: patternToRegex(pattern),
          owners: owners.filter((o) => o.startsWith("@") || o.includes("@")),
        });
      } catch (e) {
        // Skip patterns we can't compile.
      }
    }
    return rules;
  }

  function ownersFor(rules, path) {
    for (let i = rules.length - 1; i >= 0; i--) {
      if (rules[i].regex.test(path)) return rules[i].owners;
    }
    return [];
  }

  root.CodeOwners = { parse, ownersFor, patternToRegex };
})(typeof globalThis !== "undefined" ? globalThis : this);
