<script lang="ts">
  import { t } from '$lib/utils/functions/translations';

  /**
   * One answer sheet per candidate, on A4, in the shape the Ministry's answer sheet reads in.
   *
   * What is borrowed is the structure a Vietnamese teacher and their class already know how
   * to read: a centred title, the candidate's details in one bordered block, and the answers
   * in a single framed region split into short numbered columns. What is not borrowed is the
   * bubbles and the black registration squares — those exist so a scanner can find the page,
   * and this page is never scanned. In their place the sheet says the thing the Ministry's
   * blank form cannot: which letter was chosen, which one was right, and whether they match.
   *
   * There is no PDF here on purpose. The print dialog writes one, with correct diacritics and
   * a preview the teacher can check before spending paper.
   */
  let { data } = $props();

  /**
   * The sheet's wording, from the server, in the language the export was asked for.
   *
   * Deliberately not this app's translations. Everything inside the sheet is the file's
   * language; the toolbar above it, the tab's title and the error pages are interface and
   * stay in the reader's own — the line runs through the page, not through the file.
   */
  const labels = $derived(data.labels);

  /**
   * How the sheet meets the page it prints on.
   *
   * The layout below is settled in millimetres against a printed A4 Ministry form, so A5 is
   * not a reflow but the same sheet zoomed down whole: Chromium's `zoom` scales the layout,
   * not only the paint, so one candidate stays one page. The zoom is the ratio of the two
   * printable widths (A5 148mm − 14mm margins = 134mm; A4 190mm), which keeps the sheet
   * inside A5's printable box rather than overflowing it by the paper ratio's few millimetres.
   */
  const PAPER_GEOMETRY = {
    a4: { size: 'A4 portrait', margin: '12mm 10mm', zoom: 1 },
    a5: { size: 'A5 portrait', margin: '8mm 7mm', zoom: 0.705 }
  } as const;

  const geometry = $derived(PAPER_GEOMETRY[data.paper] ?? PAPER_GEOMETRY.a5);

  // The tag name is assembled rather than written verbatim, so the Svelte compiler does not
  // mistake this string for a second component style element and try to parse it as CSS.
  const styleTag = 'style';

  const paperHeadTag = $derived(
    `<${styleTag}>@page { size: ${geometry.size}; margin: ${geometry.margin}; } .sheet { zoom: ${geometry.zoom}; }</${styleTag}>`
  );

  /** Set when the tenant's uploaded logo will not load, so the name takes its place. */
  let logoBroken = $state(false);

  type Question = { position: number; key: string; letters: string[] };

  /**
   * The letters a question prints.
   *
   * The paper's own options where the frozen paper still has them; otherwise reconstructed
   * from the key and from what candidates actually chose, so a sheet is never blank merely
   * because the question could not be found.
   */
  function lettersOf(question: Question): string[] {
    if (question.letters.length > 0) return question.letters;

    const seen: string[] = [];

    for (const letter of question.key.split('')) if (letter && !seen.includes(letter)) seen.push(letter);

    for (const row of data.rows) {
      const chosen = row.chosen[question.position - 1];

      if (!chosen) continue;

      for (const letter of chosen.split('')) if (!seen.includes(letter)) seen.push(letter);
    }

    return seen.sort();
  }

  /**
   * The answer region, split into columns short enough to read down.
   *
   * Ten to a column is what the Ministry's sheet uses and what a page of A4 holds beside
   * three more of them. Past forty questions the columns lengthen rather than multiply — a
   * fifth column would be narrower than the letters it has to hold.
   */
  function columnsOf(questions: Question[]): Question[][] {
    if (questions.length === 0) return [];

    const columns = Math.min(4, Math.ceil(questions.length / 10));
    const perColumn = Math.ceil(questions.length / columns);

    return Array.from({ length: columns }, (_, index) => questions.slice(index * perColumn, (index + 1) * perColumn));
  }

  const columns = $derived(columnsOf(data.questions));

  /**
   * The letters every column is ruled for.
   *
   * The Ministry's sheet heads each block with A B C D once and lines the bubbles up under
   * them; that alignment is what lets an eye run down a column instead of reading every
   * letter. Doing the same means one set of columns for the whole paper rather than a set
   * per question — a question that offers fewer simply leaves its cells empty, which is also
   * the honest thing to show.
   */
  const alphabet = $derived(
    data.questions
      .flatMap((question) => lettersOf(question))
      .filter((letter, index, all) => all.indexOf(letter) === index)
      .sort()
  );

  /** `dd/MM HH:mm` in the room's own time, which is the only clock anybody there reads by. */
  function clockOf(value: string | null): string {
    if (!value) return '—';

    const moment = new Date(value);

    if (Number.isNaN(moment.getTime())) return '—';

    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(moment);

    const at = (type: string) => parts.find((part) => part.type === type)?.value ?? '';

    // ISO 8601 order, year included: a sheet read next term must not have to work out which
    // September "03/09" was, and the date and the time are separated rather than run together.
    return `${at('year')}-${at('month')}-${at('day')} ${at('hour')}:${at('minute')}`;
  }

  function minutesTaken(startedAt: string | null, submittedAt: string | null): string {
    if (!startedAt || !submittedAt) return '—';

    const from = new Date(startedAt).getTime();
    const to = new Date(submittedAt).getTime();

    if (Number.isNaN(from) || Number.isNaN(to) || to < from) return '—';

    return `${Math.round((to - from) / 60000)} ${labels.minutes}`;
  }
</script>

<svelte:head>
  <title>{$t('exam.print.tab_title')} — {data.examTitle}</title>
  <!--
    The paper geometry, emitted here rather than in the component's static stylesheet, so
    the one @page rule the document carries is the chosen one. The PDF endpoint hands the
    renderer this markup with the component stylesheet stripped to text, so an inline @page
    in that stylesheet would have raced this one; there is now only this.
  -->
  {@html paperHeadTag}
</svelte:head>

<div class="toolbar">
  <a href={`/courses/${data.courseId}`}>{$t('exam.print.back')}</a>
  <button type="button" onclick={() => window.print()}>{$t('exam.print.print')}</button>
  <span>{$t('exam.print.hint')}</span>
</div>

{#each data.rows as row (row.attemptId)}
  <article class="sheet">
    <!--
      The masthead. A sheet read months later in a staff room has to say which school issued
      it and which paper it records without anybody having to remember.
    -->
    <div class="masthead">
      <div class="issuer">
        <!--
          A tenant's mark: its logo where one is uploaded, its name where none is. Only one
          of the two, because printing both says the same thing twice in the same corner.
        -->
        {#if data.issuer.organizationLogo}
          <!--
            An organisation's logo is a URL to a file somebody uploaded, and the file can be
            gone; a broken image icon in the masthead of a printed sheet is worse than no
            logo at all.
          -->
          <img
            src={data.issuer.organizationLogo}
            alt=""
            onerror={(event) => {
              // An uploaded file can be gone, and a broken-image icon in the masthead of a
              // printed sheet is worse than no logo: fall back to the name it stands for.
              (event.currentTarget as HTMLImageElement).hidden = true;
              logoBroken = true;
            }}
          />
        {/if}
        {#if !data.issuer.organizationLogo || logoBroken}
          <span>{data.issuer.organizationName ?? ''}</span>
        {/if}
      </div>
      <p class="paper">
        {#if data.issuer.courseTitle}{data.issuer.courseTitle}{/if}
      </p>
    </div>

    <header class="head">
      <p class="kicker">{labels.title}</p>
      <h1>{data.examTitle}</h1>
    </header>

    <table class="identity">
      <tbody>
        <tr>
          <th>{labels.fullName}</th>
          <td class="wide">{row.displayName ?? labels.unnamed}</td>
          <th>{labels.score}</th>
          <td class="score">{row.score ?? '—'}{row.total ? ` / ${row.total}` : ''}</td>
        </tr>
        <tr>
          <th>{labels.className}</th>
          <td>{row.className ?? '—'}</td>
          <th>{labels.correct}</th>
          <td>{row.correct} / {data.questions.length}</td>
        </tr>
        <tr>
          <th>{labels.candidateNumber}</th>
          <td>{row.candidateNumber ?? '—'}</td>
          <th>{labels.timeTaken}</th>
          <td>{minutesTaken(row.startedAt, row.submittedAt)}</td>
        </tr>
        <tr>
          <th>{labels.startedAt}</th>
          <td>{clockOf(row.startedAt)}</td>
          <th>{labels.submittedAt}</th>
          <td>{clockOf(row.submittedAt)}</td>
        </tr>
        <tr>
          <th>{labels.leaves}</th>
          <td colspan="3">{row.leaves}</td>
        </tr>
      </tbody>
    </table>

    <!--
      The key to the two marks, small and directly above the answers. At the foot it was a
      third block competing with the comment line and the colophon, and it was three
      hundred millimetres from the first mark it explains.
    -->
    <p class="legend">
      <span><span class="option chosen">A</span> {labels.chosen}</span>
      {#if data.showAnswerKey}
        <span><span class="option key">A</span> {labels.key}</span>
      {/if}
    </p>

    <section class="answers">
      <div class="columns">
        {#each columns as column (column[0].position)}
          <table class="column">
            <thead>
              <tr>
                <th class="num">{labels.question}</th>
                {#each alphabet as letter (letter)}
                  <th>{letter}</th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each column as question (question.position)}
                {@const chosen = row.chosen[question.position - 1] ?? null}
                {@const letters = lettersOf(question)}
                <tr>
                  <th class="num">{question.position}</th>
                  {#each alphabet as letter (letter)}
                    <td>
                      {#if letters.includes(letter)}
                        <!--
                          Two independent marks, because a page printed in black and white on
                          a tired laser is not required to keep a fill. The chosen letter is
                          inked; the key is boxed. A letter that is both is a right answer.
                        -->
                        <span
                          class={[
                            'option',
                            chosen?.includes(letter) && 'chosen',
                            data.showAnswerKey && question.key.includes(letter) && 'key',
                            !chosen?.includes(letter) &&
                              !(data.showAnswerKey && question.key.includes(letter)) &&
                              'idle'
                          ]
                            .filter(Boolean)
                            .join(' ')}>{letter}</span
                        >
                      {/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        {/each}
      </div>
    </section>

    <!--
      The foot. Printed per sheet rather than in a page margin because Chrome will not put
      content in one, and because each sheet is exactly one page: the page number counts
      candidates, which is the count a teacher checks a stack against.
    -->
    <!--
      One ruled line at the foot of the answers: a marker writing a word on the sheet before
      handing it back, which is a different act from the comment box the system keeps.
    -->
    <p class="note"><span>{labels.note}</span></p>

    <footer class="colophon">
      <!--
        The system's own mark, on every sheet whoever the tenant is: a page found later in a
        filing cabinet should say which system it came out of.
      -->
      <span class="system"><img src="/logo.svg" alt="" />ClassroomHub</span>
      <span>{labels.generatedAt} {data.issuer.printedAt}</span>
      {#if data.issuer.printedBy}
        <span>{labels.generatedBy} {data.issuer.printedBy}</span>
      {/if}
    </footer>
  </article>
{/each}

<style>
  /*
    The page is the unit here, not the viewport: everything below is sized in millimetres so
    what the print dialog previews is what the sheet measures.
  */
  /*
    The @page rule and the sheet's zoom are emitted from `<svelte:head>` instead, because
    they depend on the chosen paper; see `paperStyle`. Everything below is in millimetres and
    sized for A4, and A5 is that same sheet scaled down whole by the zoom rather than reflowed.
  */

  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    background: #f4f4f5;
    border-bottom: 1px solid #d4d4d8;
    font:
      13px/1.4 system-ui,
      sans-serif;
  }

  .toolbar button,
  .toolbar a {
    padding: 6px 12px;
    border: 1px solid #52525b;
    border-radius: 6px;
    background: #fff;
    color: #18181b;
    text-decoration: none;
    cursor: pointer;
    font: inherit;
  }

  .toolbar span {
    color: #52525b;
  }

  .sheet {
    /* Its own page, every time: one candidate per sheet is the whole point of handing it out. */
    break-after: page;
    box-sizing: border-box;
    /*
      As tall as the printable area, so the colophon sits on the foot of the paper rather
      than under whatever the last block happened to end at. A4 less the page margins.
    */
    min-height: 262mm;
    display: flex;
    flex-direction: column;
    width: 190mm;
    margin: 8mm auto;
    padding: 6mm;
    background: #fff;
    color: #000;
    font:
      12pt/1.45 'Times New Roman',
      Times,
      serif;
  }

  .sheet:last-child {
    break-after: auto;
  }

  .masthead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4mm;
    padding-bottom: 2mm;
    border-bottom: 0.3mm solid #000;
    font-size: 10pt;
  }

  .issuer {
    display: flex;
    align-items: center;
    gap: 2.5mm;
    font-weight: 700;
    text-transform: uppercase;
  }

  .issuer img {
    /* Height-bound, so a wide wordmark and a square badge both sit on the same line. */
    height: 9mm;
    width: auto;
    object-fit: contain;
  }

  .paper {
    margin: 0;
    text-align: right;
    font-style: italic;
  }

  .colophon {
    display: flex;
    flex-wrap: wrap;
    gap: 3mm;
    /*
      Pushed to the foot of the sheet by whatever space is left above it, and carrying no
      rule of its own: the comment line and the legend already put two rules within a few
      millimetres of here, and a third made the whole foot read as one smudged block.
    */
    margin-top: auto;
    padding-top: 2mm;
    font-size: 8.5pt;
    color: #374151;
  }

  .system {
    /* The system on one edge, when and by whom on the other, and the width of the sheet
       between them: two marks balanced rather than three crowded to the left. */
    margin-right: auto;
    display: inline-flex;
    align-items: center;
    gap: 1.5mm;
    font-weight: 700;
    color: #000;
  }

  .system img {
    height: 6.5mm;
    width: auto;
  }

  .head {
    text-align: center;
    margin: 3mm 0 4mm;
  }

  .kicker {
    margin: 0;
    font-size: 16pt;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .head h1 {
    margin: 1mm 0 0;
    font-size: 12.5pt;
    font-weight: 400;
    font-style: italic;
  }

  .identity {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 4mm;
  }

  .identity th,
  .identity td {
    border: 0.4mm solid #000;
    padding: 2mm 2.5mm;
    text-align: left;
    vertical-align: middle;
  }

  .identity th {
    width: 28mm;
    font-weight: 400;
    font-size: 11pt;
  }

  .identity td {
    font-weight: 700;
  }

  .identity .wide {
    font-size: 14pt;
  }

  .identity .score {
    font-size: 15pt;
  }

  .answers {
    /*
      No frame and no heading. Each block of ten is already framed, and a box around the
      four of them plus a band naming what they obviously are was two more rules than the
      page needed — which is what made a sheet of nested boxes out of a sheet of answers.
    */
    padding: 1mm 0;
  }

  .columns {
    display: flex;
    /*
      Four blocks of the same grid, sized so the last one's result column stays inside the
      frame: flex will happily let a table overflow rather than admit it does not fit.
    */
    gap: 3mm;
    align-items: flex-start;
  }

  .column {
    flex: 1 1 0;
    min-width: 0;
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    /*
      The block's frame, and nothing inside it. The Ministry's sheet rules the outside of
      each block of ten and leaves the inside to whitespace; ruling every cell as well is
      what turned four readable blocks into a dense grid.
    */
    border: 0.4mm solid #000;
  }

  .column th,
  .column td {
    border: 0;
    /* Row height is what is left of the page divided by the rows on it: forty questions
       ended a third of the way up an A4 and left the rest white. */
    padding: 3mm 0;
    text-align: center;
    vertical-align: middle;
  }

  .column thead th {
    /* Headed once and lightly: a rule under the row is enough to say these are columns. */
    border-bottom: 0.3mm solid #000;
    padding-bottom: 1.6mm;
    font-weight: 400;
    font-size: 10.5pt;
  }

  .column .num {
    width: 8mm;
    font-weight: 700;
    font-size: 11.5pt;
  }

  .note {
    display: flex;
    align-items: flex-end;
    gap: 2mm;
    margin: 6mm 0 0;
    font-size: 10.5pt;
  }

  .note::after {
    content: '';
    flex: 1;
    border-bottom: 0.2mm solid #000;
  }

  .option {
    display: inline-block;
    width: 6.4mm;
    height: 6.4mm;
    line-height: 6.4mm;
    text-align: center;
    font-size: 11pt;
    border: 0.2mm solid transparent;
    border-radius: 50%;
  }

  /* Boxed, not filled: a border survives every printer, and the key must always be legible. */
  .option.key {
    border: 0.5mm solid #000;
  }

  /*
    The letters nobody marked. Present, because a teacher has to see the question offered
    four options; faint, because they are the only thing on the sheet that carries no news.
  */
  .option.idle {
    color: #9ca3af;
  }

  .option.chosen {
    background: #000;
    color: #fff;
    font-weight: 700;
    /* Browsers drop backgrounds when printing unless asked not to; without this the ink
       that marks the candidate's own answer is the one thing missing from the paper. */
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    /* On the same left edge as everything else on the sheet, and read before the answers
       rather than after them. */
    gap: 4mm;
    margin: 0 0 1.5mm;
    font-size: 8.5pt;
  }

  .legend .option {
    width: 4.4mm;
    height: 4.4mm;
    line-height: 4.4mm;
    margin-right: 0.8mm;
    font-size: 8pt;
    vertical-align: middle;
  }

  @media print {
    .toolbar {
      display: none;
    }

    .sheet {
      width: auto;
      margin: 0;
      padding: 0;
    }
  }
</style>
