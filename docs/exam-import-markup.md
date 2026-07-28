# ClassroomHub exam import conventions

ClassroomHub accepts DOCX, text-based PDF, Aiken, and GIFT sources. Import always creates a review
draft. It never publishes directly.

## DOCX and PDF

Use one question number per question and keep each option visibly labelled.

```text
Question 1. Which value is prime?
A. 4
B. 7
C. 8
D. 9

Answer: B
```

Supported answer-key labels include `Answer`, `ANSWER`, and `Đáp án`. Multiple-choice keys may list
more than one option. Shared passages should appear before the questions that depend on them.
Headings and page breaks may separate sections.

The importer preserves bold, italic, underline, lists, tables, Office Math, and embedded raster
images when the source contains those structures. It flags ambiguous grouping, incomplete option
sets, conflicting keys, and missing keys for review.

Text-based PDFs are supported. Scanned PDFs without a usable text layer are rejected until the
organization's AI image-import capability is available. Converting a damaged scan to DOCX does not
restore missing text; use a clean source document where possible.

## Aiken

Aiken supports one correct option and exactly four labelled options:

```text
Which value is prime?
A. 4
B. 7
C. 8
D. 9
ANSWER: B
```

Separate questions with a blank line. Use UTF-8 text. ClassroomHub reports unsupported labels,
multiple answers, continuations, and metadata with a source line instead of dropping them.

## GIFT

ClassroomHub supports titled multiple-choice questions, escaping, weighted answers, option
feedback, and general feedback:

```text
::Prime number::Which value is prime? {
  ~%-50%4#Four is composite.
  =%100%7#Seven is prime.
  ~%-50%8
  ~%-50%9
  ####A prime has exactly two positive divisors.
}
```

Escape literal `\`, `~`, `=`, `#`, `{`, `}`, and `:` characters with a backslash. Unsupported GIFT
constructs become explicit findings. They are not silently discarded.

## Review before publish

Resolve every blocking finding, confirm AI-derived fields, and check:

- question boundaries and shared passages;
- question type and option order;
- answer keys and partial-credit weights;
- points and section totals;
- equations, tables, and images;
- feedback visibility.

Publishing uses the normal exercise authoring path and creates immutable assessment revisions. The
source file and import draft do not become part of learner delivery.
