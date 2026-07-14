/**
 * expr/expr.mjs — the safe `when`/`until` expression engine (atomic service,
 * ported from the langgraph-config-harness expression canon).
 *
 * A deliberately tiny grammar over `state`:
 *
 *   comparisons      == != < > <= >=
 *   boolean ops      && || !
 *   membership       <x> in <y>
 *   member access    state.foo, state.repo_queue.length
 *   literals         numbers, "strings", true/false/null
 *
 * The safety property rests on the AST being a CLOSED, whitelisted set of node
 * kinds. There are no call, index, assignment, or arbitrary-identifier nodes —
 * so `require(...)`, `process.env`, `a[b]=c` are UNREPRESENTABLE, not merely
 * unevaluated. The only root identifier permitted is `state`.
 *
 * The `condition.*` atoms are thin wrappers over this engine; nothing else in
 * the SDK evaluates config-authored expressions.
 */

import { ExprError } from "../errors.mjs";

const ROOT_ALLOWLIST = new Set(["state"]);
const OPS = ["==", "!=", "<=", ">=", "&&", "||", "<", ">", "!"];

// ── tokenizer ────────────────────────────────────────────────────────────────

function tokenize(src) {
  const toks = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "(" || c === ")" || c === ".") {
      toks.push({ t: "punc", v: c });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let s = "";
      while (j < n && src[j] !== quote) {
        if (src[j] === "\\" && j + 1 < n) {
          s += src[j + 1];
          j += 2;
        } else {
          s += src[j++];
        }
      }
      if (j >= n) throw new ExprError("unterminated string literal", src);
      toks.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i;
      while (j < n && /[0-9.]/.test(src[j])) j++;
      toks.push({ t: "num", v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    const matchedTwo = OPS.find((o) => o.length === 2 && o === two);
    if (matchedTwo) {
      toks.push({ t: "op", v: matchedTwo });
      i += 2;
      continue;
    }
    const one = OPS.find((o) => o.length === 1 && o === c);
    if (one) {
      toks.push({ t: "op", v: one });
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      if (word === "true") toks.push({ t: "bool", v: true });
      else if (word === "false") toks.push({ t: "bool", v: false });
      else if (word === "null") toks.push({ t: "null" });
      else if (word === "in") toks.push({ t: "op", v: "in" });
      else toks.push({ t: "ident", v: word });
      i = j;
      continue;
    }
    throw new ExprError(`unexpected character '${c}'`, src);
  }
  toks.push({ t: "eof" });
  return toks;
}

// ── recursive-descent parser ─────────────────────────────────────────────────
// or  →  and ( '||' and )*
// and →  cmp ( '&&' cmp )*
// cmp →  unary ( (== != < > <= >= in) unary )?
// unary → '!' unary | postfix
// postfix → primary ( '.' ident )*
// primary → num | str | bool | null | ident | '(' or ')'

class Parser {
  constructor(toks, src) {
    this.toks = toks;
    this.src = src;
    this.pos = 0;
  }
  peek() {
    return this.toks[this.pos];
  }
  next() {
    return this.toks[this.pos++];
  }
  expectPunc(v) {
    const tk = this.next();
    if (tk.t !== "punc" || tk.v !== v) throw new ExprError(`expected '${v}'`, this.src);
  }
  parse() {
    const node = this.parseOr();
    if (this.peek().t !== "eof") throw new ExprError("trailing tokens after expression", this.src);
    return node;
  }
  parseOr() {
    let left = this.parseAnd();
    while (this.peek().t === "op" && this.peek().v === "||") {
      this.next();
      left = { kind: "binary", op: "||", left, right: this.parseAnd() };
    }
    return left;
  }
  parseAnd() {
    let left = this.parseCmp();
    while (this.peek().t === "op" && this.peek().v === "&&") {
      this.next();
      left = { kind: "binary", op: "&&", left, right: this.parseCmp() };
    }
    return left;
  }
  parseCmp() {
    const left = this.parseUnary();
    const tk = this.peek();
    if (tk.t === "op" && ["==", "!=", "<", ">", "<=", ">=", "in"].includes(tk.v)) {
      this.next();
      return { kind: "binary", op: tk.v, left, right: this.parseUnary() };
    }
    return left;
  }
  parseUnary() {
    const tk = this.peek();
    if (tk.t === "op" && tk.v === "!") {
      this.next();
      return { kind: "unary", op: "!", operand: this.parseUnary() };
    }
    return this.parsePostfix();
  }
  parsePostfix() {
    let node = this.parsePrimary();
    while (this.peek().t === "punc" && this.peek().v === ".") {
      this.next();
      const prop = this.next();
      if (prop.t !== "ident") throw new ExprError("expected property name after '.'", this.src);
      node = { kind: "member", object: node, property: prop.v };
    }
    return node;
  }
  parsePrimary() {
    const tk = this.next();
    switch (tk.t) {
      case "num":
      case "str":
      case "bool":
        return { kind: "lit", value: tk.v };
      case "null":
        return { kind: "lit", value: null };
      case "ident":
        if (!ROOT_ALLOWLIST.has(tk.v))
          throw new ExprError(`identifier '${tk.v}' is not allowed (only 'state' may root an expression)`, this.src);
        return { kind: "ident", name: tk.v };
      case "punc":
        if (tk.v === "(") {
          const inner = this.parseOr();
          this.expectPunc(")");
          return inner;
        }
        break;
    }
    throw new ExprError("unexpected token in expression", this.src);
  }
}

/** Parse an expression string into a validated AST. Throws ExprError. */
export function parseExpr(src) {
  return new Parser(tokenize(src), src).parse();
}

// ── evaluator ────────────────────────────────────────────────────────────────

function truthy(v) {
  return !!v;
}

export function evalExpr(node, state) {
  switch (node.kind) {
    case "lit":
      return node.value;
    case "ident":
      return state; // only root ident is `state` (enforced at parse time)
    case "member": {
      const obj = evalExpr(node.object, state);
      if (obj == null) return undefined;
      return obj[node.property];
    }
    case "unary":
      return !truthy(evalExpr(node.operand, state));
    case "binary": {
      if (node.op === "&&") return truthy(evalExpr(node.left, state)) && truthy(evalExpr(node.right, state));
      if (node.op === "||") return truthy(evalExpr(node.left, state)) || truthy(evalExpr(node.right, state));
      const l = evalExpr(node.left, state);
      const r = evalExpr(node.right, state);
      switch (node.op) {
        case "==":
          return l === r;
        case "!=":
          return l !== r;
        case "<":
          return l < r;
        case ">":
          return l > r;
        case "<=":
          return l <= r;
        case ">=":
          return l >= r;
        case "in":
          if (Array.isArray(r)) return r.includes(l);
          if (r && typeof r === "object") return String(l) in r;
          if (typeof r === "string") return r.includes(String(l));
          return false;
      }
    }
  }
  return undefined;
}

/** Compile a `when`/`until` string into a boolean predicate over state. */
export function compilePredicate(src) {
  const ast = parseExpr(src);
  return (state) => truthy(evalExpr(ast, state));
}

/**
 * The first-level channel names an expression reads — the `X` in `state.X` /
 * `state.X.length`. Used by the validator's channel-existence invariant.
 */
export function extractChannels(src) {
  let ast;
  try {
    ast = parseExpr(src);
  } catch {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(src.trim()) ? [src.trim()] : [];
  }
  const out = new Set();
  walkChannels(ast, out);
  return [...out];
}

function walkChannels(node, out) {
  if (node.kind === "member") {
    if (node.object.kind === "ident" && node.object.name === "state") out.add(node.property);
    else walkChannels(node.object, out);
  } else if (node.kind === "unary") {
    walkChannels(node.operand, out);
  } else if (node.kind === "binary") {
    walkChannels(node.left, out);
    walkChannels(node.right, out);
  }
}
