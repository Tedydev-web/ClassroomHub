<script lang="ts">
  import { untrack } from 'svelte';
  import { Badge } from '@cio/ui/base/badge';
  import * as Select from '@cio/ui/base/select';
  import * as DropdownMenu from '@cio/ui/base/dropdown-menu';
  import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';

  import { STATUS } from './constants';
  import { t } from '$lib/utils/functions/translations';
  import type { SubmissionIdData } from '$features/course/utils/types';
  import type { AnswerData, AssessmentResponseEnvelope } from '@cio/question-types';

  import Preview from './preview.svelte';
  import * as Dialog from '@cio/ui/base/dialog';
  import { TextareaField } from '@cio/ui/custom/textarea-field';
  import { Button } from '@cio/ui/base/button';
  import { UserAvatar } from '@cio/ui/custom/user-avatar';

  // import { useCompletion } from 'ai/svelte';
  // import { QUESTION_TYPE } from '$features/ui/question/constants';

  interface Props {
    open?: boolean;
    onClose?: () => void;
    handleSave?: (data: SubmissionIdData) => void | Promise<void>;
    data: SubmissionIdData;
    deleteSubmission?: (id: string, statusId: number) => void | Promise<void>;
    isSaving?: boolean;
  }

  let {
    open = $bindable(false),
    onClose = () => {},
    handleSave = (_d: SubmissionIdData) => {},
    data = $bindable(),
    deleteSubmission = async (_id: string, _statusId: number) => {},
    isSaving = false
  }: Props = $props();

  const SELECTABLE_STATUS = [
    {
      id: STATUS.SUBMITTED,
      text: $t('course.navItem.submissions.submission_status.submitted')
    },
    {
      id: STATUS.IN_PROGRESS,
      text: $t('course.navItem.submissions.submission_status.in_progress')
    },
    {
      id: STATUS.GRADED,
      text: $t('course.navItem.submissions.submission_status.graded')
    }
  ];

  let status = $state(SELECTABLE_STATUS[0]);
  let isLoading = $state(false);
  let openDeletePrompt = $state(false);
  let isDeleting = $state(false);

  const maxPoints = $derived(getMaxPoints(data.questions) + getCanonicalMaxPoints(data.canonicalQuestions));
  const sortedQuestions = $derived(
    Array.isArray(data.questions)
      ? [...data.questions]
          .sort((a, b) => a.order - b.order)
          .map((q) => ({
            ...q,
            questionType: { id: q.questionTypeId }
          }))
      : []
  );

  let answersToDisplay = $derived(data?.answers ? (data.answers as Record<string, AnswerData>) : {});
  const canonicalAnswers = $derived(getCanonicalAnswers(data.questionAnswers));

  function getCanonicalAnswers(questionAnswers: SubmissionIdData['questionAnswers']) {
    const answers: Record<string, AssessmentResponseEnvelope | undefined> = {};
    for (const questionAnswer of questionAnswers ?? []) {
      if (questionAnswer.answerData?.type !== 'ASSESSMENT_ITEM') continue;

      answers[String(questionAnswer.questionId)] = questionAnswer.answerData.response;
    }

    return answers;
  }

  function getMaxPoints(questions: SubmissionIdData['questions']) {
    return (questions || []).reduce((acc, question) => acc + question.points, 0);
  }

  function getCanonicalMaxPoints(canonicalQuestions: SubmissionIdData['canonicalQuestions']) {
    return (canonicalQuestions || []).reduce(
      (questionTotal, question) =>
        questionTotal +
        question.definition.blocks.reduce((blockTotal, block) => {
          if (block.kind === 'content') return blockTotal;

          return blockTotal + block.interaction.maxScore;
        }, 0),
      0
    );
  }

  let total = $derived(calculateTotal(data.questionAnswerByPoint));
  function calculateTotal(grades: Record<string, string>): number {
    if (!grades) return 0;
    const sum = Object.values(grades).reduce((acc, grade) => {
      const numericGrade = Number(grade);

      return acc + (Number.isFinite(numericGrade) ? numericGrade : 0);
    }, 0);

    return Math.round((sum + Number.EPSILON) * 100) / 100;
  }

  function handleStatusChange(value: string) {
    const newSelectedId = parseInt(value);
    const newStatus = SELECTABLE_STATUS.find((s) => s.id === newSelectedId);

    if (newStatus) {
      status = newStatus;
      data.statusId = newSelectedId;
    }
  }

  function setStatus(data: SubmissionIdData) {
    untrack(() => {
      const statusBySelectedId = SELECTABLE_STATUS.find((s) => s.id === data.statusId);

      if (statusBySelectedId) {
        status = statusBySelectedId;
      }
    });
  }

  //   const incorrectSelections = answer.answers.length - correctSelections;

  async function handleDeleteSubmission() {
    isDeleting = true;
    await deleteSubmission(data.id, status.id);
    isDeleting = false;
  }

  //           const answerPoints = answer?.answers?.length ?? 0;

  //           const { finalPoints, correctOptions, correctSelections, incorrectSelections } =
  //             getMultipleAnswersGrade(options, answer, points);

  $effect(() => {
    setStatus(data);
  });
</script>

<Dialog.Root
  bind:open
  onOpenChange={(isOpen) => {
    if (!isOpen) onClose();
  }}
>
  <Dialog.Content class="max-h-[90vh]! w-4/5 max-w-6xl!">
    <Dialog.Header class="py-2">
      <Dialog.Title class="text-base font-semibold">{data.title}</Dialog.Title>
    </Dialog.Header>
    <div class="flex max-h-[calc(90vh-5rem)] justify-between gap-4 overflow-y-auto pr-4">
      <div class="mt-2 min-h-0 min-w-0 flex-1">
        {#if openDeletePrompt}
          <div class="ui:border-border mx-auto w-96 rounded-md border p-3">
            <h1 class="text-lg dark:text-white">
              {$t('delete_modal.content')}
            </h1>

            <div class="mt-5 flex items-center justify-between">
              <Button variant="outline" onclick={() => (openDeletePrompt = false)} disabled={isDeleting}>
                {$t('delete_modal.no')}
              </Button>
              <Button variant="outline" onclick={handleDeleteSubmission} loading={isDeleting}>
                {$t('delete_modal.yes')}
              </Button>
            </div>
          </div>
        {:else}
          <Preview
            questions={sortedQuestions}
            questionnaireMetaData={{
              answers: answersToDisplay,
              isFinished: true
            }}
            bind:grades={data.questionAnswerByPoint}
            bind:isLoading
            disableGrading={false}
            canonicalQuestions={(data.canonicalQuestions ?? []).map((question) => ({
              id: String(question.id),
              title: question.title,
              order: question.order,
              exerciseSectionId: question.exerciseSectionId,
              definition: question.definition
            }))}
            {canonicalAnswers}
          />
        {/if}
      </div>

      <div class="sticky top-0 mt-2 ml-4 min-h-0 w-2/5 max-w-[350px] shrink-0 self-start">
        <div class="ui:border-border rounded-md border">
          <div
            class="ui:border-border flex items-center justify-between gap-1 border-t-0 border-r-0 border-b border-l-0 p-3"
          >
            <p class="text-base dark:text-white">
              {$t('course.navItem.submissions.grading_modal.details')}
              {#if data.isEarly}
                <Badge variant="success" class="ml-2">
                  {$t('course.navItem.submissions.grading_modal.early')}
                </Badge>
              {:else}
                <Badge variant="destructive" class="ml-2">
                  {$t('course.navItem.submissions.grading_modal.late')}
                </Badge>
              {/if}
            </p>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger class="ui:hover:bg-accent flex h-8 w-8 items-center justify-center rounded-md">
                <EllipsisVerticalIcon class="h-5 w-5" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Item
                  class="ui:text-destructive"
                  onclick={() => {
                    openDeletePrompt = true;
                  }}
                >
                  {$t('delete_modal.label')}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>

          <div class="flex items-center space-x-4 px-3 py-2 text-sm">
            <p class="ui:text-muted-foreground text-sm font-semibold">
              {$t('course.navItem.submissions.grading_modal.total_grade')}:
            </p>

            <Badge class="ui:bg-muted ui:text-foreground w-fit rounded-md font-semibold">
              {total}/{maxPoints}
            </Badge>
          </div>
          <!-- <div class="flex items-center text-sm p-3">
        <p class="dark:text-white w-1/2">Status</p>
        <div class="flex items-center">
          <p class="dark:text-white rounded-full w-5 h-5 bg-yellow-300 mr-2" />
          <p class="dark:text-white">Grading</p>
        </div>
      </div> -->
          <div class="flex items-center space-x-4 px-3 py-2 text-sm">
            <p class="ui:text-muted-foreground text-sm font-semibold">
              {$t('course.navItem.submissions.grading_modal.student')}:
            </p>
            {#if data.student}
              <div class="ui:bg-muted flex flex-row items-center justify-center rounded-md p-[6px]">
                <UserAvatar
                  src={data.student.avatarUrl}
                  alt={$t('course.navItem.submissions.grading_modal.student_avatar')}
                  class="h-5 w-5"
                />
                <p class="ml-2 line-clamp-1 text-sm font-semibold dark:text-white">
                  {data.student.fullname}
                </p>
              </div>
            {/if}
          </div>

          <div class="flex flex-col items-start px-3 py-2 text-sm">
            <p class="ui:text-muted-foreground font-semibold">
              {$t('course.navItem.submissions.grading_modal.status')}:
            </p>
            <Select.Root
              type="single"
              value={status.id.toString()}
              onValueChange={(value) => {
                if (value) {
                  handleStatusChange(value);
                }
              }}
            >
              <Select.Trigger class="w-full">
                {status.text}
              </Select.Trigger>
              <Select.Content class="z-menu-elevated">
                {#each SELECTABLE_STATUS as statusOption (statusOption.id)}
                  <Select.Item value={statusOption.id.toString()}>
                    {statusOption.text}
                  </Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>

          <div class="flex flex-col items-start px-3 py-2 text-sm">
            <p class="ui:text-muted-foreground font-semibold">
              {$t('course.navItem.submissions.grading_modal.add_comment')}:
            </p>
            <TextareaField
              placeholder={$t('course.navItem.submissions.grading_modal.add_comment_placeholder')}
              bind:value={data.feedback}
            />
          </div>

          <div class="flex w-full flex-col space-y-3 px-3 py-2">
            <Button
              onclick={() => {
                handleSave(data);
                // onClose();
              }}
              loading={isSaving}
              class="w-full"
            >
              {$t('course.navItem.submissions.grading_modal.submit_grades')}
            </Button>
          </div>
          <!-- <div class="flex items-center text-sm p-3">
        <p class="dark:text-white w-1/2">Teacher</p>
        <p class="dark:text-white">Tedydev-web</p>
      </div> -->
        </div>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
