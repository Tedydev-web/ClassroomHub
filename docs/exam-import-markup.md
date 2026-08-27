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

### Where the answer key may live

Any one of these states the key. All are read the same way and produce the same draft:

- the correct option highlighted, bold, or underlined in the paper itself;
- a table at the end of the paper, laid out either as `Câu | Đáp án` rows or as a grid of
  question numbers over their answers;
- one line listing every answer — `1B 2C 3A 4D`, `ĐÁP ÁN: 1B 2C 3A 4D`, or `1 - B 2 - C`;
- one answer per line — `1. B` or `Đáp án 1: B`;
- a separate file holding only the key, or a second copy of the paper with the answers
  marked. Upload it on the review screen; DOCX and text-based PDF are both accepted.

A key that numbers its answers may cover only some questions. The answers it does give are
kept, and publishing stays blocked until every remaining question has one. A key written as
one answer per line with no question numbers must cover every missing answer, because
without numbers a short list would shift every answer after the gap onto the wrong question.

The importer preserves bold, italic, underline, lists, tables, Office Math, and embedded raster
images when the source contains those structures. It flags ambiguous grouping, incomplete option
sets, conflicting keys, and missing keys for review. Each finding says who has to act on it:
something the document does not contain and the teacher must supply, something the document
states wrongly and the teacher must edit, or something the importer could not read and the
teacher should check.

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
