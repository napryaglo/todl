import * as monaco from "monaco-editor";

// Pure Monarch grammar data for the 'todl' language (ported from Plexus). Two
// scopes earn keyword-blue: the fixed keyword set, and any operator GLYPH (a run
// of 2+ edge chars — `->`, `==>`, `~>`, …), which is author-defined per
// meta-model but always lexically a run of those characters. Concept names are
// meta-model-derived and arrive via LSP semantic tokens, not here.

const TODL_KEYWORDS = [
  "namespace", "import", "package", "primitive", "concept", "taxonomy", "viewpoint",
  "annotation", "annotate", "model", "operator", "relationship", "invariant", "term",
  "class", "internal", "sealed", "extends", "represents", "frames", "uses", "conforms",
  "instanceof", "authoring", "true", "false",
];

const TODL_IDENTIFIER_PATTERN = /[A-Za-z_]\w*/;
const TODL_OPERATOR_PATTERN = /[-~=<>!]{2,}/;

const todlMonarchLanguage: monaco.languages.IMonarchLanguage = {
  keywords: TODL_KEYWORDS,
  tokenizer: {
    root: [
      [/\/\/.*$/, "comment"],
      [/\/\*/, "comment", "@comment"],
      [/"""/, "string", "@rawstring"],
      [/"/, "string", "@string"],
      [TODL_IDENTIFIER_PATTERN, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
      [/\d+/, "number"],
      [TODL_OPERATOR_PATTERN, "keyword"],
      [/[{}()[\]]/, "@brackets"],
      [/[:;,.=|?*+&]/, "delimiter"],
    ],
    comment: [
      [/[^/*]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[/*]/, "comment"],
    ],
    string: [
      [/[^"]+/, "string"],
      [/"/, "string", "@pop"],
    ],
    rawstring: [
      [/"""/, "string", "@pop"],
      [/[^"]+/, "string"],
      [/"/, "string"],
    ],
  },
};

const todlLanguageConfiguration: monaco.languages.LanguageConfiguration = {
  comments: { lineComment: "//", blockComment: ["/*", "*/"] },
  brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
  autoClosingPairs: [
    { open: "{", close: "}" }, { open: "[", close: "]" },
    { open: "(", close: ")" }, { open: "\"", close: "\"" },
  ],
};

let registered = false;
/** Register the 'todl' language + Monarch grammar + config. Idempotent. */
export function registerTodlLanguage(): void {
  if (registered) return;
  registered = true;
  monaco.languages.register({ id: "todl" });
  monaco.languages.setMonarchTokensProvider("todl", todlMonarchLanguage);
  monaco.languages.setLanguageConfiguration("todl", todlLanguageConfiguration);
}
