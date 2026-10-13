<script lang="ts">
  import { Switch } from '@cio/ui/base/switch';
  import { Label } from '@cio/ui/base/label';
  import { Button } from '@cio/ui/base/button';
  import { InputField } from '@cio/ui/custom/input-field';
  import { NumberField } from '@cio/ui/custom/number-field';
  import { questionnaire } from './store';
  import { exerciseApi } from '$features/course/api';
  import { courseApi } from '$features/course/api';
  import { t } from '$lib/utils/functions/translations';
  import { snackbar } from '$features/ui/snackbar/store';
  import { slugifyTitle } from '@cio/utils/validation';
  import * as Select from '@cio/ui/base/select';
  import { Checkbox } from '@cio/ui/base/checkbox';
  import { ROLE } from '@cio/utils/constants';
  import { untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import * as Dialog from '@cio/ui/base/dialog';
  import type { ExerciseAssignments } from '$features/course/utils/types';

  type Props = {
    exerciseId: string;
    onBeforeSave?: () => Promise<boolean> | boolean;
    totalSubmissions?: number;
  };

  let { exerciseId, onBeforeSave = () => true, totalSubmissions = 0 }: Props = $props();

  let saving = $state(false);
  let assignmentsLoading = $state(true);
  let assignmentLoadFailed = $state(false);
  let saveError = $state<'settings' | 'assignment' | 'partial' | null>(null);
  let removalConfirmationOpen = $state(false);
  let assignmentLoadRequestId = 0;
  let assignmentMode = $state<'ALL_STUDENTS' | 'SELECTED_STUDENTS'>('ALL_STUDENTS');
  let selectedStudentIds = new SvelteSet<string>();
  let loadedAssignments = $state<ExerciseAssignments | null>(null);
  let savedSettings = $state<{
    allowMultipleAttempts: boolean;
    completionPolicy: 'submitted' | 'passed';
    passThreshold: number;
    sectionDisplayMode: 'one_question' | 'all_questions' | 'learner_choice';
    slug?: string;
  } | null>(null);
  let slug = $derived($questionnaire.slug ?? '');
  const students = $derived(courseApi.group.people.filter((member) => member.roleId === ROLE.STUDENT));

  const isPublicCourse = $derived(courseApi.course?.type === 'PUBLIC');

  const currentSettings = $derived({
    allowMultipleAttempts: !!$questionnaire.allowMultipleAttempts,
    completionPolicy: $questionnaire.completionPolicy ?? 'submitted',
    passThreshold: $questionnaire.passThreshold ?? 100,
    sectionDisplayMode: $questionnaire.sectionDisplayMode ?? 'one_question',
    slug: isPublicCourse && slug ? slug : undefined
  });
  const settingsChanged = $derived(
    savedSettings !== null && JSON.stringify(currentSettings) !== JSON.stringify(savedSettings)
  );
  const assignmentChanged = $derived.by(() => {
    if (!loadedAssignments) return false;

    const savedIds = loadedAssignments.assignments.map((assignment) => assignment.groupMemberId).sort();
    const currentIds = assignmentMode === 'SELECTED_STUDENTS' ? [...selectedStudentIds].sort() : [];

    return loadedAssignments.mode !== assignmentMode || savedIds.join(',') !== currentIds.join(',');
  });
  const removedAssignmentsWithSubmissions = $derived.by(() => {
    if (!loadedAssignments || loadedAssignments.mode !== 'SELECTED_STUDENTS') return [];

    return loadedAssignments.assignments.filter(
      (assignment) =>
        (assignmentMode === 'ALL_STUDENTS' || !selectedStudentIds.has(assignment.groupMemberId)) &&
        assignment.submissionCount > 0
    );
  });
  const removedSubmissionCount = $derived(
    removedAssignmentsWithSubmissions.reduce((total, assignment) => total + assignment.submissionCount, 0)
  );

  $effect(() => {
    const requestedExerciseId = exerciseId;
    savedSettings = untrack(() => currentSettings);
    void loadAssignments(requestedExerciseId);
  });

  async function loadAssignments(requestedExerciseId = exerciseId) {
    if (!courseApi.course?.id) return;

    const requestId = ++assignmentLoadRequestId;
    assignmentsLoading = true;
    assignmentLoadFailed = false;
    saveError = null;

    const response = await exerciseApi.getAssignments(courseApi.course.id, requestedExerciseId);
    if (requestId !== assignmentLoadRequestId || requestedExerciseId !== exerciseId) return;

    if (response?.success) {
      assignmentMode = isPublicCourse ? 'ALL_STUDENTS' : response.data.mode;
      selectedStudentIds.clear();
      if (!isPublicCourse) {
        for (const assignment of response.data.assignments) {
          selectedStudentIds.add(assignment.groupMemberId);
        }
      }
      loadedAssignments = response.data;
    } else {
      loadedAssignments = null;
      assignmentLoadFailed = true;
    }
    assignmentsLoading = false;
  }

  function toggleStudent(memberId: string) {
    if (selectedStudentIds.has(memberId)) {
      selectedStudentIds.delete(memberId);
      return;
    }

    selectedStudentIds.add(memberId);
  }

  async function requestSave() {
    if (assignmentChanged && removedAssignmentsWithSubmissions.length > 0) {
      removalConfirmationOpen = true;
      return;
    }

    await saveSettings();
  }

  async function saveSettings() {
    if (!courseApi.course?.id) return;
    const canSave = await onBeforeSave();
    if (!canSave) return;

    saving = true;
    saveError = null;
    removalConfirmationOpen = false;
    const hadSettingsChanges = settingsChanged;

    if (hadSettingsChanges) {
      const settingsResponse = await exerciseApi.update(courseApi.course.id, exerciseId, currentSettings);
      if (!settingsResponse?.success) {
        saveError = 'settings';
        saving = false;
        return;
      }
      savedSettings = currentSettings;
    }

    if (assignmentChanged) {
      const assignmentPayload =
        assignmentMode === 'ALL_STUDENTS'
          ? { mode: 'ALL_STUDENTS' as const, groupMemberIds: [] }
          : { mode: 'SELECTED_STUDENTS' as const, groupMemberIds: [...selectedStudentIds] };
      const assignmentResponse = await exerciseApi.updateAssignments(
        courseApi.course.id,
        exerciseId,
        assignmentPayload
      );
      if (!assignmentResponse?.success) {
        saveError = hadSettingsChanges ? 'partial' : 'assignment';
        saving = false;
        return;
      }
      loadedAssignments = assignmentResponse.data;
    }
    saving = false;
    snackbar.success('snackbar.exercise.success');
  }
</script>

<div class="max-w-xl space-y-6">
  <div class="ui:border-border flex items-center justify-between gap-4 rounded-lg border p-4">
    <div class="space-y-1">
      <Label for="allow-multiple" class="ui:text-foreground text-sm font-medium">
        {$t('course.navItem.lessons.exercises.all_exercises.settings_allow_multiple')}
      </Label>
      <p class="ui:text-muted-foreground text-sm">
        {$t('course.navItem.lessons.exercises.all_exercises.settings_allow_multiple_helper')}
      </p>
    </div>
    <Switch
      id="allow-multiple"
      checked={!!$questionnaire.allowMultipleAttempts}
      onCheckedChange={(checked) => {
        questionnaire.update((q) => ({ ...q, allowMultipleAttempts: checked }));
      }}
    />
  </div>

  <div class="ui:border-border rounded-lg border p-4">
    <Label class="ui:text-foreground mb-2 block text-sm font-medium">
      {$t('course.navItem.lessons.exercises.all_exercises.settings_completion_policy')}
    </Label>
    <Select.Root
      type="single"
      value={$questionnaire.completionPolicy ?? 'submitted'}
      onValueChange={(value) => {
        if (value === 'submitted' || value === 'passed') {
          questionnaire.update((state) => ({ ...state, completionPolicy: value }));
        }
      }}
    >
      <Select.Trigger class="w-full">
        {($questionnaire.completionPolicy ?? 'submitted') === 'passed'
          ? $t('course.navItem.lessons.exercises.all_exercises.settings_completion_passed')
          : $t('course.navItem.lessons.exercises.all_exercises.settings_completion_submitted')}
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="submitted">
          {$t('course.navItem.lessons.exercises.all_exercises.settings_completion_submitted')}
        </Select.Item>
        <Select.Item value="passed">
          {$t('course.navItem.lessons.exercises.all_exercises.settings_completion_passed')}
        </Select.Item>
      </Select.Content>
    </Select.Root>

    {#if ($questionnaire.completionPolicy ?? 'submitted') === 'passed'}
      <div class="mt-4 space-y-3">
        <div class="space-y-2 text-sm">
          <p class="ui:text-muted-foreground">
            {$t('course.navItem.lessons.exercises.all_exercises.settings_completion_passed_helper')}
          </p>
          <p class="text-amber-700 dark:text-amber-300">
            {$t('course.navItem.lessons.exercises.all_exercises.settings_manual_grading_warning')}
          </p>
          {#if !$questionnaire.allowMultipleAttempts}
            <p class="text-amber-700 dark:text-amber-300">
              {$t('course.navItem.lessons.exercises.all_exercises.settings_single_attempt_warning')}
            </p>
          {/if}
          {#if totalSubmissions > 0}
            <p class="text-amber-700 dark:text-amber-300">
              {$t('course.navItem.lessons.exercises.all_exercises.settings_existing_submissions_warning')}
            </p>
          {/if}
        </div>
        <NumberField
          integer
          min={0}
          max={100}
          label={$t('course.navItem.lessons.exercises.all_exercises.settings_pass_threshold')}
          value={$questionnaire.passThreshold ?? 100}
          onValueChange={(next) => {
            questionnaire.update((state) => ({ ...state, passThreshold: next ?? 100 }));
          }}
        />
      </div>
    {/if}
  </div>

  <div class="ui:border-border rounded-lg border p-4">
    <Label class="ui:text-foreground mb-2 block text-sm font-medium">
      {$t('course.navItem.lessons.exercises.all_exercises.settings_section_display')}
    </Label>
    <p class="ui:text-muted-foreground mb-3 text-sm">
      {$t('course.navItem.lessons.exercises.all_exercises.settings_section_display_helper')}
    </p>
    <Select.Root
      type="single"
      value={$questionnaire.sectionDisplayMode ?? 'one_question'}
      onValueChange={(value) => {
        if (value === 'one_question' || value === 'all_questions' || value === 'learner_choice') {
          questionnaire.update((state) => ({ ...state, sectionDisplayMode: value }));
        }
      }}
    >
      <Select.Trigger class="w-full">
        {#if ($questionnaire.sectionDisplayMode ?? 'one_question') === 'all_questions'}
          {$t('course.navItem.lessons.exercises.all_exercises.settings_section_display_all_questions')}
        {:else if ($questionnaire.sectionDisplayMode ?? 'one_question') === 'learner_choice'}
          {$t('course.navItem.lessons.exercises.all_exercises.settings_section_display_learner_choice')}
        {:else}
          {$t('course.navItem.lessons.exercises.all_exercises.settings_section_display_one_question')}
        {/if}
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="one_question">
          {$t('course.navItem.lessons.exercises.all_exercises.settings_section_display_one_question')}
        </Select.Item>
        <Select.Item value="all_questions">
          {$t('course.navItem.lessons.exercises.all_exercises.settings_section_display_all_questions')}
        </Select.Item>
        <Select.Item value="learner_choice">
          {$t('course.navItem.lessons.exercises.all_exercises.settings_section_display_learner_choice')}
        </Select.Item>
      </Select.Content>
    </Select.Root>
  </div>

  <div class="ui:border-border space-y-4 rounded-lg border p-4" aria-busy={assignmentsLoading}>
    <div class="space-y-1">
      <Label class="ui:text-foreground block text-sm font-medium">
        {$t('course.navItem.lessons.exercises.all_exercises.settings_assignment')}
      </Label>
      <p class="ui:text-muted-foreground text-sm">
        {$t('course.navItem.lessons.exercises.all_exercises.settings_assignment_helper')}
      </p>
    </div>

    {#if assignmentLoadFailed}
      <div class="space-y-3" role="alert">
        <p class="text-sm text-red-600 dark:text-red-400">
          {$t('course.navItem.lessons.exercises.all_exercises.settings_assignment_load_failed')}
        </p>
        <Button variant="outline" onclick={loadAssignments} loading={assignmentsLoading}>
          {$t('course.navItem.lessons.exercises.all_exercises.settings_assignment_retry')}
        </Button>
      </div>
    {:else}
      <Select.Root
        type="single"
        value={assignmentMode}
        disabled={assignmentsLoading || isPublicCourse}
        onValueChange={(value) => {
          if (value === 'ALL_STUDENTS' || value === 'SELECTED_STUDENTS') assignmentMode = value;
        }}
      >
        <Select.Trigger class="w-full">
          {assignmentMode === 'ALL_STUDENTS'
            ? $t('course.navItem.lessons.exercises.all_exercises.settings_assignment_all')
            : $t('course.navItem.lessons.exercises.all_exercises.settings_assignment_selected')}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="ALL_STUDENTS">
            {$t('course.navItem.lessons.exercises.all_exercises.settings_assignment_all')}
          </Select.Item>
          <Select.Item value="SELECTED_STUDENTS">
            {$t('course.navItem.lessons.exercises.all_exercises.settings_assignment_selected')}
          </Select.Item>
        </Select.Content>
      </Select.Root>
    {/if}

    {#if assignmentMode === 'SELECTED_STUDENTS'}
      <div class="max-h-64 space-y-2 overflow-y-auto rounded border p-3">
        {#each students as student (student.id)}
          <label class="flex items-center gap-3 text-sm">
            <Checkbox checked={selectedStudentIds.has(student.id)} onCheckedChange={() => toggleStudent(student.id)} />
            <span>{student.profile?.fullname || student.email}</span>
          </label>
        {:else}
          <p class="ui:text-muted-foreground text-sm">
            {$t('course.navItem.lessons.exercises.all_exercises.settings_assignment_empty')}
          </p>
        {/each}
      </div>
      {#if selectedStudentIds.size === 0}
        <p class="text-sm text-red-600 dark:text-red-400">
          {$t('course.navItem.lessons.exercises.all_exercises.settings_assignment_required')}
        </p>
      {/if}
    {/if}
  </div>

  {#if isPublicCourse}
    <div class="ui:border-border rounded-lg border p-4">
      <InputField
        label={$t('course.navItem.settings.slug.label')}
        helperMessage={$t('course.navItem.settings.slug.description')}
        value={slug}
        placeholder={slugifyTitle($questionnaire.title ?? '')}
        onInput={(e) => {
          slug = e.currentTarget.value;
        }}
        errorMessage={exerciseApi.errors.slug}
      />
    </div>
  {/if}

  <Button
    onclick={requestSave}
    loading={saving}
    disabled={!courseApi.course?.id ||
      assignmentsLoading ||
      assignmentLoadFailed ||
      (!settingsChanged && !assignmentChanged) ||
      (assignmentMode === 'SELECTED_STUDENTS' && selectedStudentIds.size === 0)}
  >
    {$t('course.navItem.lessons.exercises.all_exercises.settings_save')}
  </Button>

  {#if saveError}
    <p class="text-sm text-red-600 dark:text-red-400" role="alert">
      {$t(
        saveError === 'partial'
          ? 'course.navItem.lessons.exercises.all_exercises.settings_partial_save_failed'
          : saveError === 'assignment'
            ? 'course.navItem.lessons.exercises.all_exercises.settings_assignment_save_failed'
            : 'course.navItem.lessons.exercises.all_exercises.settings_save_failed'
      )}
    </p>
  {/if}
</div>

<Dialog.Root bind:open={removalConfirmationOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>
        {$t('course.navItem.lessons.exercises.all_exercises.settings_assignment_removal_title')}
      </Dialog.Title>
      <Dialog.Description>
        {$t('course.navItem.lessons.exercises.all_exercises.settings_assignment_removal_description', {
          students: removedAssignmentsWithSubmissions.length,
          submissions: removedSubmissionCount
        })}
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (removalConfirmationOpen = false)}>
        {$t('course.navItem.lessons.exercises.all_exercises.settings_assignment_removal_cancel')}
      </Button>
      <Button variant="destructive" onclick={saveSettings} loading={saving} disabled={saving}>
        {$t('course.navItem.lessons.exercises.all_exercises.settings_assignment_removal_confirm')}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
