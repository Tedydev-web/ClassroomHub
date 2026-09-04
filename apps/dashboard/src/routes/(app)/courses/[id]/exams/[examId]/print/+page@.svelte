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

  /** `dd/MM HH:mm` in the room's own time, which is the only clock anybody there reads by. */
  function clockOf(value: string | null): string {
    if (!value) return '—';

    const moment = new Date(value);

    if (Number.isNaN(moment.getTime())) return '—';

    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
      .format(moment)
      .replace(',', '');
  }

  function minutesTaken(startedAt: string | null, submittedAt: string | null): string {
    if (!startedAt || !submittedAt) return '—';

    const from = new Date(startedAt).getTime();
    const to = new Date(submittedAt).getTime();

    if (Number.isNaN(from) || Number.isNaN(to) || to < from) return '—';

    return $t('exam.results.minutes_taken', { minutes: String(Math.round((to - from) / 60000)) });
  }

  /** Right, wrong, or never answered — the three states a marked question can be in. */
  function outcomeOf(chosen: string | null, key: string): 'right' | 'wrong' | 'blank' {
    if (!chosen) return 'blank';

    return key && chosen === key ? 'right' : 'wrong';
  }
</script>

<svelte:head>
  <title>{$t('exam.print.title')} — {data.examTitle}</title>
</svelte:head>

<div class="toolbar">
  <a href={`/courses/${data.courseId}`}>{$t('exam.print.back')}</a>
  <button type="button" onclick={() => window.print()}>{$t('exam.print.print')}</button>
  <span>{$t('exam.print.hint')}</span>
</div>

{#each data.rows as row (row.attemptId)}
  <article class="sheet">
    <header class="head">
      <p class="kicker">{$t('exam.print.title')}</p>
      <h1>{data.examTitle}</h1>
    </header>

    <table class="identity">
      <tbody>
        <tr>
          <th>{$t('exam.entry.full_name')}</th>
          <td class="wide">{row.displayName ?? $t('exam.results.no_name')}</td>
          <th>{$t('exam.results.score_column')}</th>
          <td class="score">{row.score ?? '—'}{row.total ? ` / ${row.total}` : ''}</td>
        </tr>
        <tr>
          <th>{$t('exam.entry.class_name')}</th>
          <td>{row.className ?? '—'}</td>
          <th>{$t('exam.results.correct_column')}</th>
          <td>{row.correct} / {data.questions.length}</td>
        </tr>
        <tr>
          <th>{$t('exam.entry.candidate_number')}</th>
          <td>{row.candidateNumber ?? '—'}</td>
          <th>{$t('exam.results.time_taken_column')}</th>
          <td>{minutesTaken(row.startedAt, row.submittedAt)}</td>
        </tr>
        <tr>
          <th>{$t('exam.results.started_at_column')}</th>
          <td>{clockOf(row.startedAt)}</td>
          <th>{$t('exam.results.submitted_at_column')}</th>
          <td>{clockOf(row.submittedAt)}</td>
        </tr>
        <tr>
          <th>{$t('exam.results.leaves_column')}</th>
          <td colspan="3">{row.leaves}</td>
        </tr>
      </tbody>
    </table>

    <section class="answers">
      <p class="band">{$t('exam.print.answers')}</p>

      <div class="columns">
        {#each columns as column (column[0].position)}
          <table class="column">
            <tbody>
              {#each column as question (question.position)}
                {@const chosen = row.chosen[question.position - 1] ?? null}
                {@const outcome = outcomeOf(chosen, question.key)}
                <tr>
                  <th>{question.position}</th>
                  <td class="options">
                    {#each lettersOf(question) as letter (letter)}
                      <!--
                        Two independent marks, because a page printed in black and white on a
                        tired laser is not required to keep a fill. The chosen letter is
                        inked; the key is boxed. A letter that is both is a right answer.
                      -->
                      <span
                        class={['option', chosen?.includes(letter) && 'chosen', question.key.includes(letter) && 'key']
                          .filter(Boolean)
                          .join(' ')}>{letter}</span
                      >
                    {/each}
                  </td>
                  <td class="outcome">
                    {#if outcome === 'right'}✓{:else if outcome === 'wrong'}✗{:else}—{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/each}
      </div>
    </section>

    <!--
      The rest of the page, spent on the one thing the data cannot supply: what the teacher
      wants to say to this candidate, and the signature that makes the sheet theirs.
    -->
    <section class="note">
      <p class="band">{$t('exam.print.note')}</p>
      <div class="note-space"></div>
      <p class="sign">{$t('exam.print.signature')}</p>
    </section>

    <footer class="legend">
      <span><span class="option chosen">A</span> {$t('exam.print.legend_chosen')}</span>
      <span><span class="option key">A</span> {$t('exam.print.legend_key')}</span>
      <span>✓ {$t('exam.results.workbook_right')}</span>
      <span>✗ {$t('exam.results.workbook_wrong')}</span>
      <span>— {$t('exam.results.workbook_blank')}</span>
    </footer>
  </article>
{/each}

<style>
  /*
    The page is the unit here, not the viewport: everything below is sized in millimetres so
    what the print dialog previews is what the sheet measures.
  */
  @page {
    size: A4 portrait;
    margin: 12mm 10mm;
  }

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

  .head {
    text-align: center;
    margin-bottom: 4mm;
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

  .band {
    margin: 0 0 2mm;
    text-align: center;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    border: 0.4mm solid #000;
    padding: 1mm;
  }

  .answers {
    border: 0.4mm solid #000;
    padding: 3mm;
  }

  .columns {
    display: flex;
    /*
      Four columns of letters plus their marks are wider than a quarter of the page each, and
      flex will let the last one spill past the frame rather than admit it: the gap and the
      cell widths below are what keep the fourth column's result glyph inside the border.
    */
    gap: 2.5mm;
    align-items: flex-start;
  }

  .column {
    flex: 1 1 0;
    min-width: 0;
    border-collapse: collapse;
  }

  .column th,
  .column td {
    border-bottom: 0.2mm solid #9ca3af;
    padding: 1.8mm 0.5mm;
    vertical-align: middle;
  }

  .column th {
    width: 8mm;
    text-align: right;
    padding-right: 1.5mm;
    font-weight: 400;
    font-size: 10.5pt;
  }

  .options {
    white-space: nowrap;
  }

  .outcome {
    width: 6mm;
    text-align: center;
    font-size: 12.5pt;
  }

  .option {
    display: inline-block;
    width: 6.2mm;
    height: 6.2mm;
    line-height: 6.2mm;
    margin-right: 0.6mm;
    text-align: center;
    font-size: 10.5pt;
    border: 0.2mm solid transparent;
    border-radius: 50%;
  }

  /* Boxed, not filled: a border survives every printer, and the key must always be legible. */
  .option.key {
    border: 0.5mm solid #000;
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

  .note {
    margin-top: 4mm;
    border: 0.4mm solid #000;
    padding: 3mm;
  }

  .note-space {
    /* Ruled space, sized to what is left of the page rather than to a guess at how much a
       teacher writes: enough for two or three lines of comment on every sheet. */
    height: 26mm;
    border-bottom: 0.2mm solid #9ca3af;
  }

  .sign {
    margin: 2mm 0 0;
    text-align: right;
    font-style: italic;
    font-size: 10.5pt;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4mm;
    margin-top: 3mm;
    font-size: 10pt;
  }

  .legend .option {
    margin-right: 1mm;
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
