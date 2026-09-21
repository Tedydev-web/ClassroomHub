import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { db, eq, sql } from '@cio/db/drizzle';
import * as schema from '@cio/db/schema';
import { MAX_AUTHORED_HTML_LENGTH, QUESTION_TYPE_REGISTRY } from '@cio/question-types';

import {
  materializeLegacyQuestionRevision,
  publishQuestionRevision,
  resolveAttemptedQuestionSet
} from './question-revision';

/**
 * Runnable integration check for the question-revision gateway (mirrors the
 * `packages/db/scripts/*.integration.check.ts` convention). It exercises
 * publish/materialize/resolve directly against a real database — the
 * submission-service wiring has its own vitest coverage in `apps/api`.
 *
 * Requires migrations through 0012 to be applied (including the reserved
 * internal ASSESSMENT_ITEM question-type row). Creates its own fixture graph
 * and removes it afterwards. Run from the repository root:
 *
 *   DATABASE_URL="postgresql://postgres:postgres@localhost:15432/classroomhub" \
 *     npx tsx packages/core/src/services/assessment/question-revision.integration.check.ts
 */

let passedAssertions = 0;

function assert(condition: unknown, label: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${label}`);

  passedAssertions += 1;
  console.log(`ok ${passedAssertions} - ${label}`);
}

/** Rewrites one text occurrence so a definition gets a new content hash without pinning the kernel shape. */
function mutateDefinitionText(definition: unknown, search: string, replacement: string): unknown {
  const serialized = JSON.stringify(definition);
  if (!serialized.includes(search)) {
    throw new Error(`Definition mutation target "${search}" not found; the check would silently no-op`);
  }

  return JSON.parse(serialized.replaceAll(search, replacement)) as unknown;
}

async function expectRejection(
  promise: Promise<unknown>,
  label: string
): Promise<{ statusCode?: number; message?: string }> {
  const outcome = await promise.then(
    () => null,
    (error: unknown) => error as { statusCode?: number; message?: string }
  );
  if (outcome === null) throw new Error(`ASSERTION FAILED: ${label} (the call unexpectedly succeeded)`);

  return outcome;
}

type RevisionSnapshot = { id: string; revision: number; contentHash: string; definition: unknown };

async function listRevisions(questionId: number): Promise<RevisionSnapshot[]> {
  const rows = await db.execute(sql`
    SELECT id, revision, content_hash, definition FROM question_revision
    WHERE question_id = ${questionId} ORDER BY revision ASC
  `);

  return [...rows].map((row) => ({
    id: String(row.id),
    revision: Number(row.revision),
    contentHash: String(row.content_hash),
    definition: row.definition as unknown
  }));
}

async function getQuestionState(questionId: number) {
  const rows = await db.execute(
    sql`SELECT points, archived_at, current_revision_id FROM question WHERE id = ${questionId}`
  );
  const [row] = [...rows];

  return {
    points: row?.points == null ? null : Number(row.points),
    archivedAt: row?.archived_at == null ? null : String(row.archived_at),
    currentRevisionId: row?.current_revision_id == null ? null : String(row.current_revision_id)
  };
}

export async function runQuestionRevisionGatewayCheck(): Promise<void> {
  const internalQuestionType = QUESTION_TYPE_REGISTRY.find((type) => type.internal === true);
  if (!internalQuestionType) {
    throw new Error('Registry has no internal question type; the publish coverage below would silently vanish');
  }

  const profileId = randomUUID();
  const ids = {
    course: randomUUID(),
    exercise: randomUUID(),
    group: randomUUID(),
    member: randomUUID(),
    organization: randomUUID(),
    profile: profileId,
    submission: randomUUID(),
    corruptSubmission: randomUUID(),
    user: profileId
  };

  try {
    const email = `${ids.user}@example.com`;
    await db.insert(schema.user).values({ id: ids.user, name: 'Gateway check', email });
    await db
      .insert(schema.profile)
      .values({ id: ids.profile, fullname: 'Gateway check', username: `gw-${profileId}`, email });
    await db
      .insert(schema.organization)
      .values({ id: ids.organization, name: 'Gateway check org', siteName: `gw-${ids.organization}` });
    await db
      .insert(schema.group)
      .values({ id: ids.group, name: 'Gateway check group', organizationId: ids.organization });
    await db
      .insert(schema.course)
      .values({ id: ids.course, groupId: ids.group, title: 'Gateway check course', description: 'x' });
    await db
      .insert(schema.groupmember)
      .values({ id: ids.member, groupId: ids.group, roleId: 3, profileId: ids.profile, email });
    await db
      .insert(schema.exercise)
      .values({ id: ids.exercise, courseId: ids.course, title: 'Gateway check exercise', order: 1 });
    const questions = await db
      .insert(schema.question)
      .values([
        {
          exerciseId: ids.exercise,
          title: 'Gateway question one',
          questionTypeId: 5,
          points: 2,
          settings: { required: true }
        },
        {
          exerciseId: ids.exercise,
          title: 'Gateway question two',
          questionTypeId: 5,
          points: 2,
          settings: { required: true }
        },
        { exerciseId: ids.exercise, title: 'Degenerate radio', questionTypeId: 1, points: 1, settings: {} },
        { exerciseId: ids.exercise, title: 'Corrupt revision holder', questionTypeId: 5, points: 2, settings: {} },
        {
          exerciseId: ids.exercise,
          title: 'Composer item holder',
          questionTypeId: internalQuestionType.id,
          points: 0,
          settings: {}
        }
      ])
      .returning({ id: schema.question.id, title: schema.question.title });
    const questionOne = questions.find((question) => question.title === 'Gateway question one');
    const questionTwo = questions.find((question) => question.title === 'Gateway question two');
    const degenerateRadio = questions.find((question) => question.title === 'Degenerate radio');
    const corruptHolder = questions.find((question) => question.title === 'Corrupt revision holder');
    const composerItem = questions.find((question) => question.title === 'Composer item holder');
    if (!questionOne || !questionTwo || !degenerateRadio || !corruptHolder || !composerItem) {
      throw new Error('Fixture questions were not created');
    }

    await db.insert(schema.option).values({ questionId: degenerateRadio.id, label: 'only option', isCorrect: false });

    // Standalone materialization: revision 1, pointer promoted, points projected.
    const materialized = await materializeLegacyQuestionRevision(questionOne.id);
    assert(materialized.questionId === questionOne.id && materialized.revision === 1, 'materialize creates revision 1');
    const stateAfterMaterialize = await getQuestionState(questionOne.id);
    assert(stateAfterMaterialize.currentRevisionId === materialized.id, 'materialize promotes the pointer');
    assert(stateAfterMaterialize.points === 2, 'materialize projects two-decimal points (2)');

    // Re-materialization reuses the current pointer only because the live row
    // still hashes to the same content (no new rows).
    const rematerialized = await materializeLegacyQuestionRevision(questionOne.id);
    assert(rematerialized.id === materialized.id, 'materialize reuses the hash-identical current revision');
    assert((await listRevisions(questionOne.id)).length === 1, 'no duplicate revision after reuse');
    const [revisionOne] = await listRevisions(questionOne.id);
    const definitionA = revisionOne.definition;

    // A current pointer does not freeze the legacy row forever: deleting every
    // submission of an exercise lifts the post-attempt edit freeze, after which
    // ordinary edits mutate the live row in place. Materialization must then
    // append the live content instead of reusing the stale pointer revision.
    // Content-only drift (title changes, points identical):
    await db.execute(sql`UPDATE question SET title = 'Gateway question one (edited)' WHERE id = ${questionOne.id}`);
    const contentDrift = await materializeLegacyQuestionRevision(questionOne.id);
    assert(contentDrift.revision === 2, 'content-only drift appends revision 2 instead of reusing');
    const stateAfterContentDrift = await getQuestionState(questionOne.id);
    assert(stateAfterContentDrift.currentRevisionId === contentDrift.id, 'content drift promotes the pointer');
    assert(stateAfterContentDrift.points === 2, 'content-only drift keeps the points projection (2)');
    const revisionsAfterContentDrift = await listRevisions(questionOne.id);
    assert(
      JSON.stringify(revisionsAfterContentDrift[1].definition).includes('Gateway question one (edited)'),
      'appended revision stores the live edited content'
    );
    assert(
      revisionsAfterContentDrift[1].contentHash !== revisionsAfterContentDrift[0].contentHash,
      'content drift changes the content hash'
    );

    // Scoring drift (points change with the edit): the appended revision must
    // derive its maximum from the live points and re-project them.
    await db.execute(
      sql`UPDATE question SET title = 'Gateway question one (regraded)', points = 5 WHERE id = ${questionOne.id}`
    );
    const pointsDrift = await materializeLegacyQuestionRevision(questionOne.id);
    assert(pointsDrift.revision === 3, 'points drift appends revision 3');
    assert((await getQuestionState(questionOne.id)).points === 5, 'points drift projects the live points (5)');
    const revisionsAfterPointsDrift = await listRevisions(questionOne.id);
    assert(
      JSON.stringify(revisionsAfterPointsDrift[2].definition).includes('"maxScore":5'),
      'appended revision derives maxScore from the live points'
    );
    assert(
      revisionsAfterPointsDrift.map((revision) => revision.revision).join(',') === '1,2,3',
      'drift appends stay monotonic with no gaps'
    );
    const rematerializedAfterDrift = await materializeLegacyQuestionRevision(questionOne.id);
    assert(
      rematerializedAfterDrift.id === pointsDrift.id && (await listRevisions(questionOne.id)).length === 3,
      're-materialization after drift reuses the fresh hash-identical revision'
    );

    // Authored publish flow: only the internal composite item type accepts
    // publishes, so the full publish lifecycle runs on the composer question.
    const publishedOne = await publishQuestionRevision({
      questionId: composerItem.id,
      expectedRevision: 0,
      definition: definitionA
    });
    assert(publishedOne.revision === 1, 'publish creates revision 1 for an internal assessment item');
    const composerStateAfterFirstPublish = await getQuestionState(composerItem.id);
    assert(composerStateAfterFirstPublish.currentRevisionId === publishedOne.id, 'publish promotes the pointer');
    assert(composerStateAfterFirstPublish.points === 2, 'publish projects the definition maximum into points (2)');

    // Publish B (mutated content) with the correct expectation.
    const definitionB = mutateDefinitionText(definitionA, 'Gateway question one', 'Gateway question one v2');
    const revisionTwo = await publishQuestionRevision({
      questionId: composerItem.id,
      expectedRevision: 1,
      definition: definitionB
    });
    assert(revisionTwo.revision === 2, 'publish appends revision 2');
    assert(
      (await getQuestionState(composerItem.id)).currentRevisionId === revisionTwo.id,
      'publish promotes the pointer to revision 2'
    );

    // Stale expected revision: AppError 409, nothing written.
    const stale = await expectRejection(
      publishQuestionRevision({ questionId: composerItem.id, expectedRevision: 1, definition: definitionA }),
      'stale expectedRevision'
    );
    assert(stale.statusCode === 409, 'stale expectedRevision rejects with 409');
    assert((await listRevisions(composerItem.id)).length === 2, 'stale publish writes no row');

    // Content-hash no-op: republishing the current content returns the same revision.
    const noOp = await publishQuestionRevision({
      questionId: composerItem.id,
      expectedRevision: 2,
      definition: definitionB
    });
    assert(noOp.id === revisionTwo.id && noOp.revision === 2, 'hash no-op returns the current revision');
    assert((await listRevisions(composerItem.id)).length === 2, 'hash no-op writes no row');

    // A-B-A appends a third monotonic revision with the original hash.
    const revisionThree = await publishQuestionRevision({
      questionId: composerItem.id,
      expectedRevision: 2,
      definition: definitionA
    });
    assert(revisionThree.revision === 3, 'A-B-A appends revision 3');
    const revisionsAba = await listRevisions(composerItem.id);
    assert(revisionsAba[2].contentHash === revisionsAba[0].contentHash, 'A-B-A restores the original hash');
    assert(revisionsAba[2].contentHash !== revisionsAba[1].contentHash, 'A and B hashes differ');

    // Concurrent publish with the same expectation: exactly one winner, no gaps.
    const raced = await Promise.allSettled([
      publishQuestionRevision({
        questionId: composerItem.id,
        expectedRevision: 3,
        definition: mutateDefinitionText(definitionA, 'Gateway question one', 'racer-a')
      }),
      publishQuestionRevision({
        questionId: composerItem.id,
        expectedRevision: 3,
        definition: mutateDefinitionText(definitionA, 'Gateway question one', 'racer-b')
      })
    ]);
    assert(raced.filter((result) => result.status === 'fulfilled').length === 1, 'exactly one concurrent publish wins');
    assert(
      raced.filter((result) => result.status === 'rejected').length === 1,
      'the losing concurrent publish rejects'
    );
    assert(
      (await listRevisions(composerItem.id)).map((revision) => revision.revision).join(',') === '1,2,3,4',
      'revisions stay monotonic with no gaps after the race'
    );

    // Two-decimal points projection follows the published maxima.
    const definitionC = mutateDefinitionText(definitionB, '"maxScore":2', '"maxScore":2.5');
    const revisionFive = await publishQuestionRevision({
      questionId: composerItem.id,
      expectedRevision: 4,
      definition: definitionC
    });
    assert(revisionFive.revision === 5, 'points-change publish appends revision 5');
    assert(
      (await getQuestionState(composerItem.id)).points === 2.5,
      'question.points projects the exact two-decimal maximum (2.5)'
    );

    // Float artifacts the schema tolerates (0.1 + 0.2 = 0.30000000000000004)
    // must be normalized to the exact two-decimal value before hashing and
    // storage — a stored artifact would poison the strict SQL denominator.
    const floatArtifact = 0.1 + 0.2;
    const definitionFloatArtifact = mutateDefinitionText(definitionC, '"maxScore":2.5', `"maxScore":${floatArtifact}`);
    const revisionSix = await publishQuestionRevision({
      questionId: composerItem.id,
      expectedRevision: 5,
      definition: definitionFloatArtifact
    });
    assert(revisionSix.revision === 6, 'float-artifact maxScore publish appends revision 6');
    const storedFloatJson = JSON.stringify((await listRevisions(composerItem.id))[5].definition);
    assert(
      storedFloatJson.includes('"maxScore":0.3') && !storedFloatJson.includes('0.30000000000000004'),
      'stored definition normalizes maxScore to the exact two-decimal value (0.3)'
    );
    assert(
      (await getQuestionState(composerItem.id)).points === 0.3,
      'question.points projects the normalized maximum (0.3)'
    );
    const definitionPointThree = mutateDefinitionText(definitionC, '"maxScore":2.5', '"maxScore":0.3');
    const normalizedNoOp = await publishQuestionRevision({
      questionId: composerItem.id,
      expectedRevision: 6,
      definition: definitionPointThree
    });
    assert(
      normalizedNoOp.id === revisionSix.id && (await listRevisions(composerItem.id)).length === 6,
      'republishing the exact two-decimal equivalent is a hash no-op'
    );

    // Authored HTML passes through the server sanitizer before hashing/storing.
    type PromptShape = { blocks: Array<{ kind: string; interaction?: { prompt: { html: string } } }> };
    const dirty = JSON.parse(JSON.stringify(definitionPointThree)) as PromptShape;
    const dirtyInteraction = dirty.blocks.find((block) => block.kind === 'interaction');
    if (!dirtyInteraction?.interaction) throw new Error('Fixture definition has no interaction block');
    dirtyInteraction.interaction.prompt.html = '<img src=x onerror=alert(1)>hello<script>steal()</script>';
    const revisionSeven = await publishQuestionRevision({
      questionId: composerItem.id,
      expectedRevision: 6,
      definition: dirty
    });
    assert(revisionSeven.revision === 7, 'sanitized publish appends revision 7');
    const storedSeven = (await listRevisions(composerItem.id))[6].definition as PromptShape;
    const storedInteraction = storedSeven.blocks.find((block) => block.kind === 'interaction');
    const storedHtml = storedInteraction?.interaction?.prompt.html ?? '';
    assert(
      !storedHtml.includes('script') && !storedHtml.includes('onerror'),
      `stored html is sanitized ("${storedHtml}")`
    );

    // Invalid/malformed definitions fail 400 at the trust boundary.
    const malformed = await expectRejection(
      publishQuestionRevision({ questionId: composerItem.id, expectedRevision: 7, definition: { schemaVersion: 2 } }),
      'unsupported schema version'
    );
    assert(malformed.statusCode === 400, 'unsupported schema version rejects with 400');

    // Sanitizer output is an untrusted mutation: html that expands during
    // sanitization (attribute quoting turns '<img src=x>' into '<img src="x">')
    // past the structural limit must fail the post-sanitize reparse with an
    // explicit server error, writing nothing.
    const expandingUnit = '<img src=x>';
    const sanitizedUnitLength = '<img src="x">'.length;
    const expandingRepeat = Math.floor(MAX_AUTHORED_HTML_LENGTH / sanitizedUnitLength) + 1;
    if (expandingUnit.length * expandingRepeat > MAX_AUTHORED_HTML_LENGTH) {
      throw new Error('Oversize fixture no longer fits the structural limit before sanitization');
    }
    const oversize = JSON.parse(JSON.stringify(definitionC)) as PromptShape;
    const oversizeInteraction = oversize.blocks.find((block) => block.kind === 'interaction');
    if (!oversizeInteraction?.interaction) throw new Error('Fixture definition has no interaction block');
    oversizeInteraction.interaction.prompt.html = expandingUnit.repeat(expandingRepeat);
    const sanitizedReparse = await expectRejection(
      publishQuestionRevision({ questionId: composerItem.id, expectedRevision: 7, definition: oversize }),
      'sanitizer-expanded definition'
    );
    assert(
      sanitizedReparse.statusCode === 500,
      'sanitizer-expanded definition fails the post-sanitize reparse with 500'
    );
    assert((await listRevisions(composerItem.id)).length === 7, 'failed post-sanitize reparse writes no row');

    // Missing question: 404 for both entry points.
    const missingPublish = await expectRejection(
      publishQuestionRevision({ questionId: 999999999, expectedRevision: 0, definition: definitionA }),
      'publish on a missing question'
    );
    assert(missingPublish.statusCode === 404, 'publish on a missing question rejects 404');
    const missingMaterialize = await expectRejection(
      materializeLegacyQuestionRevision(999999999),
      'materialize on a missing question'
    );
    assert(missingMaterialize.statusCode === 404, 'materialize on a missing question rejects 404');

    // Materialize skips the author gate entirely (it mirrors what learners see).
    const degenerate = await materializeLegacyQuestionRevision(degenerateRadio.id);
    assert(degenerate.revision === 1, 'degenerate radio materializes structurally (no publish gate)');

    // Canonical revisions have no scoring engine for legacy question types, so
    // publishing onto a legacy-type question fails closed even with a valid
    // definition; legacy content keeps flowing through lazy materialization.
    const legacyTypePublish = await expectRejection(
      publishQuestionRevision({ questionId: degenerateRadio.id, expectedRevision: 1, definition: definitionA }),
      'publish on a legacy-type question'
    );
    assert(legacyTypePublish.statusCode === 409, 'legacy-type publish fails closed with 409');
    assert(
      (legacyTypePublish.message ?? '').includes('internal assessment items'),
      'legacy-type rejection names the internal-assessment-item restriction'
    );
    assert((await listRevisions(degenerateRadio.id)).length === 1, 'legacy-type rejection writes no row');

    // The author publish gate still rejects degenerate content on a question
    // type that accepts publishes.
    const degenerateDefinition = (await listRevisions(degenerateRadio.id))[0].definition;
    const gate = await expectRejection(
      publishQuestionRevision({
        questionId: composerItem.id,
        expectedRevision: 7,
        definition: degenerateDefinition
      }),
      'publish gate on a degenerate definition'
    );
    assert(gate.statusCode === 400, 'publish gate rejects a degenerate definition with 400');

    // Archived questions reject new publishes with 409.
    await db.execute(sql`UPDATE question SET archived_at = now() WHERE id = ${composerItem.id}`);
    const archivedPublish = await expectRejection(
      publishQuestionRevision({ questionId: composerItem.id, expectedRevision: 7, definition: definitionA }),
      'publish on an archived question'
    );
    assert(archivedPublish.statusCode === 409, 'publish on an archived question rejects 409');

    // resolveAttemptedQuestionSet: exact stored link + lazy legacy resolution + archive visibility.
    await db.execute(sql`UPDATE question SET archived_at = now() WHERE id = ${questionOne.id}`);
    await db
      .insert(schema.submission)
      .values({ id: ids.submission, exerciseId: ids.exercise, courseId: ids.course, submittedBy: ids.member });
    await db.insert(schema.questionAnswer).values([
      {
        questionId: questionOne.id,
        groupMemberId: ids.member,
        submissionId: ids.submission,
        questionRevisionId: revisionOne.id
      },
      { questionId: questionTwo.id, groupMemberId: ids.member, submissionId: ids.submission }
    ]);
    const attemptedSet = await resolveAttemptedQuestionSet(ids.submission);
    assert(attemptedSet.length === 2, 'one entry per stored answer');
    const entryOne = attemptedSet.find((entry) => entry.questionId === questionOne.id);
    const entryTwo = attemptedSet.find((entry) => entry.questionId === questionTwo.id);
    assert(
      entryOne?.questionRevisionId === revisionOne.id,
      'linked answer resolves the exact attempted revision (not current)'
    );
    assert(entryOne?.archivedAt != null, 'archived question stays visible with archivedAt');
    const questionTwoRevisions = await listRevisions(questionTwo.id);
    assert(
      questionTwoRevisions.length === 1 && entryTwo?.questionRevisionId === questionTwoRevisions[0].id,
      'null-link answer materializes a current revision'
    );
    assert(entryTwo?.archivedAt === null, 'active question resolves with archivedAt null');
    if (!entryOne || !entryTwo) throw new Error('Resolution entries missing after assertions');

    // Semantic gateway: every entry carries the parsed attempted definition,
    // its derived two-decimal maximum, and capability derivation — all from
    // the exact attempted revision row, never the question's current pointer
    // (question one currently points at drift revision 3 with live points 5).
    const entryOneJson = JSON.stringify(entryOne.definition);
    assert(
      entryOneJson.includes('Gateway question one') &&
        !entryOneJson.includes('(edited)') &&
        !entryOneJson.includes('(regraded)'),
      'linked entry carries the exact attempted revision-1 definition content'
    );
    assert(entryOne.maxScore === 2, 'linked entry maxScore derives from the attempted revision (2, not live 5)');
    assert(
      entryOne.capabilities.gradingMode === 'manual' &&
        entryOne.capabilities.manualGradingRequired === true &&
        entryOne.capabilities.autoGradable === false,
      'linked entry capabilities derive from the attempted definition (manual text interaction)'
    );
    assert(
      JSON.stringify(entryTwo.definition).includes('Gateway question two') && entryTwo.maxScore === 2,
      'materialized entry carries its parsed definition and derived maxScore'
    );

    const linkRows = await db.execute(sql`
      SELECT question_revision_id FROM question_answer
      WHERE submission_id = ${ids.submission}::uuid AND question_id = ${questionTwo.id}
    `);
    assert([...linkRows][0]?.question_revision_id === null, 'resolution never rewrites old answer rows');

    // Resolution is stable: repeating it adds no revisions and returns identical entries.
    const attemptedSetAgain = await resolveAttemptedQuestionSet(ids.submission);
    assert(
      JSON.stringify(attemptedSetAgain) === JSON.stringify(attemptedSet),
      'repeated resolution returns identical entries'
    );
    assert((await listRevisions(questionTwo.id)).length === 1, 'repeated resolution materializes nothing new');

    // A corrupt/future stored definition fails resolution explicitly, naming
    // the offending revision id (missing rows are structurally unreachable:
    // the answer -> revision FK forbids deleting a referenced revision).
    const [corruptRevision] = await db
      .insert(schema.questionRevision)
      .values({
        questionId: corruptHolder.id,
        revision: 1,
        definition: { schemaVersion: 99 },
        contentHash: 'corrupt-definition-check'
      })
      .returning({ id: schema.questionRevision.id });
    if (!corruptRevision) throw new Error('Corrupt revision fixture was not created');
    await db
      .insert(schema.submission)
      .values({ id: ids.corruptSubmission, exerciseId: ids.exercise, courseId: ids.course, submittedBy: ids.member });
    await db.insert(schema.questionAnswer).values({
      questionId: corruptHolder.id,
      groupMemberId: ids.member,
      submissionId: ids.corruptSubmission,
      questionRevisionId: corruptRevision.id
    });
    const corrupt = await expectRejection(
      resolveAttemptedQuestionSet(ids.corruptSubmission),
      'corrupt stored definition'
    );
    assert(corrupt.statusCode === 500, 'corrupt stored definition rejects with 500');
    assert(
      (corrupt.message ?? '').includes(corruptRevision.id),
      'corrupt-definition error names the offending revision id'
    );

    console.log(`\nALL ${passedAssertions} ASSERTIONS PASSED`);
  } finally {
    await db.delete(schema.submission).where(eq(schema.submission.exerciseId, ids.exercise));
    await db.delete(schema.exercise).where(eq(schema.exercise.id, ids.exercise));
    await db.delete(schema.groupmember).where(eq(schema.groupmember.id, ids.member));
    await db.delete(schema.course).where(eq(schema.course.id, ids.course));
    await db.delete(schema.group).where(eq(schema.group.id, ids.group));
    await db.delete(schema.organization).where(eq(schema.organization.id, ids.organization));
    await db.delete(schema.profile).where(eq(schema.profile.id, ids.profile));
    await db.delete(schema.user).where(eq(schema.user.id, ids.user));
  }
}

const isDirectExecution = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  runQuestionRevisionGatewayCheck()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
