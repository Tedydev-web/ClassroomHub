<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
  import Plus from '@lucide/svelte/icons/plus';
  import * as Collapsible from '@cio/ui/base/collapsible';
  import * as Sidebar from '@cio/ui/base/sidebar';
  import { IconButton } from '@cio/ui/custom/icon-button';

  import { ContentType } from '@cio/utils/constants/content';
  import CourseContentIcon from '$features/course/components/course-content-icon.svelte';
  import { courseExams } from '$features/course/api/exams.svelte';
  import { t } from '$lib/utils/functions/translations';

  /**
   * The course's exams, listed where its content is listed.
   *
   * Never rendered for a student, and that is not a permission detail — it is the whole
   * point of the feature. An exam delivers a detached container, one belonging to no
   * course, precisely so an enrolled student cannot open the paper from course content
   * without a clock. Listing exams in the tree a student reads would hand back exactly what
   * that detachment exists to prevent.
   *
   * A row leads to the exam's results, because that is the screen a teacher wants once an
   * exam exists — before anyone has sat it, it is also where the empty state and the link
   * live.
   */
  let { courseId }: { courseId: string } = $props();

  const STATUS_LABEL: Record<string, string> = $derived({
    draft: $t('exam.manage.draft'),
    open: $t('exam.manage.open'),
    closed: $t('exam.manage.closed')
  });

  $effect(() => {
    void courseExams.load(courseId);
  });
</script>

{#if courseExams.available}
  <Sidebar.MenuSub class="mt-1 ml-2">
    <Collapsible.Root open class="group/exams">
      {#snippet child({ props })}
        <Sidebar.MenuSubItem {...props}>
          <Collapsible.Trigger>
            {#snippet child({ props })}
              <Sidebar.MenuSubButton {...props} class="flex w-full items-center gap-2 font-medium">
                <CourseContentIcon type={ContentType.Exam} size={12} />

                <span class="flex-1 truncate">{$t('course.navItem.submissions.tab_exams')}</span>

                <div class="ml-auto flex items-center gap-1">
                  <IconButton
                    variant="ghost-outline"
                    size="icon-xs"
                    class="opacity-0 transition-opacity duration-150 group-hover/exams:opacity-100"
                    onclick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      goto(`/courses/${courseId}/exams/new`);
                    }}
                  >
                    <Plus />
                  </IconButton>

                  <IconButton variant="ghost" size="icon-xs">
                    <ChevronRightIcon
                      class="transition-transform duration-200 group-data-[state=open]/exams:rotate-90"
                    />
                  </IconButton>
                </div>
              </Sidebar.MenuSubButton>
            {/snippet}
          </Collapsible.Trigger>

          <Collapsible.Content>
            <Sidebar.MenuSub class="ml-2">
              {#each courseExams.exams as exam (exam.id)}
                <Sidebar.MenuSubItem>
                  <Sidebar.MenuSubButton isActive={page.url.pathname.includes(`/exams/${exam.id}`)}>
                    {#snippet child({ props })}
                      <a
                        href={resolve(`/courses/${courseId}/exams/${exam.id}`, {})}
                        title={exam.title}
                        class="flex w-full items-center gap-2"
                        {...props}
                      >
                        <CourseContentIcon type={ContentType.Exam} size={14} />
                        <span class="flex-1 truncate">{exam.title}</span>
                        <span class="ui:text-muted-foreground ui:text-2xs ml-auto shrink-0 leading-none">
                          {STATUS_LABEL[exam.status] ?? exam.status}
                        </span>
                      </a>
                    {/snippet}
                  </Sidebar.MenuSubButton>
                </Sidebar.MenuSubItem>
              {:else}
                <Sidebar.MenuSubItem>
                  <Sidebar.MenuSubButton>
                    {#snippet child({ props })}
                      <a
                        href={resolve(`/courses/${courseId}/exams/new`, {})}
                        class="ui:text-muted-foreground flex w-full items-center gap-2"
                        {...props}
                      >
                        <Plus size={14} />
                        <span class="flex-1 truncate">{$t('exam.manage.create')}</span>
                      </a>
                    {/snippet}
                  </Sidebar.MenuSubButton>
                </Sidebar.MenuSubItem>
              {/each}
            </Sidebar.MenuSub>
          </Collapsible.Content>
        </Sidebar.MenuSubItem>
      {/snippet}
    </Collapsible.Root>
  </Sidebar.MenuSub>
{/if}

<style>
  a {
    text-decoration: none;
  }
</style>
