/**
 * ShellForgeGuard - recognises shell commands that merge or close a pull request
 * (merge request on GitLab) so a teammate's shell cannot run them.
 *
 * Merging belongs to the Pivot, which sees every open PR and so the order they should land in;
 * a teammate stops at the open PR. The Pivot's shell is not guarded: its approval, green-check
 * and pinned-head rules are its contract and merge_teammate's checks. The check reads one command line
 * statically. It catches the forge CLIs and the forge's merge and close endpoints however the
 * command is wrapped (env, sudo, `bash -c`, `$(...)`); it cannot see inside a script file or a
 * variable, so it is a guard against an agent reaching for the obvious command, not a sandbox.
 *
 * @module ShellForgeGuard
 */

const SEPARATORS = new Set([";", "&", "|", "\n", "(", ")", "`"]);

// Programs that can send a request to a forge or run code that does.
const REQUEST_PROGRAMS = new Set([
  "curl",
  "wget",
  "http",
  "https",
  "xh",
  "hub",
  "python",
  "python3",
  "node",
  "deno",
  "bun",
  "ruby",
  "perl",
  "php",
]);
const SHELL_PROGRAMS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
// Programs that run the rest of their arguments as a command.
const WRAPPER_PROGRAMS = new Set([
  "env",
  "sudo",
  "doas",
  "command",
  "exec",
  "time",
  "nohup",
  "nice",
  "stdbuf",
  "timeout",
  "xargs",
  "builtin",
]);

// Shell words that start a compound command or negate one; the command follows them.
const LEADING_KEYWORDS = new Set(["if", "then", "else", "elif", "while", "until", "do", "{", "!"]);

interface Segment {
  readonly words: ReadonlyArray<string>;
  // Command substitutions found inside double quotes, which the shell still runs.
  readonly nested: ReadonlyArray<string>;
}

// Splits a command line into simple commands and their words, honouring quotes. Single-quoted
// text is inert; double-quoted text only matters for `$(...)` and backticks it embeds.
function segments(command: string): ReadonlyArray<Segment> {
  const result: Array<Segment> = [];
  let words: Array<string> = [];
  let nested: Array<string> = [];
  let word = "";
  let inWord = false;

  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endSegment = () => {
    endWord();
    if (words.length > 0 || nested.length > 0) result.push({ words, nested });
    words = [];
    nested = [];
  };

  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;
    if (char === "\\" && i + 1 < command.length) {
      word += command[++i]!;
      inWord = true;
    } else if (char === "'") {
      const end = command.indexOf("'", i + 1);
      const stop = end === -1 ? command.length : end;
      word += command.slice(i + 1, stop);
      inWord = true;
      i = stop;
    } else if (char === '"') {
      let j = i + 1;
      let text = "";
      while (j < command.length && command[j] !== '"') {
        if (command[j] === "\\" && j + 1 < command.length) j++;
        text += command[j]!;
        j++;
      }
      word += text;
      inWord = true;
      for (const match of text.matchAll(/\$\(([^)]*)\)|`([^`]*)`/g)) {
        nested.push(match[1] ?? match[2] ?? "");
      }
      i = j;
    } else if (char === " " || char === "\t") {
      endWord();
    } else if (SEPARATORS.has(char)) {
      endSegment();
    } else {
      word += char;
      inWord = true;
    }
  }
  endSegment();
  return result;
}

const isKnownProgram = (program: string) =>
  program === "gh" ||
  program === "glab" ||
  program === "git" ||
  program === "eval" ||
  REQUEST_PROGRAMS.has(program) ||
  SHELL_PROGRAMS.has(program) ||
  WRAPPER_PROGRAMS.has(program);

const basename = (word: string) => word.slice(word.lastIndexOf("/") + 1);

// The first two words of `gh pr merge` / `glab mr close`, skipping flags and the value of -R.
// The noun must be the command's first word, so `gh issue create --title pr` is not a PR call.
function subcommandAfter(words: ReadonlyArray<string>, noun: string): string | undefined {
  const positional: Array<string> = [];
  for (let i = 0; i < words.length && positional.length < 2; i++) {
    const word = words[i]!;
    if (word === "-R" || word === "--repo" || word === "-r") i++;
    else if (!word.startsWith("-")) positional.push(word);
  }
  return positional[0] === noun ? positional[1] : undefined;
}

// `-c`, or a cluster that includes it such as `-lc` or `-ec`, runs the next word as a script.
const isScriptFlag = (word: string) => /^-[A-Za-z]*c[A-Za-z]*$/.test(word);

// A request that merges or closes a PR, found in the command's own text: the REST merge
// endpoints, the GraphQL mutations and GitLab's push options.
const MERGE_PATTERNS: ReadonlyArray<RegExp> = [
  /\/pulls\/\d+\/merge\b/,
  /\/merge_requests\/\d+\/(?:merge|cancel_merge_when_pipeline_succeeds)\b/,
  /\/repos\/[^/\s]+\/[^/\s]+\/merges\b/,
  /\b(?:mergePullRequest|enablePullRequestAutoMerge|mergeBranch)\b/,
];
const GITLAB_PUSH_MERGE = /\bmerge_request\.(?:merge_when_pipeline_succeeds|auto_merge)\b/;
// Closing is a state change on the PR itself, in either order of URL and body. A
// `?state=closed` list filter is not one.
const PR_RESOURCE = /\/(?:pulls|issues|merge_requests)\/\d+(?!\/\S)/;
const STATE_CLOSED = /(?<![?&])\bstate(?:_event)?["']?\s*[=:]\s*["']?(?:closed|close)\b/i;
const CLOSE_MUTATION =
  /\bclosePullRequest\b|\bupdatePullRequest\b[\s\S]*\bstate\s*:\s*["']?CLOSED\b/;

type Violation = "merge" | "close";

function violationInSegment(segment: Segment, depth: number): Violation | null {
  for (const inner of segment.nested) {
    const found = violationIn(inner, depth + 1);
    if (found !== null) return found;
  }

  let words = [...segment.words];
  // Skip VAR=value prefixes and wrappers to reach the program that actually runs.
  for (;;) {
    while (
      words.length > 0 &&
      (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]!) || LEADING_KEYWORDS.has(words[0]!))
    ) {
      words.shift();
    }
    const head = words[0] === undefined ? undefined : basename(words[0]);
    if (head === undefined || !WRAPPER_PROGRAMS.has(head)) break;
    // A wrapper's own flags may take values (`sudo -u me`), so skip to the program it runs.
    const next = words.findIndex((word, i) => i > 0 && isKnownProgram(basename(word)));
    words = next === -1 ? [] : words.slice(next);
  }
  const program = words[0] === undefined ? undefined : basename(words[0]);
  if (program === undefined) return null;
  const rest = words.slice(1);

  if (SHELL_PROGRAMS.has(program) || program === "eval") {
    const flag = rest.findIndex(isScriptFlag);
    const script = program === "eval" ? rest.join(" ") : flag === -1 ? undefined : rest[flag + 1];
    return script === undefined ? null : violationIn(script, depth + 1);
  }
  if (program === "gh" || program === "glab") {
    const sub = subcommandAfter(rest, program === "gh" ? "pr" : "mr");
    if (sub === "merge" || sub === "close") return sub;
  }
  // git reaches the forge only through a GitLab push option; its other arguments are commit
  // messages, paths and search terms, which may well name a merge mutation.
  if (program === "git") {
    return GITLAB_PUSH_MERGE.test(rest.join(" ")) ? "merge" : null;
  }
  if (program === "gh" || program === "glab" || REQUEST_PROGRAMS.has(program)) {
    const text = rest.join(" ");
    if (MERGE_PATTERNS.some((pattern) => pattern.test(text))) return "merge";
    if (CLOSE_MUTATION.test(text) || (PR_RESOURCE.test(text) && STATE_CLOSED.test(text))) {
      return "close";
    }
  }
  return null;
}

function violationIn(command: string, depth: number): Violation | null {
  // Bounds recursion through nested `bash -c` and `$(...)`.
  if (depth > 4) return null;
  for (const segment of segments(command)) {
    const found = violationInSegment(segment, depth);
    if (found !== null) return found;
  }
  return null;
}

/**
 * The refusal to show a teammate when `command` merges or closes a PR, or null when the command
 * is fine.
 */
export function forgeMergeRefusal(command: string): string | null {
  const violation = violationIn(command, 0);
  if (violation === null) return null;
  return violation === "merge"
    ? "Refused: teammates never merge PRs. Stop at the open PR and report `done` with its URL through report_status. The Pivot reviews every PR and merges them in order."
    : "Refused: teammates never close PRs. If this PR should not land, say so in report_status (needs-decision) and the Pivot decides.";
}
