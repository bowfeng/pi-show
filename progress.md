# Progress

## Status
In Progress — UX & Display Quality review completed (angle 2)

## Tasks
- [x] Review wrapPlain edge cases (long words, formatting)
- [x] Review overview display hierarchy (headings, counts, format consistency)
- [x] Review Not Found display (bullets, messages, redundancy)
- [x] Review README quality (partial vs exact match, colors section)

## Files Changed
- `/Users/ellie/workspace/pi-show/index.ts` (reviewed)
- `/Users/ellie/workspace/pi-show/README.md` (reviewed)
- `/Users/ellie/workspace/pi-show/progress.md` (this file)

## Notes
Review complete. 7 findings: 2 major, 1 polish, 4 nits. No file edits applied. Full findings in review below.

---

## Review: UX & Display Quality

### Finding 1 — Overlapping heading levels in showOverview (Major)
**Location:** `index.ts` lines 127–167
**Issue:** `showOverview` uses `##` for the top-level title AND for every sub-section (Commands, Skills, Prompt Templates, Tools, Themes). In markdown, this flattens the heading hierarchy — all sections appear as peer headings at the same level. The rendered output has no visual distinction between the title and its sub-sections.
**Evidence:**
```typescript
// line 127 — title
"## **pi-coding-agent Information**",
// lines 138, 153, 163 — sub-sections
"## **${sectionName}**",
"## **Tools**",
"## **Themes**",
```
**Suggested fix:** Demote sub-sections to `###` or `####` to establish clear parent-child relationship:
```
## **pi-coding-agent Information**
### **Commands**
### **Skills**
...
```

### Finding 2 — Inconsistent count display in showOverview (Major)
**Location:** `index.ts` lines 138–151
**Issue:** `sectionLines("Commands", grouped.builtin)` passes no count, while Skills and Prompt Templates pass `grouped.skills.length` and `grouped.prompts.length`. Commands section shows **no count** while other sections do.
**Evidence:**
```typescript
lines.push(...sectionLines("Commands", grouped.builtin));             // no count → "Commands"
lines.push(...sectionLines("Skills", grouped.skills, grouped.skills.length));   // → "Skills (5)"
lines.push(...sectionLines("Prompt Templates", grouped.prompts, grouped.prompts.length)); // → "Prompt Templates (3)"
```
**Suggested fix:** Add count to the Commands call: `sectionLines("Commands", grouped.builtin, grouped.builtin.length)`.

### Finding 3 — Inconsistent theme name formatting (Polish)
**Location:** `index.ts` lines 165–167 vs line 218
**Issue:** In `showOverview` (line 165), theme names are rendered without code backticks: ``- ${theme.name} — ${theme.path}`` while Commands, Skills, Tools, and Details all use backticks around names (e.g., ``- \`read\` — ...``). In `showThemeCandidates` (line 218), theme names **do** use backticks. The Not Found view (line 327) also lacks backticks for themes.
**Evidence:**
```typescript
// showOverview line 165 — NO backticks
lines.push(`- ${pathPart}`);
// showThemeCandidates line 218 — HAS backticks
lines.push(`- \`${theme.name}\`${SEPARATOR}${pathPart}`);
```
**Suggested fix:** Consistently use backticks for theme names in all three locations (showOverview, showNotFound, showThemeCandidates).

### Finding 4 — Inconsistent bullet usage in showNotFound (Nit)
**Location:** `index.ts` lines 299–332
**Issue:** In `showNotFound`, the Commands/Skills/Prompt Templates sections use `- ` bullets (lines 292-294 via `sectionLines`), Tools also uses `- ` (line 323), but this is actually **consistent** — all sections have bullets. No issue found here. The bullets are consistent.
**Correction:** After full review, the bullets are consistent across all sections in `showNotFound`. The initial assumption of inconsistency was incorrect.

### Finding 5 — wrapPlain double-indent on long single words (Nit)
**Location:** `index.ts` lines 70–88
**Issue:** When a single word exceeds the width limit, the function pushes it with the indent prefix (`line = indent + word`), then in the output loop it prefixes the indent again for all non-first lines. This is correct behavior for multi-line wrapping, but the `&& line` guard on line 78 prevents the initial split. However, if `candidate.length > width` is true when `line` is empty (first word too long), the condition short-circuits and the word goes into `line` unindented. The word is only indented on the **next** overflow. This means the first line of a multi-word wrap where the first word is very long gets no indent — which is actually the intended behavior. **Edge case:** If the very first word exceeds `width`, it goes into `lines[0]` unindented, but if it overflows again, `line = indent + word` creates a double-indented first wrapped segment. This is minor and only matters with very long words or extremely narrow widths.
**Verdict:** Acceptable behavior for a text-wrapping utility. Not a blocker. The function works correctly for typical description lengths.

### Finding 6 — README colors section is misleading (Polish)
**Location:** `README.md` lines ~28–34
**Issue:** The README documents a "Colors" section claiming the extension uses `accent`, `mdCode`, `muted`, `success`, and `error` theme colors. However, the code output is **pure plain markdown** with no color/formatting applied via any theme tokens. The code outputs backtick-wrapped names, bold labels, and plain text — no theme-based coloring. The README section is entirely fabricated/unused code documentation.
**Suggested fix:** Remove the Colors section from README.md entirely, or update it to accurately describe the actual formatting (backticks for names, bold for labels, plain text for descriptions).

### Finding 7 — README lacks partial vs. exact match documentation (Nit)
**Location:** `README.md` Usage examples
**Issue:** The README shows `/show git` as an example but doesn't clarify this is a **partial match** (finds anything containing "git"). Users may not realize that:
- `/show read` matches exactly (but also works as partial match)
- Partial matches show a "Multiple matches found" list when >1 match exists
- Themes are matched separately from commands/tools
- The `/show read` example says "read tool" in the comment but `read` is ambiguous (could be a command or a tool)
**Suggested fix:** Add a note clarifying:
- Exact match takes priority
- Partial match is fallback behavior
- Use `/show <exact_name>` hint is mentioned in candidate views but not in the README
- Code review completed: correctness, type safety, runtime crash risks
- Found 1 blocker, 3 medium, 2 minor issues (see review)
